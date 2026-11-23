import { loadSession, readSessionBatches } from './db.js'
import { indexSession, searchChats, type ChatSearchHit, type IndexedSession } from './search.js'

export type SearchRequest = {
  query: string
  reset: boolean
  changedIds: string[]
}

export type SearchResponse = { hits: ChatSearchHit[] } | { error: string }

let index: Map<string, IndexedSession> | null = null

/** Worker 与单文件版共用索引逻辑，已索引的会话仅在写入后重读。 */
export const querySearchIndex = async ({
  query,
  reset,
  changedIds,
}: SearchRequest): Promise<ChatSearchHit[]> => {
  if (reset || index === null) {
    index = null
    const nextIndex = new Map<string, IndexedSession>()
    for await (const sessions of readSessionBatches()) {
      for (const session of sessions) {
        const entry = indexSession(session)
        if (entry.title || entry.messages.length > 0) {
          nextIndex.set(entry.id, entry)
        }
      }
      // 没有 Worker 的构建也要在批次间给界面一次处理输入的机会。
      if (typeof window !== 'undefined') {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      }
    }
    index = nextIndex
  } else if (changedIds.length > 0) {
    const sessions = await Promise.all(changedIds.map(loadSession))
    for (const [position, session] of sessions.entries()) {
      if (session) {
        index.set(session.id, indexSession(session))
      } else {
        index.delete(changedIds[position])
      }
    }
  }
  return searchChats(index.values(), query)
}
