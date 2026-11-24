import { hasPersistentStorage, onMemoryChange, onSessionChange } from './db.js'
import type { MemorySearchHit } from './memorySearch.js'
import type { ChatSearchHit } from './search.js'
import type { SearchRequest, SearchResponse, SearchResults } from './searchIndex.js'

let searchWorker: Worker | null | undefined
let searchQueue = Promise.resolve()
let revision = 0
const indexes = {
  chat: { reset: true, changedIds: new Set<string>() },
  memory: { reset: true, changedIds: new Set<string>() },
}
const listeners = new Set<() => void>()

onSessionChange((id) => {
  for (const index of Object.values(indexes)) {
    if (id === null) {
      index.reset = true
      index.changedIds.clear()
    } else if (!index.reset) {
      index.changedIds.add(id)
    }
  }
  revision += 1
  for (const listener of listeners) {
    listener()
  }
})

onMemoryChange((change, sessionId) => {
  if (change === 'sources') {
    if (sessionId === undefined) {
      indexes.memory.reset = true
      indexes.memory.changedIds.clear()
    } else if (!indexes.memory.reset) {
      indexes.memory.changedIds.add(sessionId)
    }
  }
})

export const getSearchRevision = () => revision

export const subscribeToSearchChanges = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSearchWorker = async () => {
  if (searchWorker !== undefined) {
    return searchWorker
  }
  searchWorker = null
  if (!__SINGLE_FILE__ && typeof Worker !== 'undefined' && (await hasPersistentStorage())) {
    try {
      searchWorker = new Worker(new URL('./searchWorker.ts', import.meta.url), {
        name: 'chat-history-search',
      })
    } catch {
      // 文件来源或受限环境不一定允许加载 Worker，使用当前页面的存储。
    }
  }
  return searchWorker
}

const queryWorker = (worker: Worker, request: SearchRequest): Promise<SearchResults> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onError)
    }
    const onMessage = ({ data }: MessageEvent<SearchResponse>) => {
      cleanup()
      if (!('error' in data)) {
        resolve(data)
      } else {
        reject(new Error(data.error))
      }
    }
    const onError = (event: Event) => {
      event.preventDefault()
      cleanup()
      reject(new Error('Search Worker failed'))
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.addEventListener('messageerror', onError)
    try {
      worker.postMessage(request)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })

/** 串行消费写入变更。连续输入时，排队中已过期的查询会在读库前跳过。 */
const queryIndex = (
  scope: SearchRequest['scope'],
  query: string,
  signal: AbortSignal,
  excludeId?: string
) => {
  const task = searchQueue.then(async () => {
    signal.throwIfAborted()
    const worker = await getSearchWorker()
    signal.throwIfAborted()
    const index = indexes[scope]
    const request: SearchRequest = {
      scope,
      query,
      excludeId,
      reset: index.reset,
      changedIds: [...index.changedIds],
    }
    index.reset = false
    index.changedIds.clear()
    try {
      if (worker) {
        try {
          return await queryWorker(worker, request)
        } catch {
          worker.terminate()
          searchWorker = null
          indexes.chat.reset = true
          indexes.memory.reset = true
          request.reset = true
        }
      }
      const { runSearchIndex } = await import('./searchIndex.js')
      return await runSearchIndex(request)
    } catch (error) {
      index.reset = true
      index.changedIds.clear()
      throw error
    }
  })
  searchQueue = task.then(
    () => {},
    () => {}
  )
  return task
}

export const queryChatHistory = async (
  query: string,
  signal: AbortSignal
): Promise<ChatSearchHit[]> => {
  const result = await queryIndex('chat', query, signal)
  return 'hits' in result ? result.hits : []
}

export const queryMemoryHistory = async (
  query: string,
  signal: AbortSignal,
  excludeId?: string
): Promise<MemorySearchHit[]> => {
  const result = await queryIndex('memory', query, signal, excludeId)
  signal.throwIfAborted()
  return 'memoryHits' in result ? result.memoryHits : []
}
