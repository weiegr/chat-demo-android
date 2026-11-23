import { hasPersistentStorage, onSessionChange } from './db.js'
import type { ChatSearchHit } from './search.js'
import type { SearchRequest, SearchResponse } from './searchIndex.js'

let searchWorker: Worker | null | undefined
let searchQueue = Promise.resolve()
let revision = 0
let resetIndex = true
const changedIds = new Set<string>()
const listeners = new Set<() => void>()

onSessionChange((id) => {
  if (id === null) {
    resetIndex = true
    changedIds.clear()
  } else if (!resetIndex) {
    changedIds.add(id)
  }
  revision += 1
  for (const listener of listeners) {
    listener()
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

const queryWorker = (worker: Worker, request: SearchRequest): Promise<ChatSearchHit[]> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onError)
    }
    const onMessage = ({ data }: MessageEvent<SearchResponse>) => {
      cleanup()
      if ('hits' in data) {
        resolve(data.hits)
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
export const queryChatHistory = (query: string, signal: AbortSignal): Promise<ChatSearchHit[]> => {
  const task = searchQueue.then(async () => {
    signal.throwIfAborted()
    const worker = await getSearchWorker()
    signal.throwIfAborted()
    const request: SearchRequest = { query, reset: resetIndex, changedIds: [...changedIds] }
    resetIndex = false
    changedIds.clear()
    try {
      if (worker) {
        try {
          return await queryWorker(worker, request)
        } catch {
          worker.terminate()
          searchWorker = null
        }
      }
      const { querySearchIndex } = await import('./searchIndex.js')
      return await querySearchIndex(request)
    } catch (error) {
      resetIndex = true
      changedIds.clear()
      throw error
    }
  })
  searchQueue = task.then(
    () => {},
    () => {}
  )
  return task
}
