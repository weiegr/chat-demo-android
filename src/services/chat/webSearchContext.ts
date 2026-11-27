import { formatDate } from '../../utils/format.js'
import type { WebSearchResult, WebSearchToolResultBlock } from '../api/types.js'
import type { AssistantMessage, ReplyBlock } from './types.js'

const MAX_SOURCES = 6
const MAX_QUERIES = 4
const clip = (text: string | null | undefined, limit: number) =>
  (text ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)

const isTextSearchResult = (block: ReplyBlock): block is WebSearchToolResultBlock =>
  block.type === 'web_search_tool_result' &&
  (block.kind === 'search' || block.kind === 'deep_search')

const usableUrl = (url: string) => url.length <= 384 && /^https?:\/\/[^\s]+$/i.test(url)

const isSource = (item: WebSearchToolResultBlock['content'][number]): item is WebSearchResult =>
  item.type === 'web_search_result' && usableUrl(item.url)

const openedPage = (block: ReplyBlock) =>
  block.type === 'web_fetch_tool_result' &&
  block.content.type === 'web_fetch_result' &&
  usableUrl(block.content.url) &&
  (block.kind === 'deep_search' || block.content.content.source?.data)
    ? block.content
    : undefined

export const hasWebSearchRecord = (reply: AssistantMessage) =>
  reply.blocks.some(
    (block) => (isTextSearchResult(block) && block.content.some(isSource)) || openedPage(block)
  )

/** 回传历史搜索工具块也无法让模型看到其结果，用本地保存的摘录恢复依据。 */
export const buildWebSearchRecord = (reply: AssistantMessage): string => {
  const results = reply.blocks
    .filter(isTextSearchResult)
    .filter((block) => block.content.some(isSource))
  const resultIds = new Set(results.map((block) => block.tool_use_id))
  const queries = new Set<string>()
  const sources = new Map<
    string,
    { url: string; title: string; snippet?: string; opened: boolean }
  >()

  const addSource = (
    url: string,
    title: string | null,
    snippet: string | null,
    opened: boolean
  ) => {
    const existing = sources.get(url)
    if ((!existing && sources.size >= MAX_SOURCES) || existing?.snippet) {
      return
    }
    sources.set(url, {
      url,
      title: existing?.title || clip(title, 120),
      snippet: clip(snippet, 220) || undefined,
      opened: opened || (existing?.opened ?? false),
    })
  }

  // 优先纳入工具实际打开的网页，再补充检索摘录和其他结果。
  for (const block of reply.blocks) {
    const page = openedPage(block)
    if (page) {
      addSource(page.url, page.content.title, page.content.source?.data ?? null, true)
    } else if (
      block.type === 'server_tool_use' &&
      block.input.action === 'search' &&
      resultIds.has(block.id)
    ) {
      for (const query of block.input.queries) {
        if (queries.size >= MAX_QUERIES) {
          break
        }
        const shortened = clip(query, 120)
        if (shortened) {
          queries.add(shortened)
        }
      }
    }
  }

  for (const result of results) {
    for (const item of result.content) {
      if (isSource(item)) {
        addSource(item.url, item.title, item.snippet, false)
      }
    }
  }

  const record = {
    date: formatDate(reply.createdAt),
    queries: [...queries],
    returnedResults: sources.size > 0,
    sources: [...sources.values()],
  }
  return `【该轮网页检索记录（客户端附加）】\n${JSON.stringify(record)}`
}
