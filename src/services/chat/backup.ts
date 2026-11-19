import { formatDate } from '../../utils/format.js'
import * as db from './db.js'
import { BackupError } from './history/errors.js'
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

/** 导出为历史会话导出格式的 ZIP，可再次导入。 */
export const exportHistory = (): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    // 正在生成的回复还只在草稿槽里，先并入会话，导出的才是当前看到的内容。
    commitDraftReplies()
    // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
    const { sessions, sessionCache } = useChatStore.getState()
    async function* readSessions(): AsyncGenerator<Session> {
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
    const { exportArchive } = await import('./history/exportArchive.js')
    const now = new Date()
    const blob = await exportArchive(readSessions())
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
  saveExportFile?: (requestId: number, base64: string, fileName: string, mimeType: string) => void
  openDownloadsFolder?: () => boolean
}

interface AndroidExportEventDetail {
  requestId?: number
  ok?: boolean
  fileName?: string
  path?: string
  message?: string
}

const getAndroidExportBridge = (): AndroidExportBridge | undefined =>
  (window as Window & { AndroidHost?: AndroidExportBridge }).AndroidHost

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

/** 导出全部历史会话并保存到设备（Android 写入系统下载目录并返回真实路径，Web 触发浏览器下载） */
export const exportAndSaveHistory = async (): Promise<ExportRecord> => {
  const { name, blob } = await exportHistory()
  const bridge = getAndroidExportBridge()
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

/**
 * 确认覆盖后调用：先检查 ZIP 格式与版本，校验失败时保留正在生成的回答；
 * 通过后从 ZIP 流式写入暂存，成功才替换原有会话与图片原件。返回导入的会话数。
 */
export const importHistory = (file: File): Promise<number> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    return replaceHistory(() => importArchive(file))
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

/**
 * 通过 DeepSeek 历史对话导出 URL 直接下载 ZIP 并覆盖导入。
 * Android WebView 下通过同源原生代理绕过跨站 CORS 限制，校验通过后再替换本地数据。
 */
export const importHistoryFromUrl = async (
  rawUrl: string,
  signal?: AbortSignal
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

  const blob = await response.blob()
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  }
  if (blob.size === 0) {
    throw new BackupError('backupUnrecognized')
  }

  const file = new File([blob], 'deepseek-history.zip', {
    type: blob.type || 'application/zip',
  })
  return importHistory(file)
}

/** 确认删除后调用：以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await replaceHistory(async () => {})
  })
