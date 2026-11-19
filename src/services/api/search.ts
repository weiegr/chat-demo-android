import { API_ORIGIN, ApiError, request, streamMessage } from './client.js'

/**
 * 独立网页搜索接口：POST /v1/tools/search（JSON，鉴权 Authorization: Bearer）。
 * 与具体模型无关，供 deepseek-v4-pro（不支持服务端 deepseek_web_search 工具）旁路搜索使用：
 * 发送前客户端先搜好结果，注入提问文本让模型基于结果作答。
 */
const SEARCH_URL = `${API_ORIGIN}/v1/tools/search`

/** 查询词长度上限（服务端约束 1~128 个 Unicode 字符） */
export const SEARCH_QUERY_MAX_CHARS = 128

/** 独立搜索接口返回的单条结果；summary 约 600~800 字符适合给模型阅读，snippet 适合前端展示 */
export type SearchApiResult = {
  title: string
  url: string
  snippet: string
  summary: string
  site_name: string | null
  site_icon: string | null
  /** RFC 3339 UTC 时间，没有发布时间时为 null */
  date: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** 宽松提取结果的展示与注入字段，形状异常的条目直接丢弃 */
const toSearchResult = (value: unknown): SearchApiResult | null => {
  if (!isRecord(value) || typeof value.url !== 'string' || !value.url) {
    return null
  }
  return {
    title: typeof value.title === 'string' ? value.title : '',
    url: value.url,
    snippet: typeof value.snippet === 'string' ? value.snippet : '',
    summary: typeof value.summary === 'string' ? value.summary : '',
    site_name: typeof value.site_name === 'string' ? value.site_name : null,
    site_icon: typeof value.site_icon === 'string' ? value.site_icon : null,
    date: typeof value.date === 'string' ? value.date : null,
  }
}

/** 按查询词搜索网页，返回结果列表；无结果时为空数组 */
export const searchWeb = async (
  apiKey: string,
  { query, oriQuestion, count = 8 }: { query: string; oriQuestion?: string; count?: number },
  signal: AbortSignal
): Promise<SearchApiResult[]> => {
  const response = await request(SEARCH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      ori_question: oriQuestion ?? '',
      count,
      need_content: false,
    }),
    signal,
  })
  const raw = (await response.text()).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiError('protocol', raw)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    throw new ApiError('protocol', raw)
  }
  return parsed.results.map(toSearchResult).filter((item): item is SearchApiResult => item !== null)
}

/** 按服务端约束把查询词清洗并截断到 128 个 Unicode 字符 */
export const truncateSearchQuery = (text: string): string =>
  Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, SEARCH_QUERY_MAX_CHARS).join('').trim()

/**
 * 用 deepseek-flash 把用户问题改写成适合网页搜索的查询词。
 * 非思考短调用，输出首行即查询词；空输出抛错，由调用方降级为原问题截断。
 */
export const rewriteSearchQuery = async (
  apiKey: string,
  question: string,
  signal: AbortSignal
): Promise<string> => {
  const events = streamMessage(
    apiKey,
    {
      model: 'deepseek-flash',
      system: '',
      messages: [
        {
          role: 'user',
          content: `把下面的用户问题改写成一个适合网页搜索的查询词，只输出查询词本身，不要解释、引号或其他多余内容。\n\n用户问题：${truncateSearchQuery(question)}`,
        },
      ],
      thinking: { type: 'disabled' },
    },
    signal
  )
  let text = ''
  for await (const event of events) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '')
  const cleaned = (firstLine ?? '').replace(/^["'「『`]+|["'」』`]+$/g, '').trim()
  if (!cleaned) {
    throw new ApiError('protocol', text)
  }
  return truncateSearchQuery(cleaned)
}
