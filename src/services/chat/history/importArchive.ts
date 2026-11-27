import * as db from '../db.js'
import type { Session } from '../types.js'
import { BackupError, fail } from './errors.js'
import type { SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, USER_PATH, parseSessionPath, sessionFilesDir } from './paths.js'
import { checkManifest, readSessionFile, readSessionIndex } from './schema.js'
import { toLocalSession, type LocalSession } from './toLocal.js'
import {
  ArchiveError,
  isZipFile,
  readArchive,
  readEntry,
  skipEntry,
  type ArchiveEntry,
} from './zipReader.js'

const STAGING_BATCH_COUNT = 32
const STAGING_BATCH_BYTES = 1024 * 1024

/** 从原件字节补充图片 MIME；无法识别时为空字符串，图片身份仍由归档的 is_image 决定。 */
const imageType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0) || startsWith(0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

const readJson = async (entry: ArchiveEntry): Promise<unknown> => {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of entry.stream) {
    text += decoder.decode(chunk, { stream: true })
  }
  text += decoder.decode()
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
}

export type ArchiveImportProgress = {
  bytesRead: number
  sessionCount: number
}

/** 先验证 ZIP 和清单版本，返回从同一读取位置继续写入暂存区的操作。 */
export const prepareArchiveImport = async (
  file: File,
  onProgress?: (progress: ArchiveImportProgress) => void
): Promise<() => Promise<void>> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  const imported = new Set<string>()
  let bytesRead = 0
  let reading = false
  const reportProgress = () => onProgress?.({ bytesRead, sessionCount: imported.size })
  const entries = readArchive(file, (position) => {
    bytesRead = position
    if (reading) {
      reportProgress()
    }
  })
  try {
    const first = await entries.next()
    const entry = first.done ? fail('backupUnrecognized') : first.value
    if (entry.path !== MANIFEST_PATH) {
      fail('backupUnrecognized')
    }
    checkManifest(await readJson(entry))
  } catch (error) {
    await entries.return(undefined)
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  return () => {
    reading = true
    reportProgress()
    return importArchive(entries, imported, reportProgress)
  }
}

/**
 * 清单已检查，继续流式处理 user（不导入）→ 全部会话 JSON → index → 全部媒体原件。
 * 也支持会话与媒体原件交错排列、index 位于末尾的条目顺序。
 * 会话按条数和解压大小分批暂存；原件全部读完后逐会话回填图片 MIME。
 * 写入导入暂存存储；调用方负责先清空暂存，成功后替换正式数据，失败时清理暂存。
 */
const importArchive = async (
  entries: AsyncIterable<ArchiveEntry>,
  imported: Set<string>,
  reportProgress: () => void
): Promise<void> => {
  const originals: LocalSession['originals'] = new Map()
  /** 普通附件与只用于本地播放的音视频原件不得共用文件 ID。 */
  type FileKind = 'attachment' | 'audio' | 'video'
  const fileKinds = new Map<string, FileKind>()
  /** 已保存的原件：文件 ID → MIME。同一图片出现在多个会话目录时只保存一次。 */
  const stored = new Map<string, string>()
  const batch: Session[] = []
  let batchBytes = 0
  let index: SessionIndexEntry[] | undefined
  let currentSessionId: string | undefined

  const flushSessions = async () => {
    if (batch.length > 0) {
      await db.addStagingSessions(batch)
      batch.length = 0
      batchBytes = 0
    }
  }

  const saveOriginal = async (
    entry: ArchiveEntry,
    { id, mediaType }: { id: string; mediaType?: string }
  ) => {
    if (stored.has(id)) {
      await skipEntry(entry)
      return
    }
    const data = await readEntry(entry)
    const type = mediaType ?? imageType(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
    await db.saveStagingFiles([{ id, blob: new Blob([data], { type }) }])
    stored.set(id, type)
  }

  const registerFile = (id: string, kind: FileKind) => {
    const previous = fileKinds.get(id)
    if (previous && previous !== kind) {
      fail('backupInvalidFiles')
    }
    fileKinds.set(id, kind)
  }

  try {
    for await (const entry of entries) {
      const { path } = entry
      const sessionId = parseSessionPath(path)
      if (path === USER_PATH && !index && imported.size === 0) {
        // 账号信息（已脱敏）不导入；文件可能缺失。
        await skipEntry(entry)
      } else if (sessionId !== null && !index) {
        const local = toLocalSession(readSessionFile(await readJson(entry)))
        if (local.session.id !== sessionId || imported.has(sessionId)) {
          fail('backupIncomplete')
        }
        imported.add(sessionId)
        currentSessionId = sessionId
        for (const message of local.session.messages) {
          if (message.role === 'user') {
            message.files.forEach((file) =>
              registerFile(file.id, file.audio ? 'audio' : 'attachment')
            )
            if (message.video) {
              registerFile(message.video.id, 'video')
            }
          }
        }
        for (const [mediaPath, original] of local.originals) {
          originals.set(mediaPath, original)
        }
        batch.push(local.session)
        batchBytes += entry.size
        if (batch.length >= STAGING_BATCH_COUNT || batchBytes >= STAGING_BATCH_BYTES) {
          await flushSessions()
        }
        reportProgress()
      } else if (path === INDEX_PATH && !index) {
        index = readSessionIndex(await readJson(entry))
      } else if (
        index
          ? imported.has(/^chat_sessions\/([^/]+)_files\//.exec(path)?.[1] ?? '')
          : currentSessionId && path.startsWith(sessionFilesDir(currentSessionId))
      ) {
        // 没有被引用的条目不保存；缺失原件时仍保留附件信息。
        const original = originals.get(path)
        await (original ? saveOriginal(entry, original) : skipEntry(entry))
      } else {
        fail('backupIncomplete')
      }
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  // index 只列出成功写出的会话，与会话文件一一对应。
  const listed = new Set(index?.map((entry) => entry.id))
  if (
    !index ||
    listed.size !== index.length ||
    listed.size !== imported.size ||
    [...imported].some((id) => !listed.has(id))
  ) {
    fail('backupIncomplete')
  }
  await flushSessions()
  if (stored.size > 0) {
    await db.updateStagingFileTypes(stored)
  }
}
