import * as db from '../db.js'
import type { Session, SessionMemoryState } from '../types.js'
import { EXPORT_FORMAT_VERSION, type Manifest, type SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, imagePath, sessionPath } from './paths.js'
import { toIndexEntry, toSessionFile } from './toArchive.js'
import { writeArchive, writeArchiveToSink, type ArchiveWriteEntry } from './zipWriter.js'

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

/**
 * 构建归档条目列表：只探测并记录媒体文件字节长度，不把原件 Blob 全量囤在内存中；
 * 真正写出每个媒体条目时再按需读取并流式释放。
 */
const buildArchiveEntries = async (
  sessions: Iterable<Session> | AsyncIterable<Session>,
  memoryStates?: ReadonlyMap<string, SessionMemoryState>
): Promise<ArchiveWriteEntry[]> => {
  const manifest: Manifest = { export_format_version: EXPORT_FORMAT_VERSION }
  const entries: ArchiveWriteEntry[] = [{ name: MANIFEST_PATH, blob: json(manifest) }]
  const mediaEntries: ArchiveWriteEntry[] = []
  const index: SessionIndexEntry[] = []
  const fileSizes = new Map<string, number | null>()

  for await (const session of sessions) {
    for (const message of session.messages) {
      if (message.role === 'user') {
        const media = message.files.filter((file) => file.isImage || file.audio)
        const video = message.video
        for (const file of video ? [...media, video] : media) {
          if (!fileSizes.has(file.id)) {
            const blob = await db.loadFile(file.id)
            fileSizes.set(file.id, blob ? blob.size : null)
          }
        }
      }
    }
    const media = new Map<string, { id: string; size: number }>()
    const data = toSessionFile(
      session,
      ({ id, name }) => {
        const size = fileSizes.get(id)
        if (size === undefined || size === null) {
          return null
        }
        const path = imagePath(session.id, id, name)
        media.set(path, { id, size })
        return path
      },
      memoryStates?.get(session.id)
    )
    entries.push({ name: sessionPath(session.id), blob: json(data) })
    for (const [name, { id, size }] of media) {
      mediaEntries.push({ name, size, load: () => db.loadFile(id) })
    }
    index.push(toIndexEntry(data))
  }
  entries.push({ name: INDEX_PATH, blob: json(index) })
  return entries.concat(mediaEntries)
}

/**
 * 按导出格式生成 ZIP Blob：manifest → 全部会话 JSON → index → 全部媒体。没有账号信息，不写 user.json。
 * 写出本地的图片、音视频原件，每个会话目录各写一份；文档附件只有元数据。
 */
export const exportArchive = async (
  sessions: Iterable<Session> | AsyncIterable<Session>,
  memoryStates?: ReadonlyMap<string, SessionMemoryState>
): Promise<Blob> => writeArchive(await buildArchiveEntries(sessions, memoryStates))

/** 按导出格式流式写出 ZIP 分片到外部消费端（供 Android 原生分片直写，避免整包驻留内存） */
export const exportArchiveStream = async (
  sessions: Iterable<Session> | AsyncIterable<Session>,
  onChunk: (chunk: Uint8Array) => Promise<void> | void,
  memoryStates?: ReadonlyMap<string, SessionMemoryState>
): Promise<void> => {
  const entries = await buildArchiveEntries(sessions, memoryStates)
  await writeArchiveToSink(entries, onChunk)
}
