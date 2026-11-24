import { getMemoryMessages } from './memoryModel.js'
import type { AuthorizedSession } from './memoryStorage.js'

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
const segmenter =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null
const stopWords = new Set([
  'a',
  'an',
  'and',
  'did',
  'do',
  'how',
  'i',
  'in',
  'is',
  'last',
  'me',
  'my',
  'of',
  'on',
  'that',
  'the',
  'to',
  'was',
  'we',
  'what',
  'which',
  'you',
  '之前',
  '以前',
  '上次',
  '我',
  '我们',
  '你',
  '是',
  '的',
  '了',
  '过',
  '吗',
  '什么',
  '怎样',
  '怎么',
  '哪',
  '那个',
  '记得',
  '说过',
  '聊过',
])

const bigrams = (text: string) => {
  const characters = Array.from(text)
  return characters.slice(1).map((character, index) => characters[index] + character)
}

const parseQuery = (query: string) => {
  const phrase = normalize(query.slice(0, 240))
  const han = phrase.match(/\p{Script=Han}+/gu) ?? []
  const terms = new Set(phrase.match(/[a-z0-9][a-z0-9_.+#-]*/g) ?? [])
  for (const part of han) {
    const words = segmenter
      ? Array.from(segmenter.segment(part), ({ segment }) => segment)
      : bigrams(part)
    for (const word of words) {
      if (word.length > 1 || part.length === 1) {
        terms.add(word)
      }
    }
  }
  return {
    phrase,
    terms: [...terms].filter((word) => !stopWords.has(word)).slice(0, 16),
    grams: [...new Set(han.flatMap(bigrams))].filter((word) => !stopWords.has(word)).slice(0, 20),
  }
}

type MemoryIndexEntry = ReturnType<typeof indexMemorySession>

export const indexMemorySession = ({ session, source }: AuthorizedSession) => ({
  localId: session.id,
  sessionId: source.publicId,
  title: session.title,
  titleText: normalize(session.title),
  updatedAt: session.updatedAt,
  messages: getMemoryMessages(session).map((message) => ({
    ...message,
    searchable: normalize(message.text),
  })),
})

export type MemorySearchHit = {
  localId: string
  sessionId: string
  title: string
  summary: string
  relevance: number
  position: number
  messageId: string
  updatedAt: number
}

const score = (
  text: string,
  { phrase, terms, grams }: ReturnType<typeof parseQuery>,
  boost: number
) => {
  const exact = text.includes(phrase)
  const coverage = terms.filter((term) => text.includes(term)).length / Math.max(1, terms.length)
  const partial = grams.filter((term) => text.includes(term)).length / Math.max(1, grams.length)
  if (!exact && coverage < 0.34 && (grams.length < 2 || partial < 0.45)) {
    return 0
  }
  return (exact ? 0.46 : 0) + 0.39 * Math.max(coverage, partial * 0.6) + boost
}

const excerpt = (text: string, query: ReturnType<typeof parseQuery>) => {
  const display = text.replace(/\s+/g, ' ').trim()
  const searchable = normalize(display)
  const terms = [query.phrase, ...query.terms, ...query.grams]
  const at = terms.map((term) => searchable.indexOf(term)).find((index) => index >= 0) ?? 0
  const start = Math.max(0, at - 36)
  const end = Math.min(display.length, start + 160)
  return `${start > 0 ? '…' : ''}${display.slice(start, end)}${end < display.length ? '…' : ''}`
}

/** One scored extract per session, computed only from its selected branch. */
export const searchMemoryIndex = (
  entries: Iterable<MemoryIndexEntry>,
  rawQuery: string,
  excludeId?: string
): MemorySearchHit[] => {
  const query = parseQuery(rawQuery)
  if (!query.phrase || (!query.terms.length && !query.grams.length)) {
    return []
  }
  const hits: MemorySearchHit[] = []
  for (const entry of entries) {
    if (entry.localId === excludeId || entry.messages.length === 0) {
      continue
    }
    let best = 0
    let position = 0
    for (const [index, message] of entry.messages.entries()) {
      const relevance = score(message.searchable, query, message.role === 'user' ? 0.09 : 0.03)
      if (relevance > best) {
        best = relevance
        position = index
      }
    }
    const relevance = Math.max(best, score(entry.titleText, query, 0.15))
    if (relevance > 0) {
      const message = entry.messages[position]
      hits.push({
        localId: entry.localId,
        sessionId: entry.sessionId,
        title: entry.title.slice(0, 120),
        summary: excerpt(message.text, query),
        relevance: Math.round(relevance * 1000) / 1000,
        position: position + 1,
        messageId: message.id,
        updatedAt: entry.updatedAt,
      })
    }
  }
  return hits.sort((a, b) => b.relevance - a.relevance || b.updatedAt - a.updatedAt).slice(0, 5)
}
