import { isOcrSupportedAttachment } from '../api/ocr.js'
import type {
  AssistantBlockParam,
  FileBlockParam,
  MessageParam,
  MessageStreamEvent,
  OutputBlockStart,
  TextBlockParam,
  ToolResultBlockParam,
} from '../api/types.js'
import { audioContextText, getAudioSpectrogramIds } from '../audio/metadata.js'
import { isTextAttachment } from './inlineFiles.js'
import type {
  AssistantMessage,
  ClientToolUseBlock,
  FileAttachment,
  Message,
  ReplyBlock,
  ReplyStatus,
  UserMessage,
} from './types.js'
import { buildWebSearchRecord, hasWebSearchRecord } from './webSearchContext.js'

/**
 * 文件按 Files API 的 file_id（附件的 serverId）引用：图片用 image 块，其余用 document 块。
 * 发送前 streamReply 会先补齐 serverId；仍为 null 的是本地没有原件的附件，不进入请求。
 */
const toFileBlocks = (files: FileAttachment[]): FileBlockParam[] =>
  files.flatMap(({ serverId, isImage }) =>
    serverId
      ? [
          {
            type: isImage ? 'image' : 'document',
            source: { type: 'file', file_id: serverId },
          },
        ]
      : []
  )

const isInputRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const parseToolJson = (block: ClientToolUseBlock): ClientToolUseBlock => {
  if (block.partialJson === undefined) {
    return block
  }
  const { id, name, type, partialJson } = block
  try {
    const input: unknown = JSON.parse(partialJson)
    if (isInputRecord(input)) {
      return { type, id, name, input }
    }
  } catch {
    // 保留调用 ID 以便回传参数错误。
  }
  return { type, id, name, input: {}, invalidInput: true }
}

const toReplyBlock = (block: OutputBlockStart, now: number): ReplyBlock | null => {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text, citations: block.citations ?? [] }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: block.thinking,
        signature: block.signature,
        startedAt: now,
      }
    case 'server_tool_use':
    case 'web_search_tool_result':
    case 'web_fetch_tool_result':
      return block
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        ...(isInputRecord(block.input)
          ? { input: block.input }
          : { input: {}, invalidInput: true }),
      }
    default:
      return null
  }
}

const updateBlock = (
  reply: AssistantMessage,
  index: number,
  update: (block: ReplyBlock) => ReplyBlock
): AssistantMessage => {
  const block = reply.blocks[index]
  if (!block) {
    return reply
  }
  const blocks = [...reply.blocks]
  blocks[index] = update(block)
  return { ...reply, blocks }
}

/**
 * 把一个流式事件合并进回复：只追加可识别的内容块，用本次请求的临时索引映射处理增量。
 * 跳过的块不占位；续写直接追加到已有内容之后，message_delta 更新结束原因与累计用量。
 */
export const applyEvent = (
  reply: AssistantMessage,
  event: MessageStreamEvent,
  now: number,
  blockIndexes: Map<number, number>
): AssistantMessage => {
  const next: AssistantMessage =
    reply.status === 'streaming' ? reply : { ...reply, status: 'streaming' }
  switch (event.type) {
    case 'message_start':
      return { ...next, usage: event.message.usage ?? next.usage }
    case 'content_block_start': {
      blockIndexes.delete(event.index)
      const block = toReplyBlock(event.content_block, now)
      if (!block) {
        return next
      }
      blockIndexes.set(event.index, next.blocks.length)
      return {
        ...next,
        ...(block.type === 'tool_use' ? { prefix: false } : {}),
        blocks: [...next.blocks, block],
      }
    }
    case 'content_block_delta': {
      const index = blockIndexes.get(event.index)
      if (index === undefined) {
        return next
      }
      const { delta } = event
      return updateBlock(next, index, (block) => {
        if (block.type === 'text' && delta.type === 'text_delta') {
          return { ...block, text: block.text + delta.text }
        }
        if (block.type === 'thinking' && delta.type === 'thinking_delta') {
          return { ...block, thinking: block.thinking + delta.thinking }
        }
        if (block.type === 'thinking' && delta.type === 'signature_delta') {
          return { ...block, signature: (block.signature ?? '') + delta.signature }
        }
        if (block.type === 'text' && delta.type === 'citations_delta') {
          return { ...block, citations: [...(block.citations ?? []), delta.citation] }
        }
        if (block.type === 'tool_use' && delta.type === 'input_json_delta') {
          return { ...block, partialJson: (block.partialJson ?? '') + delta.partial_json }
        }
        return block
      })
    }
    case 'content_block_stop': {
      const index = blockIndexes.get(event.index)
      if (index === undefined) {
        return next
      }
      blockIndexes.delete(event.index)
      return updateBlock(next, index, (block) => {
        if (
          block.type === 'thinking' &&
          block.startedAt !== undefined &&
          block.endedAt === undefined
        ) {
          return { ...block, endedAt: now }
        }
        if (block.type === 'tool_use') {
          return parseToolJson(block)
        }
        return block
      })
    }
    case 'message_delta':
      return {
        ...next,
        stopReason: event.delta.stop_reason,
        stopDetails: event.delta.stop_details,
        usage: event.usage ?? next.usage,
      }
    default:
      return next
  }
}

/**
 * 回复结束：未结束的思考块以当前时间收尾。
 * 安全拒绝（stop_reason: refusal）时已下发的思考与正文不能撤回，按协议要求由客户端丢弃，只保留工具块。
 */
export const settleReply = (
  reply: AssistantMessage,
  status: Extract<ReplyStatus, 'done' | 'stopped' | 'error'>,
  now: number,
  error?: AssistantMessage['error']
): AssistantMessage => ({
  ...reply,
  status,
  error,
  blocks: reply.blocks.flatMap((block): ReplyBlock[] => {
    if (reply.stopReason === 'refusal' && (block.type === 'thinking' || block.type === 'text')) {
      return []
    }
    if (block.type === 'thinking' && block.startedAt !== undefined && block.endedAt === undefined) {
      return [{ ...block, endedAt: now }]
    }
    if (block.type === 'tool_use') {
      return [parseToolJson(block)]
    }
    return [block]
  }),
})

/** 回复里所有文本块拼起来，用于复制与判断是否有回答 */
export const getReplyText = (reply: AssistantMessage) =>
  reply.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

/**
 * 只有正常达到输出上限或被停止的回复可续写，报错回复不能续写。
 * 末条限制由调用方判断，拒绝和客户端工具调用不能续写。
 * 本轮含服务端工具调用或结果（含 READ_LINK 和孤立结果块）的回复不能续写。
 * 服务端模板提示不能作为续写前缀。
 */
export const canContinueReply = (reply: AssistantMessage): boolean => {
  if (
    !reply.prefix ||
    reply.writingLength ||
    reply.stopReason === 'refusal' ||
    reply.stopReason === 'tool_use' ||
    reply.blocks.some(
      (block) =>
        block.type === 'server_tool_use' ||
        block.type === 'web_search_tool_result' ||
        block.type === 'web_fetch_tool_result' ||
        block.type === 'tool_use' ||
        block.type === 'client_tool_result' ||
        (block.type === 'text' && block.isTemplate)
    )
  ) {
    return false
  }
  return (
    reply.status === 'stopped' || (reply.status === 'done' && reply.stopReason === 'max_tokens')
  )
}

/**
 * 已结束或停止且有回答文本的回复才放进上下文；被安全拒绝的轮次不回传。
 * 服务端模板提示不进入上下文。
 */
const isUsableReply = (message: Message): message is AssistantMessage =>
  message.role === 'assistant' &&
  (message.status === 'done' || message.status === 'stopped') &&
  message.stopReason !== 'refusal' &&
  !message.blocks.some((block) => block.type === 'text' && block.isTemplate) &&
  getReplyText(message) !== ''

type UserMessageParam = Extract<MessageParam, { role: 'user' }>

export const RP_PREVIEW_TEXT_PREFIX = '__preview_text__:'
export const RP_PREVIEW_FILE_PREFIX = '__preview_file__:'

type PreviewPendingFilesOptions = {
  /** 尚在本地异步读取中的纯文本附件 ID；加载期间用预览估算块，不落入失败占位符 */
  textIds?: ReadonlySet<string>
  /** 允许对跨模型（仅有另一个模型的 serverId 或 ocrText）的视觉/文档附件生成预览估算块 */
  crossModel?: boolean
  /** 标记本条为用户当前待发提问（尚在上传/OCR 准备阶段） */
  currentQuestion?: boolean
}

type UserParamOptions = {
  texts?: Map<string, string>
  ocrTexts?: Map<string, string>
  strictInline?: boolean
  useOcrForVisual?: boolean
  includeVideo?: boolean
  includeAudio?: boolean
  /** 仅用于 RP 上下文圆环预览估算，真实 API 请求绝不传入 */
  previewPendingFiles?: PreviewPendingFilesOptions
  /** 置于正文最前的注入文本（旁路搜索结果），与内联附件、正文按空行连接 */
  prepend?: string
}

/**
 * 有文件时用内容块数组：先文件后文本，文件按 Files API 的 file_id 引用。
 * - 纯文本附件已在本地读出正文（texts），不再作为 document 块上传，避免走单条 32768 token 的受限通道；
 *   strictInline 用于本轮提问与 RP 模式历史：读不到正文时用占位说明代替，绝不退回 document。
 * - useOcrForVisual 用于 deepseek-v4-pro（无原生识图）：图片与 PDF/Office 不发 image/document 块，
 *   改为拼入经 DeepSeek OCR 接口识别出的纯文本。
 */
const toUserParam = (
  { content, files, video }: UserMessage,
  {
    texts,
    ocrTexts,
    strictInline = false,
    useOcrForVisual = false,
    includeVideo,
    includeAudio,
    previewPendingFiles,
    prepend,
  }: UserParamOptions
): { message: UserMessageParam; hasVideo: boolean } => {
  const spectrogramIds = getAudioSpectrogramIds(files)
  const isInlinedText = (file: FileAttachment) =>
    isTextAttachment(file) && (strictInline || texts?.has(file.id))
  const isInlinedOcr = (file: FileAttachment) =>
    useOcrForVisual && !spectrogramIds.has(file.id) && !file.audio && isOcrSupportedAttachment(file)

  const requestFiles = files.filter((file) => !isInlinedText(file) && !isInlinedOcr(file))
  const videoSource = includeVideo ? video : undefined
  const frameIds = new Set(videoSource?.frameIds)
  const regularRequestFiles = requestFiles.filter(
    (file) => !file.audio && !frameIds.has(file.id) && !spectrogramIds.has(file.id)
  )
  const blocks: (FileBlockParam | TextBlockParam)[] = toFileBlocks(regularRequestFiles)
  if (previewPendingFiles) {
    for (const file of regularRequestFiles) {
      if (
        !file.serverId &&
        ((previewPendingFiles.crossModel && file.ocrText !== undefined) ||
          previewPendingFiles.currentQuestion)
      ) {
        blocks.push({
          type: file.isImage ? 'image' : 'document',
          source: { type: 'file', file_id: `${RP_PREVIEW_FILE_PREFIX}${file.id}` },
        })
      }
    }
  }
  const frames = toFileBlocks(
    (videoSource?.frameIds ?? []).flatMap((id) => {
      const file = requestFiles.find((item) => item.id === id && item.isImage)
      return file ? [file] : []
    })
  )
  if (frames.length > 0) {
    blocks.push(
      { type: 'text', text: '【视频画面】以下图片按时间顺序排列，每格对应一个独立时刻。' },
      ...frames
    )
  }
  const transcript = videoSource?.transcript?.trim()
  if (transcript) {
    blocks.push({ type: 'text', text: `【视频对白】\n${transcript}` })
  }
  if (includeAudio) {
    for (const file of files) {
      if (!file.audio) {
        continue
      }
      const { spectrogramId, analysis } = file.audio
      const image = requestFiles.find((item) => item.id === spectrogramId && item.isImage)
      const spectrogram = image ? toFileBlocks([image]) : []
      blocks.push(
        { type: 'text', text: audioContextText(file.name, analysis, spectrogram.length > 0) },
        ...spectrogram
      )
    }
  }
  const inline = files.flatMap((file) => {
    if (isInlinedText(file)) {
      const text = texts?.get(file.id)
      if (text === undefined && previewPendingFiles?.textIds?.has(file.id)) {
        blocks.push({
          type: 'document',
          source: { type: 'file', file_id: `${RP_PREVIEW_TEXT_PREFIX}${file.id}` },
        })
        return []
      }
      return [
        text === undefined
          ? `【附件：${file.name}｜正文读取失败，未发送】`
          : `【附件：${file.name}】\n${text}`,
      ]
    }
    if (isInlinedOcr(file)) {
      const ocr = ocrTexts?.get(file.id) ?? file.ocrText
      const kindLabel = file.isImage ? '图片' : '文档'
      if (ocr === undefined) {
        if (
          previewPendingFiles &&
          ((previewPendingFiles.crossModel && Boolean(file.serverId)) ||
            previewPendingFiles.currentQuestion)
        ) {
          blocks.push({
            type: file.isImage ? 'image' : 'document',
            source: { type: 'file', file_id: `${RP_PREVIEW_FILE_PREFIX}${file.id}` },
          })
          return []
        }
        return [`【${kindLabel}：${file.name}｜无法读取原件进行文字识别】`]
      }
      if (!ocr.trim()) {
        return [`【${kindLabel}：${file.name}｜OCR 未识别到文字】`]
      }
      return [`【${kindLabel} OCR：${file.name}】\n${ocr}`]
    }
    return []
  })
  const merged = [prepend ?? '', ...inline, content].filter(Boolean).join('\n\n')
  const hasBlocks = blocks.length > 0
  if (hasBlocks && merged) {
    blocks.push({ type: 'text', text: merged })
  } else if (includeAudio && files.some((file) => file.audio)) {
    blocks.push({
      type: 'text',
      text: '如果音频里有明确向助手提出的问题，请回答。否则结合对白和声音特征简要描述音频。',
    })
  }
  return {
    message: {
      role: 'user',
      content: hasBlocks ? blocks : merged,
    },
    hasVideo: frames.length > 0 || Boolean(transcript),
  }
}

/**
 * assistant 的内容块按历史、工具循环与续写场景转换为消息数组：
 * - 历史思考及其签名不回传；同一轮工具循环或开启思考时续写保留思考及其签名；
 * - 文本块去掉 citations（服务端忽略）。相邻文本直接拼接，被思考或工具隔开的文本用空行连接；
 * - 同轮续接回传完整工具块，并把已配对的客户端结果放在紧随其后的 user 消息；
 * - 普通历史仅回传正文与协议所需的 read_link，客户端工具另用简短记录。
 */
const toReplyParams = (
  { blocks }: AssistantMessage,
  prefix = false,
  thinking = false,
  omitServerTools = false
): MessageParam[] => {
  const unsignedReadLinks = new Set(
    blocks.flatMap((block) =>
      block.type === 'web_fetch_tool_result' &&
      block.kind === 'read_link' &&
      block.content.type === 'web_fetch_result' &&
      !block.signature?.trim()
        ? [block.tool_use_id]
        : []
    )
  )
  const completedClientToolIds = new Set(
    prefix
      ? blocks.flatMap((block) => (block.type === 'client_tool_result' ? [block.tool_use_id] : []))
      : []
  )
  const messages: MessageParam[] = []
  let content: AssistantBlockParam[] = []
  let text: TextBlockParam | null = null
  let pendingToolResults: ToolResultBlockParam[] = []

  const flushAssistant = () => {
    const cleaned = content.filter((block) => block.type !== 'text' || block.text !== '')
    if (cleaned.length > 0) {
      messages.push({ role: 'assistant', content: cleaned })
    }
    content = []
    text = null
  }

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      flushAssistant()
      if (messages.at(-1)?.role === 'assistant') {
        messages.push({ role: 'user', content: pendingToolResults })
      }
      pendingToolResults = []
    }
  }

  for (const block of blocks) {
    if (block.type === 'memory_tool_step') {
      continue
    }
    if (block.type === 'client_tool_result') {
      if (prefix) {
        pendingToolResults.push({
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content,
          ...(block.is_error ? { is_error: true } : {}),
        })
      }
      text = null
      continue
    }
    flushToolResults()

    if (prefix && block.type === 'thinking' && !block.thinking.trim() && !block.signature) {
      continue
    }
    if (block.type === 'text') {
      if (completedClientToolIds.size > 0) {
        content.push({ type: 'text', text: block.text })
      } else if (text) {
        text.text += block.text
      } else {
        const previous = content.at(-1)
        text = {
          type: 'text',
          text: `${previous?.type === 'text' ? '\n\n' : ''}${block.text}`,
        }
        content.push(text)
      }
      continue
    }
    text = null
    if (prefix && thinking && block.type === 'thinking') {
      const { type, thinking: thought, signature } = block
      content.push({ type, thinking: thought, signature: signature ?? '' })
    } else if (
      !omitServerTools &&
      block.type === 'server_tool_use' &&
      !block.id.startsWith('bypass-') &&
      (prefix || (block.kind === 'read_link' && !unsignedReadLinks.has(block.id)))
    ) {
      const { type, id, name, input, kind } = block
      content.push(prefix ? block : { type, id, name, input, kind })
    } else if (
      prefix &&
      !omitServerTools &&
      block.type === 'web_search_tool_result' &&
      !block.tool_use_id.startsWith('bypass-')
    ) {
      content.push(block)
    } else if (
      !omitServerTools &&
      block.type === 'web_fetch_tool_result' &&
      !block.tool_use_id.startsWith('bypass-') &&
      (prefix || (block.kind === 'read_link' && !unsignedReadLinks.has(block.tool_use_id)))
    ) {
      content.push(block)
    } else if (prefix && block.type === 'tool_use' && completedClientToolIds.has(block.id)) {
      const parsed = parseToolJson(block)
      content.push({ type: 'tool_use', id: parsed.id, name: parsed.name, input: parsed.input })
    }
  }
  flushToolResults()
  flushAssistant()
  return messages
}

const buildClientToolRecord = (reply: AssistantMessage): string => {
  const facts = new Map<string, { checked_at?: string; title?: string; size?: string }>()
  for (const block of reply.blocks) {
    if (block.type !== 'client_tool_result' || block.status !== 'done' || block.is_error) {
      continue
    }
    if (block.name === 'draw_image' && block.image?.stage === 'refine') {
      const { title, width, height } = block.image
      facts.set(block.name, { title: title?.slice(0, 40), size: `${width}×${height}` })
    } else if (block.name === 'get_balance' || block.name === 'get_location') {
      try {
        const result: unknown = JSON.parse(block.content)
        if (
          isInputRecord(result) &&
          typeof result.fetched_at === 'string' &&
          Number.isFinite(Date.parse(result.fetched_at))
        ) {
          facts.set(block.name, { checked_at: new Date(result.fetched_at).toISOString() })
        }
      } catch {
        // 旧记录缺少可校验的时间时无需附加。
      }
    }
  }
  return facts.size === 0
    ? ''
    : `【该轮客户端工具记录】\n${JSON.stringify(Object.fromEntries(facts))}`
}

const appendRequestContext = (question: UserMessageParam, context: string) => {
  if (context) {
    question.content =
      typeof question.content === 'string'
        ? `${question.content}\n\n${context}`
        : [...question.content, { type: 'text', text: context }]
  }
}

/** 历史中会进入请求上下文的轮次：提问后紧跟可用回答的才保留 */
export const getContextRounds = (history: Message[]): [UserMessage, AssistantMessage][] => {
  const rounds: [UserMessage, AssistantMessage][] = []
  for (let i = 0; i + 1 < history.length; i++) {
    const [user, reply] = [history[i], history[i + 1]]
    if (user.role === 'user' && isUsableReply(reply)) {
      rounds.push([user, reply])
      i++
    }
  }
  return rounds
}

/**
 * 把会话转成请求的 messages：只保留「提问 + 有回答的回复」成对的轮次，最后接上本轮提问。
 * 失败或没有回答的轮次不进上下文。工具循环或续写时再带上本轮已有回复分段。
 */
export const toRequestMessages = (
  history: Message[],
  question: UserMessage | undefined,
  prefix?: AssistantMessage,
  thinking = prefix?.thinking ?? false,
  latestReminder?: string,
  toolLoopReply?: AssistantMessage,
  options?: {
    texts?: Map<string, string>
    ocrTexts?: Map<string, string>
    omitServerTools?: boolean
    omitLatestReminder?: boolean
    useOcrForVisual?: boolean
    includeVideo?: boolean
    includeAudio?: boolean
    previewPendingFiles?: Omit<PreviewPendingFilesOptions, 'currentQuestion'>
    onContextRound?: (reply: AssistantMessage, end: number, reminder?: string) => void
    /** 旁路搜索注入文本，仅置于本轮提问最前（历史轮搜索块不进请求） */
    searchContext?: string
  }
): { messages: MessageParam[]; hasVideoContext: boolean } => {
  const texts = options?.texts
  const ocrTexts = options?.ocrTexts
  const omitServerTools = options?.omitServerTools ?? false
  const omitLatestReminder = options?.omitLatestReminder ?? false
  const useOcrForVisual = options?.useOcrForVisual ?? false
  const includeVideo = options?.includeVideo ?? false
  const includeAudio = options?.includeAudio ?? false
  const previewPendingFiles = options?.previewPendingFiles
  const messages: MessageParam[] = []
  let hasVideoContext = false
  let previousReminder: string | undefined
  let latestSearch: { reply: AssistantMessage; question: UserMessageParam } | undefined
  const appendReminder = (reminder: string | undefined) => {
    // 服务端不支持 latest_reminder 的模型（deepseek-v4-pro）整个请求省略该角色；
    // 其余仅在当前分支首次出现或内容变化时插入快照，缺少快照的消息保持原有内容。
    if (omitLatestReminder || !reminder || reminder === previousReminder) {
      return
    }
    messages.push({ role: 'latest_reminder', content: reminder })
    previousReminder = reminder
  }
  for (const [user, reply] of getContextRounds(history)) {
    const spectrogramIds = getAudioSpectrogramIds(user.files)
    const hasInlineText = user.files.some((file) => texts?.has(file.id))
    const hasOcr =
      useOcrForVisual &&
      user.files.some(
        (file) =>
          !file.audio &&
          !spectrogramIds.has(file.id) &&
          isOcrSupportedAttachment(file) &&
          (ocrTexts?.has(file.id) || file.ocrText !== undefined)
      )
    const remainingFiles = user.files.filter(
      (file) =>
        !file.audio &&
        !spectrogramIds.has(file.id) &&
        !(isTextAttachment(file) && (omitServerTools || texts?.has(file.id))) &&
        !(useOcrForVisual && isOcrSupportedAttachment(file))
    )
    const hasPreviewFile =
      Boolean(previewPendingFiles) &&
      user.files.some((file) => {
        if (file.audio || spectrogramIds.has(file.id)) {
          return false
        }
        if (isTextAttachment(file) && (omitServerTools || texts?.has(file.id))) {
          return Boolean(previewPendingFiles?.textIds?.has(file.id))
        }
        if (useOcrForVisual && isOcrSupportedAttachment(file)) {
          return Boolean(previewPendingFiles?.crossModel && file.serverId)
        }
        return Boolean(
          previewPendingFiles?.crossModel && !file.serverId && file.ocrText !== undefined
        )
      })
    // 历史提问没有文字、附件也不进请求时，提问为空，连同回答一起省略。
    if (
      !user.content &&
      !remainingFiles.some((file) => file.serverId) &&
      !hasInlineText &&
      !hasOcr &&
      !hasPreviewFile &&
      !(includeAudio && user.files.some((file) => file.audio)) &&
      !(includeVideo && user.video?.transcript?.trim())
    ) {
      options?.onContextRound?.(reply, messages.length, previousReminder)
      continue
    }
    const replyParams = toReplyParams(reply, false, false, omitServerTools)
    if (replyParams.at(-1)?.role !== 'assistant') {
      options?.onContextRound?.(reply, messages.length, previousReminder)
      continue
    }
    appendReminder(reply.latestReminder)
    // RP 模式下历史里的文本附件同样强制内联，避免遗留 serverId 把请求带回 32K 受限通道。
    const userParam = toUserParam(user, {
      texts,
      ocrTexts,
      strictInline: omitServerTools,
      useOcrForVisual,
      includeVideo,
      includeAudio,
      previewPendingFiles: previewPendingFiles
        ? { ...previewPendingFiles, currentQuestion: false }
        : undefined,
    })
    if (!omitServerTools) {
      appendRequestContext(userParam.message, buildClientToolRecord(reply))
      if (hasWebSearchRecord(reply)) {
        latestSearch = { reply, question: userParam.message }
      }
    }
    messages.push(userParam.message, ...replyParams)
    options?.onContextRound?.(reply, messages.length, previousReminder)
    hasVideoContext ||= userParam.hasVideo
  }
  if (latestSearch) {
    const { question: searchedQuestion, reply: searchedReply } = latestSearch
    appendRequestContext(searchedQuestion, buildWebSearchRecord(searchedReply))
  }
  appendReminder(latestReminder)
  if (question) {
    const questionParam = toUserParam(question, {
      texts,
      ocrTexts,
      strictInline: true,
      useOcrForVisual,
      includeVideo,
      includeAudio,
      previewPendingFiles: previewPendingFiles
        ? { ...previewPendingFiles, currentQuestion: true }
        : undefined,
      prepend: options?.searchContext,
    })
    messages.push(questionParam.message)
    hasVideoContext ||= questionParam.hasVideo
  }
  if (toolLoopReply) {
    messages.push(...toReplyParams(toolLoopReply, true, thinking, omitServerTools))
  } else if (prefix?.prefix) {
    const [assistant] = toReplyParams(prefix, true, thinking, omitServerTools)
    // 没有非空白正文或有效思考时直接重发原问题，避免服务端拒绝空 Prefill。
    if (
      assistant?.role === 'assistant' &&
      assistant.content.some(
        (block) =>
          (block.type === 'text' && block.text.trim()) ||
          (block.type === 'thinking' && block.thinking.trim())
      )
    ) {
      messages.push(assistant)
    }
  }
  return { messages, hasVideoContext }
}

/** 思考用时（秒），至少 1 秒 */
export const getThinkingSeconds = (startedAt: number, endedAt: number) =>
  Math.max(1, Math.round((endedAt - startedAt) / 1000))
