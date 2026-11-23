import { hasPersistentStorage } from './db.js'
import { querySearchIndex, type SearchRequest, type SearchResponse } from './searchIndex.js'

self.addEventListener('message', async ({ data }: MessageEvent<SearchRequest>) => {
  let response: SearchResponse
  try {
    if (!(await hasPersistentStorage())) {
      throw new Error('Search Worker cannot access the chat database')
    }
    response = { hits: await querySearchIndex(data) }
  } catch (error) {
    response = { error: String(error) }
  }
  self.postMessage(response)
})
