import { getVisibleMessages } from './branches.js'
import type { AssistantMessage, Session, SessionMemoryState, UserMessage } from './types.js'

export type MemoryTurn = {
  questionId: string
  replyId: string
  epoch: number
  sourceRevision: number
}

export type MemorySource = SessionMemoryState & {
  id: string
  /** 只有已参与且允许记忆的会话拥有可用于工具调用的 ID。 */
  publicId?: string
  revision: number
  pending?: MemoryTurn[]
  dueAt?: number
  attempts?: number
}

export type MemoryProfile = {
  id: 'profile'
  enabled: boolean
  epoch: number
  markdown: string
  updatedAt?: number
  lastUsage?: { cached: number; uncached: number; output: number }
  lease?: { id: string; expires: number }
}

export const emptyMemoryProfile: MemoryProfile = {
  id: 'profile',
  enabled: false,
  epoch: 0,
  markdown: '',
}

export const MEMORY_IDLE_MS = 30_000
export const MEMORY_INPUT_BYTES = 24 * 1024
export const MEMORY_OUTPUT_TOKENS = 4096
export const MEMORY_READ_BYTES = 4 * 1024

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const textBytes = (text: string) => encoder.encode(text).length

export const trimToBytes = (text: string, limit: number) => {
  if (limit <= 0) {
    return ''
  }
  if (text.length <= limit / 3) {
    return text
  }
  const bytes = encoder.encode(text)
  if (bytes.length <= limit) {
    return text
  }
  return decoder.decode(bytes.subarray(0, limit)).replace(/\uFFFD$/, '')
}

export const isMemorySession = (session: Pick<Session, 'mode' | 'origin' | 'title'>) =>
  (session.mode ?? 'fast') === 'fast' &&
  session.origin !== 'live' &&
  (session.origin === 'chat' || !/^DeepSeek Live(?:\s*·|$)/i.test(session.title))

export const defaultMemorySource = (id: string): MemorySource => ({
  id,
  enabled: true,
  active: false,
  revision: 0,
})

export const isMemorySourceAllowed = (
  profile: MemoryProfile,
  source: MemorySource
): source is MemorySource & { publicId: string } =>
  profile.enabled && source.enabled && source.active && source.publicId !== undefined

export const memoryReplyText = (reply: AssistantMessage) =>
  reply.blocks
    .flatMap((block) => (block.type === 'text' && !block.isTemplate ? [block.text] : []))
    .join('')
    .trim()

export const isMemoryReply = (reply: AssistantMessage) =>
  reply.status === 'done' &&
  (reply.stopReason === 'end_turn' || reply.stopReason === undefined) &&
  Boolean(memoryReplyText(reply))

export type MemoryMessage = { id: string; role: 'user' | 'assistant'; text: string }

/** Common numbering for search hits, read ranges and rebuilds. */
export const getMemoryMessages = (session: Session): MemoryMessage[] =>
  getVisibleMessages(session).flatMap((message) => {
    const text =
      message.role === 'user'
        ? message.content.trim()
        : isMemoryReply(message)
          ? memoryReplyText(message)
          : ''
    return text ? [{ id: message.id, role: message.role, text }] : []
  })

export const getMemoryRounds = (session: Session) => {
  const path = getVisibleMessages(session)
  const rounds = new Map<string, [UserMessage, AssistantMessage]>()
  for (let i = 1; i < path.length; i += 1) {
    const question = path[i - 1]
    const reply = path[i]
    if (
      question.role === 'user' &&
      question.content.trim() &&
      reply.role === 'assistant' &&
      isMemoryReply(reply)
    ) {
      rounds.set(question.id, [question, reply])
    }
  }
  return rounds
}
