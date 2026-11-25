import type { TranslationMessage } from '../../i18n/index.js'
import type { ApiErrorKind } from '../api/client.js'
import type {
  ChatModel,
  MessageUsage,
  ServerToolBlock,
  StopDetails,
  StopReason,
  TextCitation,
} from '../api/types.js'
import type { ChatMode } from '../settings.js'
import type { AudioAttachmentData } from '../audio/metadata.js'

/**
 * 消息附件。id 是本地标识（IndexedDB files 表的主键，原件按它存储，所有引用同一 id 的消息共用一份），
 * 导入的附件沿用导出产物里的文件 ID；本地没有原件的附件只展示文件名，不进入请求。
 * serverId 是 Files API 返回的 file_id，导入的数据或尚未上传成功的文件为 null，发送前补传。
 * ocrText 用于缓存 deepseek-v4-pro 下通过 DeepSeek OCR 接口提取的文字，避免多轮对话重复识别。
 */
export type FileAttachment = {
  id: string
  serverId: string | null
  /** 当前 serverId 对应的上传图片已确认符合长边限制。旧记录缺少此字段。 */
  imageSizeChecked?: boolean
  name: string
  size: number
  /** 附件类别；导入时沿用归档的 is_image，不由 MIME 识别结果决定。 */
  isImage: boolean
  /** 具体 MIME；导入时没有原件或无法识别的为空字符串，不影响图片身份。 */
  mimeType: string
  /** 经 DeepSeek OCR 提取的纯文本缓存（空串表示已识别但无文字） */
  ocrText?: string
  /** 音频原件只在本地播放，模型使用分析结果与配套频谱图片。 */
  audio?: AudioAttachmentData
}

/** 视频原件用于本地预览。模型使用 frameIds 对应的图片，并在可用时结合对白。 */
export type VideoAttachment = {
  id: string
  name: string
  size: number
  mimeType: string
  frameIds: string[]
  transcript?: string
}

/** 本地消息的分支关系；字段缺省时按线性消息列表处理。 */
type MessageBranch = {
  parentId?: string | null
  /** 当前选中的下一条消息；切换版本时保留每条分支原有的选择。 */
  selectedChildId?: string
}

export type UserMessage = MessageBranch & {
  id: string
  role: 'user'
  content: string
  files: FileAttachment[]
  video?: VideoAttachment
  createdAt: number
  /** 允许重新生成或续写当前的新提问时，沿用当轮的记忆授权。本地字段。 */
  memoryConsent?: { epoch: number; sourceRevision: number }
}

/** 思考块：thinking_delta 累积，签名随 signature_delta 到达；历史轮次的思考服务端会丢弃，不回传 */
export type ThinkingPart = {
  type: 'thinking'
  thinking: string
  signature?: string
  /** content_block_start 的时间；没有事件时间的历史块缺省 */
  startedAt?: number
  /** content_block_stop（或回复结束）的时间 */
  endedAt?: number
  /** 仅有耗时、没有事件时间时保存秒数。 */
  elapsedSeconds?: number
}

/** 文本块：text_delta 累积，citations_delta 追加引用 */
export type TextPart = {
  type: 'text'
  text: string
  citations?: TextCitation[]
  /** 服务端提示文案，仅用于展示，不作为模型回答参与上下文或续写。 */
  isTemplate?: boolean
}

/** 客户端工具调用块（如实时定位），含流式拼装 input 用的临时 JSON 缓存 */
export type ClientToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
  partialJson?: string
}

/** 客户端工具本地执行结果：用于回传 API 的 tool_result 与展示时间线状态 */
export type ClientToolResultBlock = {
  type: 'client_tool_result'
  tool_use_id: string
  name: string
  status: 'done' | 'failed'
  content: string
  is_error?: boolean
  summary?: string
  errorCode?: string
  matchCount?: number
}

/** 本地时间线只保存历史工具的动作和状态。 */
export type MemoryToolStepBlock = {
  type: 'memory_tool_step'
  id: string
  action: 'search' | 'read'
  status: 'wip' | 'done' | 'failed' | 'stopped'
  matchCount?: number
}

/** 服务端与客户端工具调用及结果块：read_link 与配对客户端工具会进入多轮上下文 */
export type ReplyBlock =
  | ThinkingPart
  | TextPart
  | ServerToolBlock
  | ClientToolUseBlock
  | ClientToolResultBlock
  | MemoryToolStepBlock

/**
 * pending：已发出请求，还没收到事件；streaming：正在接收；
 * done：收到 message_stop；stopped：用户停止或页面关闭；error：请求或流出错
 */
export type ReplyStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error'

/** 用实际请求的消息前缀匹配服务端用量，编辑或切换分支后重新估算变动部分。 */
export type RpContextSample = {
  fingerprint: number
  messageCount: number
  estimate: number
  projected: number
  prefillLength: number
  inputTokens?: number
  window: number
}

export type AssistantMessage = MessageBranch & {
  id: string
  role: 'assistant'
  createdAt: number
  /** 未记录模型时为 null，续写使用当前默认模型。 */
  model: ChatModel | null
  /** 请求时是否开启深度思考 */
  thinking?: boolean
  /** 请求时是否声明 deepseek_web_search；关闭时仍声明 deepseek_read_url */
  search?: boolean
  /** 本轮请求的系统信息快照；各回答版本独立保存，续写沿用。历史消息中缺省的快照保持为空。 */
  latestReminder?: string
  /** 是否允许作为续写前缀；仍需满足回复状态与内容限制。 */
  prefix: boolean
  status: ReplyStatus
  /** 可识别的内容块按接收顺序排列；续写产生的块追加在已有块之后 */
  blocks: ReplyBlock[]
  stopReason?: StopReason
  stopDetails?: StopDetails
  /** 最近一次请求的用量，续写后更新 */
  usage?: MessageUsage
  /** 剧情摘要覆盖当前回答及其相同分支上的所有较早轮次。 */
  rpSummary?: string
  rpContext?: RpContextSample
  error?: {
    /** upload：发送前补传附件失败，请求没有发出 */
    kind: ApiErrorKind | 'upload'
    message: string
    status?: number
    localMessage?: TranslationMessage
    /** 仅 upload：重新上传是否可能成功（网络、限流、服务端繁忙）；过大、格式不支持为 false */
    retryable?: boolean
  }
}

export type Message = UserMessage | AssistantMessage

export type SessionMemoryState = {
  enabled: boolean
  active: boolean
  processed?: string[]
}

export type Session = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** 对话模式：快速 / 专家 / RP；旧会话与导入会话缺省按快速模式处理。 */
  mode?: ChatMode
  /** 会话来源。旧归档可能缺失。 */
  origin?: 'chat' | 'live'
  /** 导入暂存附带的状态，提交时转入独立的记忆存储。 */
  memoryRestore?: SessionMemoryState
  /** 包含所有分支的消息，按创建顺序存储。 */
  messages: Message[]
  /** undefined 表示线性消息列表；null 表示空会话。 */
  rootMessageId?: string | null
}

/** 会话列表元数据；消息只在打开会话时加载。 */
export type SessionSummary = Pick<
  Session,
  'id' | 'title' | 'createdAt' | 'updatedAt' | 'mode' | 'origin'
>

/** 显式提取字段，避免将完整会话的消息带进列表。 */
export const toSessionSummary = (session: SessionSummary): SessionSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  ...(__BETA__ && session.mode !== undefined ? { mode: session.mode } : {}),
  ...(__BETA__ && session.origin !== undefined ? { origin: session.origin } : {}),
})
