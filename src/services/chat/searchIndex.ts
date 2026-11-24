import { loadSession, readSessionBatches } from './db.js'
import { indexMemorySession, searchMemoryIndex, type MemorySearchHit } from './memorySearch.js'
import { loadMemoryProfile, readMemorySessionBatches, readMemorySessions } from './memoryStorage.js'
import { indexSession, searchChats, type ChatSearchHit, type IndexedSession } from './search.js'

export type SearchRequest = {
  query: string
  reset: boolean
  changedIds: string[]
  scope: 'chat' | 'memory'
  excludeId?: string
}

export type SearchResults = { hits: ChatSearchHit[] } | { memoryHits: MemorySearchHit[] }
export type SearchResponse = SearchResults | { error: string }

let index: Map<string, IndexedSession> | null = null
let memoryIndex: Map<string, ReturnType<typeof indexMemorySession>> | null = null
let memoryEpoch = -1

const yieldForInput = async () => {
  if (typeof window !== 'undefined') {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  }
}

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
      await yieldForInput()
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

const queryMemoryIndex = async ({ query, reset, changedIds, excludeId }: SearchRequest) => {
  const profile = await loadMemoryProfile()
  if (!profile.enabled) {
    memoryIndex = null
    return []
  }
  if (reset || !memoryIndex || profile.epoch !== memoryEpoch) {
    const entries = new Map<string, ReturnType<typeof indexMemorySession>>()
    for await (const batch of readMemorySessionBatches(profile)) {
      for (const entry of batch) {
        entries.set(entry.session.id, indexMemorySession(entry))
      }
      await yieldForInput()
    }
    memoryIndex = entries
    memoryEpoch = profile.epoch
  } else if (changedIds.length > 0) {
    const sessions = await readMemorySessions(changedIds, profile.epoch)
    for (const id of changedIds) {
      memoryIndex.delete(id)
    }
    for (const entry of sessions) {
      memoryIndex.set(entry.session.id, indexMemorySession(entry))
    }
  }
  return searchMemoryIndex(memoryIndex.values(), query, excludeId)
}

export const runSearchIndex = async (request: SearchRequest): Promise<SearchResults> =>
  request.scope === 'memory'
    ? { memoryHits: await queryMemoryIndex(request) }
    : { hits: await querySearchIndex(request) }
