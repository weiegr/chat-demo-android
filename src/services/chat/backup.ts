import { formatDate } from '../../utils/format.js'
import * as db from './db.js'
import { BackupError } from './history/errors.js'
import { listSessionMemoryStates } from './memoryStorage.js'
import { commitDraftReplies, replaceHistory, useChatStore } from './store.js'
import type { Session } from './types.js'

export { BackupError } from './history/errors.js'

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

const createSessionSnapshotReader = () => {
  // 正在生成的回复还只在草稿槽里，先并入会话，导出的才是当前看到的内容。
  commitDraftReplies()
  // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
  const { sessions, sessionCache } = useChatStore.getState()
  return async function* readSessions(): AsyncGenerator<Session> {
    for (const summary of sessions) {
      const session = Object.hasOwn(sessionCache, summary.id)
        ? sessionCache[summary.id]
        : await db.loadSession(summary.id)
      if (!session) {
        throw new Error(`History session disappeared during export: ${summary.id}`)
      }
      // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
      yield { ...session, ...summary }
    }
  }
}

/** 导出为历史会话导出格式的 ZIP，可再次导入。 */
export const exportHistory = (): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    const readSessions = createSessionSnapshotReader()
    const { exportArchive } = await import('./history/exportArchive.js')
    const memoryStates = __BETA__ ? await listSessionMemoryStates() : undefined
    const now = new Date()
    const blob = await exportArchive(readSessions(), memoryStates)
    return { name: backupFileName(now), blob }
  })

export type ExportRecord = {
  exportedAt: number
  fileName: string
  path?: string
  isAndroid: boolean
}

const LAST_EXPORT_KEY = 'chat-demo:last-export'
let nextExportRequestId = 1

export const getLastExportRecord = (): ExportRecord | null => {
  try {
    const raw = localStorage.getItem(LAST_EXPORT_KEY)
    if (!raw) {
      return null
    }
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as ExportRecord).exportedAt === 'number' &&
      typeof (parsed as ExportRecord).fileName === 'string' &&
      typeof (parsed as ExportRecord).isAndroid === 'boolean'
    ) {
      const rec = parsed as ExportRecord
      return {
        exportedAt: rec.exportedAt,
        fileName: rec.fileName,
        isAndroid: rec.isAndroid,
        ...(typeof rec.path === 'string' ? { path: rec.path } : {}),
      }
    }
    return null
  } catch {
    return null
  }
}

const saveLastExportRecord = (record: ExportRecord) => {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, JSON.stringify(record))
  } catch {
    // 隐私模式或存储受限时忽略持久化
  }
}

interface AndroidExportBridge {
  supportsChunkedExport?: () => boolean
  beginExportFile?: (requestId: number, fileName: string, mimeType: string) => void
  writeExportChunk?: (requestId: number, seq: number, base64Chunk: string) => void
  finishExportFile?: (requestId: number) => void
  abortExportFile?: (requestId: number) => void
  saveExportFile?: (requestId: number, base64: string, fileName: string, mimeType: string) => void
  openDownloadsFolder?: () => boolean
}

type AndroidChunkedExportBridge = Required<
  Pick<
    AndroidExportBridge,
    'beginExportFile' | 'writeExportChunk' | 'finishExportFile' | 'abortExportFile'
  >
>

interface AndroidExportEventDetail {
  requestId?: number
  ok?: boolean
  fileName?: string
  path?: string
  message?: string
}

interface AndroidExportStepDetail {
  requestId?: number
  seq?: number
  ok?: boolean
  message?: string
}

const getAndroidExportBridge = (): AndroidExportBridge | undefined =>
  (window as Window & { AndroidHost?: AndroidExportBridge }).AndroidHost

const hasChunkedAndroidExport = (
  bridge: AndroidExportBridge | undefined
): bridge is AndroidChunkedExportBridge =>
  Boolean(
    bridge?.supportsChunkedExport?.() &&
    bridge.beginExportFile &&
    bridge.writeExportChunk &&
    bridge.finishExportFile &&
    bridge.abortExportFile
  )

const bytesToBase64 = (bytes: Uint8Array): string => {
  const step = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.byteLength; offset += step) {
    const end = Math.min(bytes.byteLength, offset + step)
    const slice = bytes.subarray(offset, end)
    let part = ''
    for (let i = 0; i < slice.length; i++) {
      part += String.fromCharCode(slice[i])
    }
    binary += part
  }
  return btoa(binary)
}

const waitExportStep = (requestId: number, seq: number, trigger: () => void): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('android-export-step', onStep)
    }
    const onStep = (event: Event) => {
      const detail = (event as CustomEvent<AndroidExportStepDetail | undefined>).detail
      if (!detail || detail.requestId !== requestId || detail.seq !== seq) {
        return
      }
      cleanup()
      if (detail.ok) {
        resolve()
      } else {
        reject(new Error(detail.message || 'Failed to write export chunk'))
      }
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Export timed out'))
    }, 60_000)

    window.addEventListener('android-export-step', onStep)
    try {
      trigger()
    } catch (error) {
      cleanup()
      reject(error instanceof Error ? error : new Error('Failed to write export chunk'))
    }
  })

const waitExportFinish = (
  requestId: number,
  name: string,
  trigger: () => void
): Promise<{ fileName: string; path: string }> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('android-export-result', onResult)
    }
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AndroidExportEventDetail | undefined>).detail
      if (!detail || detail.requestId !== requestId) {
        return
      }
      cleanup()
      if (detail.ok && detail.path) {
        resolve({ fileName: detail.fileName || name, path: detail.path })
      } else {
        reject(new Error(detail.message || 'Failed to save archive'))
      }
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Export timed out'))
    }, 60_000)

    window.addEventListener('android-export-result', onResult)
    try {
      trigger()
    } catch (error) {
      cleanup()
      reject(error instanceof Error ? error : new Error('Failed to save archive'))
    }
  })

const exportStreamToAndroid = (
  bridge: AndroidChunkedExportBridge
): Promise<{ fileName: string; path: string }> =>
  enqueueBackup(async () => {
    const readSessions = createSessionSnapshotReader()
    const { exportArchiveStream } = await import('./history/exportArchive.js')
    const memoryStates = __BETA__ ? await listSessionMemoryStates() : undefined
    const name = backupFileName(new Date())
    const requestId = nextExportRequestId++
    let opened = false
    let seq = 1
    try {
      await waitExportStep(requestId, 0, () => {
        bridge.beginExportFile(requestId, name, 'application/zip')
      })
      opened = true
      await exportArchiveStream(
        readSessions(),
        async (chunk) => {
          if (chunk.byteLength === 0) {
            return
          }
          const currentSeq = seq++
          const base64Chunk = bytesToBase64(chunk)
          await waitExportStep(requestId, currentSeq, () => {
            bridge.writeExportChunk(requestId, currentSeq, base64Chunk)
          })
        },
        memoryStates
      )
      opened = false
      return await waitExportFinish(requestId, name, () => {
        bridge.finishExportFile(requestId)
      })
    } catch (error) {
      if (opened) {
        try {
          bridge.abortExportFile(requestId)
        } catch {
          // 忽略清理异常，保留原始导出错误
        }
      }
      throw error
    }
  })

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const commaIndex = result.indexOf(',')
      if (commaIndex === -1) {
        reject(new Error('Failed to encode archive'))
        return
      }
      resolve(result.slice(commaIndex + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read archive'))
    reader.readAsDataURL(blob)
  })

const saveBlobInAndroid = async (
  bridge: Required<Pick<AndroidExportBridge, 'saveExportFile'>>,
  name: string,
  blob: Blob
): Promise<{ fileName: string; path: string }> => {
  const base64 = await blobToBase64(blob)
  const requestId = nextExportRequestId++
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('android-export-result', onResult)
    }
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AndroidExportEventDetail | undefined>).detail
      if (!detail || detail.requestId !== requestId) {
        return
      }
      cleanup()
      if (detail.ok && detail.path) {
        resolve({ fileName: detail.fileName || name, path: detail.path })
      } else {
        reject(new Error(detail.message || 'Failed to save archive'))
      }
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Export timed out'))
    }, 60_000)

    window.addEventListener('android-export-result', onResult)
    bridge.saveExportFile(requestId, base64, name, blob.type || 'application/zip')
  })
}

const triggerBrowserDownload = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 导出全部历史会话并保存到设备（Android 流式分片直写系统下载目录并返回真实路径，Web 触发浏览器下载） */
export const exportAndSaveHistory = async (): Promise<ExportRecord> => {
  const bridge = getAndroidExportBridge()
  if (hasChunkedAndroidExport(bridge)) {
    const saved = await exportStreamToAndroid(bridge)
    const record: ExportRecord = {
      exportedAt: Date.now(),
      fileName: saved.fileName,
      path: saved.path,
      isAndroid: true,
    }
    saveLastExportRecord(record)
    return record
  }
  const { name, blob } = await exportHistory()
  if (bridge?.saveExportFile) {
    const saved = await saveBlobInAndroid(
      bridge as Required<Pick<AndroidExportBridge, 'saveExportFile'>>,
      name,
      blob
    )
    const record: ExportRecord = {
      exportedAt: Date.now(),
      fileName: saved.fileName,
      path: saved.path,
      isAndroid: true,
    }
    saveLastExportRecord(record)
    return record
  }
  triggerBrowserDownload(name, blob)
  const record: ExportRecord = {
    exportedAt: Date.now(),
    fileName: name,
    isAndroid: false,
  }
  saveLastExportRecord(record)
  return record
}

/** 是否支持在当前宿主打开系统下载目录（Android 原生桥接可用时返回 true） */
export const canOpenExportFolder = (): boolean =>
  Boolean(getAndroidExportBridge()?.openDownloadsFolder)

/** 打开系统下载目录以查看导出的备份文件 */
export const openExportFolder = (): boolean => {
  try {
    return Boolean(getAndroidExportBridge()?.openDownloadsFolder?.())
  } catch {
    return false
  }
}

export type HistoryImportProgress =
  | { stage: 'preparing' }
  | { stage: 'reading'; bytesRead: number; percent: number; sessionCount: number }
  | { stage: 'saving'; sessionCount: number }

/**
 * 确认覆盖后调用：先检查 ZIP 格式与版本，校验失败时保留正在生成的回答；
 * 通过后从 ZIP 流式写入暂存，成功才替换原有会话与图片原件。返回导入的会话数。
 */
export const importHistory = (
  file: File,
  onProgress?: (progress: HistoryImportProgress) => void
): Promise<number> =>
  enqueueBackup(async () => {
    onProgress?.({ stage: 'preparing' })
    const { prepareArchiveImport } = await import('./history/importArchive.js')
    let latestSessionCount = 0
    const totalSize = Math.max(1, file.size)
    const importToStaging = await prepareArchiveImport(file, ({ bytesRead, sessionCount }) => {
      latestSessionCount = sessionCount
      onProgress?.({
        stage: 'reading',
        bytesRead,
        percent: Math.min(99, Math.floor((bytesRead / totalSize) * 100)),
        sessionCount,
      })
    })
    return replaceHistory(importToStaging, () =>
      onProgress?.({ stage: 'saving', sessionCount: latestSessionCount })
    )
  })

interface AndroidDownloadBridge {
  hasUrlDownloadProxy?: () => boolean
}

const getAndroidDownloadBridge = (): AndroidDownloadBridge | undefined =>
  (window as Window & { AndroidHost?: AndroidDownloadBridge }).AndroidHost

/** 从输入文本中提取并校验 HTTP/HTTPS 下载链接 */
export const parseArchiveDownloadUrl = (raw: string): string => {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new BackupError('historyUrlInvalid')
  }
  const match = /https?:\/\/\S+/i.exec(trimmed)
  const candidate = match ? match[0].replace(/[),.;'"`>\]}]+$/, '') : trimmed
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BackupError('historyUrlInvalid')
    }
    return parsed.toString()
  } catch (error) {
    if (error instanceof BackupError) {
      throw error
    }
    throw new BackupError('historyUrlInvalid')
  }
}

export type HistoryUrlImportProgress = { percent: number } | { downloadedBytes: number }

/**
 * 通过 DeepSeek 历史对话导出 URL 直接下载 ZIP 并覆盖导入。
 * Android WebView 下通过同源原生代理绕过跨站 CORS 限制，校验通过后再替换本地数据。
 */
export const importHistoryFromUrl = async (
  rawUrl: string,
  signal?: AbortSignal,
  onProgress?: (progress: HistoryUrlImportProgress) => void
): Promise<number> => {
  const targetUrl = parseArchiveDownloadUrl(rawUrl)
  const useAndroidProxy = Boolean(getAndroidDownloadBridge()?.hasUrlDownloadProxy?.())
  const fetchUrl = useAndroidProxy
    ? `${window.location.origin}/__android_proxy__?url=${encodeURIComponent(targetUrl)}`
    : targetUrl

  let response: Response
  try {
    response = await fetch(fetchUrl, { signal })
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    throw new BackupError('historyUrlNetworkError')
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 404 || response.status === 410) {
      throw new BackupError('historyUrlExpiredOrNotFound')
    }
    throw new BackupError('historyUrlHttpFailed', { status: response.status })
  }

  // 下载与归档读取共用一条进度，成功替换历史后才报 100%。
  const downloadWeight = 70
  let lastPercent = -1
  const reportPercent = (percent: number) => {
    if (percent !== lastPercent) {
      lastPercent = percent
      onProgress?.({ percent })
    }
  }

  let download = response
  if (onProgress && response.body) {
    const proxyLength = useAndroidProxy ? response.headers.get('X-Archive-Content-Length') : null
    const length = Number(proxyLength ?? response.headers.get('Content-Length'))
    const encoding = response.headers.get('Content-Encoding')
    const hasTotal =
      Number.isSafeInteger(length) && length > 0 && (!encoding || encoding === 'identity')
    let downloadedBytes = 0
    let lastBytesUpdate = -Infinity
    const stream = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          downloadedBytes += chunk.byteLength
          if (hasTotal) {
            reportPercent(
              Math.min(downloadWeight - 1, Math.floor((downloadedBytes / length) * downloadWeight))
            )
          } else {
            const now = performance.now()
            if (now - lastBytesUpdate >= 100) {
              lastBytesUpdate = now
              onProgress({ downloadedBytes })
            }
          }
          controller.enqueue(chunk)
        },
      })
    )
    download = new Response(stream, { headers: response.headers })
  }

  const blob = await download.blob()
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  }
  if (blob.size === 0) {
    throw new BackupError('backupUnrecognized')
  }

  const file = new File([blob], 'deepseek-history.zip', {
    type: blob.type || 'application/zip',
  })
  reportPercent(downloadWeight)
  const count = await importHistory(
    file,
    onProgress &&
      ((progress) => {
        if (progress.stage === 'reading') {
          reportPercent(
            Math.min(
              99,
              downloadWeight +
                Math.floor((progress.bytesRead / Math.max(1, file.size)) * (100 - downloadWeight))
            )
          )
        } else if (progress.stage === 'saving') {
          reportPercent(99)
        }
      })
  )
  reportPercent(100)
  return count
}

/** 确认删除后调用：以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await replaceHistory(async () => {})
  })
