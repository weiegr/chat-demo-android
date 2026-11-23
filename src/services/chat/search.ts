import type { ChatMode } from '../settings.js'
import type { AssistantMessage, Message, Session, SessionSummary } from './types.js'

/** 高亮片段：text 为原文切片，hit 表示这段是命中的关键词，交给界面画黄底 */
export type SearchSegment = { text: string; hit: boolean }

export type SearchAttachment = {
  name: string
  video: boolean
}

/** 命中位置：0 会话标题、1 附件名、2 消息正文 */
export type SearchHitRank = 0 | 1 | 2

export type ChatSearchHit = {
  sessionId: string
  title: string
  titleSegments: SearchSegment[]
  /** 正文索引尚未就绪时，摘要中的标题命中没有模式信息。 */
  mode?: ChatMode
  updatedAt: number
  /** 正文/附件命中的消息；标题命中时打开会话。 */
  messageId: string | null
  snippet: SearchSegment[]
  attachment: SearchAttachment | null
  /** 同一父消息下的第几个版本；只有一个版本时为 null */
  branch: { index: number; total: number } | null
  rank: SearchHitRank
}

type IndexedFile = { name: string; lower: string; video: boolean }

type IndexedMessage = {
  id: string
  text: string
  lower: string
  files: IndexedFile[]
  branch: { index: number; total: number } | null
}

export type IndexedSession = {
  id: string
  title: string
  titleLower: string
  mode: ChatMode
  updatedAt: number
  messages: IndexedMessage[]
}

/** 片段窗口：命中词前面留一点上下文，整体不超过一行半的高度 */
const SNIPPET_BEFORE = 28
const SNIPPET_LENGTH = 110
/** 单条文本里最多收集多少个高亮区间，避免异常长文本拖慢渲染 */
const MAX_HIGHLIGHTS = 80
/** 同一会话最多展示几条命中，防止一次搜索被单个长会话刷屏 */
const MAX_HITS_PER_SESSION = 6
const MAX_SEARCH_HITS = 60

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

const replyText = (message: AssistantMessage) =>
  normalize(
    message.blocks
      .map((block) => (block.type === 'text' && !block.isTemplate ? block.text : ''))
      .filter(Boolean)
      .join(' ')
  )

/** 同一父节点下的兄弟消息就是同一轮的不同版本；旧版线性会话没有分支信息。 */
const buildBranches = (session: Session): Map<string, { index: number; total: number }> | null => {
  if (session.rootMessageId === undefined) {
    return null
  }
  const groups = new Map<string, string[]>()
  for (const message of session.messages) {
    const key = message.parentId ?? ''
    const siblings = groups.get(key)
    if (siblings) {
      siblings.push(message.id)
    } else {
      groups.set(key, [message.id])
    }
  }
  const branches = new Map<string, { index: number; total: number }>()
  for (const ids of groups.values()) {
    ids.forEach((id, index) => branches.set(id, { index, total: ids.length }))
  }
  return branches
}

const indexedMessage = (
  message: Message,
  branch: { index: number; total: number } | null
): IndexedMessage | null => {
  if (message.role === 'user') {
    const text = normalize(message.content)
    const files: IndexedFile[] = message.files.map((file) => ({
      name: file.name,
      lower: file.name.toLowerCase(),
      video: false,
    }))
    if (message.video) {
      files.push({
        name: message.video.name,
        lower: message.video.name.toLowerCase(),
        video: true,
      })
    }
    if (!text && files.length === 0) {
      return null
    }
    return { id: message.id, text, lower: text.toLowerCase(), files, branch }
  }
  const text = replyText(message)
  if (!text) {
    return null
  }
  return { id: message.id, text, lower: text.toLowerCase(), files: [], branch }
}

export const indexSession = (session: Session): IndexedSession => {
  const branches = buildBranches(session)
  const messages: IndexedMessage[] = []
  for (const message of session.messages) {
    const indexed = indexedMessage(message, branches?.get(message.id) ?? null)
    if (indexed) {
      messages.push(indexed)
    }
  }
  const title = session.title ?? ''
  return {
    id: session.id,
    title,
    titleLower: title.toLowerCase(),
    mode: session.mode ?? 'fast',
    updatedAt: session.updatedAt,
    messages,
  }
}

/** 关键词按空白拆分，全部命中才算匹配；中文没有分词，整段子串匹配更符合直觉。 */
const parseTerms = (query: string) => [
  ...new Set(query.trim().toLowerCase().split(/\s+/).filter(Boolean)),
]

const matchesAll = (haystack: string, terms: readonly string[]) =>
  terms.every((term) => haystack.includes(term))

type Range = { start: number; end: number }

const collectRanges = (text: string, terms: readonly string[]): Range[] => {
  const haystack = text.toLowerCase()
  const ranges: Range[] = []
  for (const term of terms) {
    let cursor = 0
    while (ranges.length < MAX_HIGHLIGHTS) {
      const index = haystack.indexOf(term, cursor)
      if (index < 0) {
        break
      }
      ranges.push({ start: index, end: index + term.length })
      cursor = index + term.length
    }
  }
  return ranges.sort((a, b) => a.start - b.start)
}

const mergeRanges = (ranges: Range[]): Range[] => {
  const merged: Range[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ start: range.start, end: range.end })
    }
  }
  return merged
}

const toSegments = (text: string, ranges: readonly Range[]): SearchSegment[] => {
  const segments: SearchSegment[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), hit: false })
    }
    segments.push({ text: text.slice(range.start, range.end), hit: true })
    cursor = range.end
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), hit: false })
  }
  return segments
}

const highlight = (text: string, terms: readonly string[]): SearchSegment[] =>
  toSegments(text, mergeRanges(collectRanges(text, terms)))

/** 摘要已按更新时间倒序排列，只生成前若干个标题命中的高亮。 */
export const searchSessionTitles = (
  sessions: readonly SessionSummary[],
  query: string
): ChatSearchHit[] => {
  const terms = parseTerms(query)
  if (terms.length === 0) {
    return []
  }
  const hits: ChatSearchHit[] = []
  for (const session of sessions) {
    if (session.title && matchesAll(session.title.toLowerCase(), terms)) {
      hits.push({
        sessionId: session.id,
        title: session.title,
        titleSegments: highlight(session.title, terms),
        updatedAt: session.updatedAt,
        messageId: null,
        snippet: [],
        attachment: null,
        branch: null,
        rank: 0,
      })
      if (hits.length === MAX_SEARCH_HITS) {
        break
      }
    }
  }
  return hits
}

/** 命中词附近的窗口；命中太靠后时只保留关键词前面一小段上下文 */
const snippet = (text: string, terms: readonly string[]): SearchSegment[] => {
  const ranges = collectRanges(text, terms)
  const first = ranges[0]
  const plain = (value: string) =>
    value.length > SNIPPET_LENGTH ? `${value.slice(0, SNIPPET_LENGTH)}…` : value
  if (!first) {
    return [{ text: plain(text), hit: false }]
  }
  const from = Math.max(0, first.start - SNIPPET_BEFORE)
  const to = Math.min(text.length, from + SNIPPET_LENGTH)
  const slice = text.slice(from, to)
  const segments = toSegments(slice, mergeRanges(collectRanges(slice, terms)))
  if (from > 0) {
    segments.unshift({ text: '…', hit: false })
  }
  if (to < text.length) {
    segments.push({ text: '…', hit: false })
  }
  return segments
}

const latestText = (session: IndexedSession) =>
  [...session.messages].reverse().find((message) => message.text)?.text ?? ''

/** 内存查询：标题命中排前面，其次是附件名，最后是正文，同级按会话更新时间倒序。 */
export const searchChats = (
  index: Iterable<IndexedSession>,
  query: string,
  limit = MAX_SEARCH_HITS
): ChatSearchHit[] => {
  const terms = parseTerms(query)
  if (terms.length === 0) {
    return []
  }
  const hits: ChatSearchHit[] = []
  for (const session of index) {
    let count = 0
    if (session.titleLower && matchesAll(session.titleLower, terms)) {
      const latest = latestText(session)
      hits.push({
        sessionId: session.id,
        title: session.title,
        titleSegments: highlight(session.title, terms),
        mode: session.mode,
        updatedAt: session.updatedAt,
        // 标题命中不定位到具体某条消息，打开会话即可
        messageId: null,
        snippet: snippet(latest, terms),
        attachment: null,
        branch: null,
        rank: 0,
      })
      count += 1
    }
    for (const message of session.messages) {
      if (count >= MAX_HITS_PER_SESSION) {
        break
      }
      const file = message.files.find((item) => matchesAll(item.lower, terms))
      if (file) {
        hits.push({
          sessionId: session.id,
          title: session.title,
          titleSegments: highlight(session.title, terms),
          mode: session.mode,
          updatedAt: session.updatedAt,
          messageId: message.id,
          snippet: highlight(file.name, terms),
          attachment: { name: file.name, video: file.video },
          branch: message.branch,
          rank: 1,
        })
        count += 1
        continue
      }
      if (message.lower && matchesAll(message.lower, terms)) {
        hits.push({
          sessionId: session.id,
          title: session.title,
          titleSegments: highlight(session.title, terms),
          mode: session.mode,
          updatedAt: session.updatedAt,
          messageId: message.id,
          snippet: snippet(message.text, terms),
          attachment: null,
          branch: message.branch,
          rank: 2,
        })
        count += 1
      }
    }
  }
  hits.sort((a, b) => a.rank - b.rank || b.updatedAt - a.updatedAt)
  return hits.slice(0, limit)
}
