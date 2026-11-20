import { useEffect, useState } from 'react'
import { loadFile } from '../../services/chat/db.js'
import { loadSessionAttachment } from '../../services/chat/store.js'

/** 原件从 IndexedDB 读出并生成本地地址；undefined 表示加载中，null 表示原件缺失。 */
export const useFileUrl = (id: string, sessionId?: string) => {
  const [fileUrl, setFileUrl] = useState<{ id: string; url: string | null } | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    const source = sessionId === undefined ? loadFile(id) : loadSessionAttachment(sessionId, id)
    const resolve = (blob: Blob | undefined) => {
      if (!cancelled) {
        objectUrl = blob ? URL.createObjectURL(blob) : null
        setFileUrl({ id, url: objectUrl })
      }
    }
    void source.then(resolve, () => resolve(undefined))
    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [id, sessionId])
  return fileUrl?.id === id ? fileUrl.url : undefined
}
