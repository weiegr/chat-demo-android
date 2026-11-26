import type { ModelLimits } from '../api/modelLimits.js'
import type { ChatModel, MessageParam, MessageUsage } from '../api/types.js'
import { getContextRounds, toRequestMessages } from './reply.js'
import type {
  AssistantMessage,
  FileAttachment,
  Message,
  RpContextSample,
  UserMessage,
} from './types.js'

export const RP_SUMMARY_TOKENS = 8_192
export const RP_SUMMARY_LENGTH = 48 * 1024

const HASH_START = 2166136261
const mixHash = (hash: number, value: number) => Math.imul(hash ^ value, 16777619) >>> 0

type TextMeasure = { tokens: number; hash: number }
const textMeasures = new Map<string, TextMeasure>()
let cachedCharacters = 0

const measureText = (text: string): TextMeasure => {
  const cached = textMeasures.get(text)
  if (cached) {
    return cached
  }
  let hash = HASH_START
  let count = 0
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    hash = mixHash(hash, unit)
    // 连续字母与数字通常会合并。标点、代码与多字节文本用较保守的估算。
    if ((unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) || (unit >= 48 && unit <= 57)) {
      count += 0.35
    } else if (unit === 32 || unit === 9 || unit === 10 || unit === 13) {
      count += 0.35
    } else if (unit >= 0x3000 && unit <= 0x9fff) {
      count += 0.85
    } else {
      count++
    }
  }
  const measure = { tokens: Math.ceil(count), hash }
  if (cachedCharacters + text.length > 8 * 1024 * 1024 || textMeasures.size >= 4096) {
    textMeasures.clear()
    cachedCharacters = 0
  }
  if (text.length <= 8 * 1024 * 1024) {
    textMeasures.set(text, measure)
    cachedCharacters += text.length
  }
  return measure
}

export const estimateRpText = (text: string) => measureText(text).tokens

export const readRpSummary = (value: unknown) =>
  typeof value === 'string' && value.length <= RP_SUMMARY_LENGTH && value.trim()
    ? value.trim()
    : undefined

export const getRpHistoryForFiles = (history: Message[]) => {
  const rounds = getContextRounds(history)
  let start = 0
  rounds.forEach(([, reply], index) => {
    if (readRpSummary(reply.rpSummary)) {
      start = index + 1
    }
  })
  return rounds.slice(start).flat()
}

type RpRound = { reply: AssistantMessage; end: number; reminder?: string }

export type RpPrompt = {
  messages: MessageParam[]
  rounds: RpRound[]
  files: Map<string, FileAttachment>
}

export const buildRpPrompt = ({
  history,
  question,
  prefix,
  latestReminder,
  model,
  thinking,
  texts,
  ocrTexts,
}: {
  history: Message[]
  question?: UserMessage
  prefix?: AssistantMessage
  latestReminder?: string
  model: ChatModel
  thinking: boolean
  texts?: Map<string, string>
  ocrTexts?: Map<string, string>
}): RpPrompt => {
  const rounds: RpRound[] = []
  const pro = model === 'deepseek-v4-pro'
  const { messages } = toRequestMessages(
    history,
    question,
    prefix,
    thinking,
    latestReminder,
    undefined,
    {
      texts,
      ocrTexts,
      omitServerTools: true,
      omitLatestReminder: pro,
      useOcrForVisual: pro,
      onContextRound: (reply, end, reminder) => rounds.push({ reply, end, reminder }),
    }
  )
  const files = new Map<string, FileAttachment>()
  for (const message of question ? [...history, question] : history) {
    if (message.role === 'user') {
      for (const file of message.files) {
        if (file.serverId) {
          files.set(file.serverId, file)
        }
      }
    }
  }
  return { messages, rounds, files }
}

const summarizeSystem = (system: string, summary: string) =>
  [system, '【早期剧情摘要】以下内容用于接续已经发生的剧情。', summary, '【早期剧情摘要结束】']
    .filter(Boolean)
    .join('\n\n')

const messagesAfter = (messages: MessageParam[], round?: RpRound): MessageParam[] => {
  if (!round) {
    return messages
  }
  const remaining = messages.slice(round.end)
  if (round.reminder && remaining.length > 0 && remaining[0].role !== 'latest_reminder') {
    remaining.unshift({ role: 'latest_reminder', content: round.reminder })
  }
  return remaining
}

export const currentRpContext = (prompt: RpPrompt, system: string) => {
  let cutoff: RpRound | undefined
  let summary: string | undefined
  for (const round of prompt.rounds) {
    const saved = readRpSummary(round.reply.rpSummary)
    if (saved) {
      cutoff = round
      summary = saved
    }
  }
  return {
    cutoff,
    summary,
    messages: messagesAfter(prompt.messages, cutoff),
    system: summary ? summarizeSystem(system, summary) : system,
  }
}

const measureMessage = (message: MessageParam, files: RpPrompt['files']): TextMeasure => {
  let tokens = 5
  let hash = measureText(message.role).hash
  const addText = (text: string, extra = 0) => {
    const measure = measureText(text)
    tokens += measure.tokens + extra
    hash = mixHash(hash, measure.hash)
  }
  if (typeof message.content === 'string') {
    addText(message.content)
    return { tokens, hash }
  }
  for (const block of message.content) {
    hash = mixHash(hash, measureText(block.type).hash)
    switch (block.type) {
      case 'text':
        addText(block.text)
        break
      case 'thinking':
        // 签名是协议元数据，不计入模型正文。只有实际回传的续写思考会走到这里。
        addText(block.thinking, 2)
        break
      case 'image': {
        hash = mixHash(hash, measureText(block.source.file_id).hash)
        tokens += 1024
        break
      }
      case 'document': {
        const id = block.source.file_id
        hash = mixHash(hash, measureText(id).hash)
        // Files API 的解析结果无法从客户端读取；引用先估算，响应后用实际输入量修正。
        tokens += Math.min(32_768, Math.max(1_024, Math.ceil((files.get(id)?.size ?? 0) / 8)))
        break
      }
      default:
        addText(JSON.stringify(block))
    }
  }
  return { tokens, hash }
}

export const measureRpInput = (
  system: string,
  messages: MessageParam[],
  files: RpPrompt['files'],
  model: ChatModel,
  rounds: RpRound[] = []
) => {
  const candidates = new Map<number, RpContextSample[]>()
  for (const { reply } of rounds) {
    const sample = reply.rpContext
    if (reply.model === model && sample?.inputTokens !== undefined) {
      const entries = candidates.get(sample.messageCount) ?? []
      entries.push(sample)
      candidates.set(sample.messageCount, entries)
    }
  }
  const systemMeasure = measureText(system)
  let estimate = systemMeasure.tokens + 8
  let fingerprint = systemMeasure.hash
  let correction = 0
  for (let index = 0; index < messages.length; index++) {
    const message = measureMessage(messages[index], files)
    estimate += message.tokens
    fingerprint = mixHash(fingerprint, message.hash)
    const sample = candidates
      .get(index + 1)
      ?.find(
        (candidate) => candidate.fingerprint === fingerprint && candidate.estimate === estimate
      )
    if (sample?.inputTokens !== undefined) {
      correction = sample.inputTokens - estimate
    }
  }
  return {
    fingerprint,
    messageCount: messages.length,
    estimate,
    projected: Math.max(0, estimate + correction),
  }
}

export const actualRpInput = (usage: MessageUsage) => {
  const counts = [
    usage.input_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
  ]
  return counts.every((count) => Number.isSafeInteger(count) && count >= 0)
    ? counts.reduce((sum, count) => sum + count, 0)
    : undefined
}

export const rpBudget = (limits: ModelLimits, thinking: boolean) => {
  const output = Math.min(
    limits.output,
    thinking ? 65_536 : 8_192,
    Math.max(1, Math.floor(limits.context / 4))
  )
  const margin = Math.min(16_384, Math.floor(limits.context / 16))
  return { output, margin, input: Math.max(0, limits.context - output - margin) }
}

export const planRpCompaction = (
  prompt: RpPrompt,
  current: ReturnType<typeof currentRpContext>,
  system: string,
  budget: number,
  summaryTokens: number,
  force: boolean
) => {
  const from = current.cutoff?.end ?? 0
  const counts = [0]
  for (const message of prompt.messages) {
    counts.push(counts[counts.length - 1] + measureMessage(message, prompt.files).tokens)
  }
  const total = counts[counts.length - 1]
  const base = estimateRpText(summarizeSystem(system, '')) + summaryTokens + 8
  const target = Math.floor(0.8 * (force ? Math.min(budget, total - counts[from] + base) : budget))
  let fallback: RpRound | undefined
  for (const round of prompt.rounds) {
    if (round.end <= from) {
      continue
    }
    const reminder =
      round.reminder && prompt.messages[round.end]?.role !== 'latest_reminder'
        ? estimateRpText(round.reminder) + 5
        : 0
    const reduced = base + total - counts[round.end] + reminder
    if (reduced <= target) {
      return round
    }
    if (reduced <= budget) {
      fallback ??= round
    }
  }
  // 受本轮输入和续写前缀限制时，至少腾出预算，优先保留仍可放下的原文。
  return fallback
}

export const withRpSummary = (
  prompt: RpPrompt,
  system: string,
  cutoff: RpRound,
  summary: string
) => ({
  messages: messagesAfter(prompt.messages, cutoff),
  system: summarizeSystem(system, summary),
})
