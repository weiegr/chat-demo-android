import * as db from '../db.js'
import type { Session, SessionMemoryState } from '../types.js'
import { EXPORT_FORMAT_VERSION, type Manifest, type SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, imagePath, sessionPath } from './paths.js'
import { toIndexEntry, toSessionFile } from './toArchive.js'
import { writeArchive } from './zipWriter.js'

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

/**
 * 按导出格式生成 ZIP：manifest → 全部会话 JSON → index → 全部图片。没有账号信息，不写 user.json。
 * 写出本地的图片、音视频原件，每个会话目录各写一份；文档附件只有元数据。
 */
export const exportArchive = async (
  sessions: Iterable<Session> | AsyncIterable<Session>,
  memoryStates?: ReadonlyMap<string, SessionMemoryState>
): Promise<Blob> => {
  const manifest: Manifest = { export_format_version: EXPORT_FORMAT_VERSION }
  const entries = [{ name: MANIFEST_PATH, blob: json(manifest) }]
  const mediaEntries: { name: string; blob: Blob }[] = []
  const index: SessionIndexEntry[] = []
  const originals = new Map<string, Blob | undefined>()
  for await (const session of sessions) {
    for (const message of session.messages) {
      if (message.role === 'user') {
        const media = message.files.filter((file) => file.isImage || file.audio)
        const video = message.video
        for (const file of video ? [...media, video] : media) {
          if (!originals.has(file.id)) {
            originals.set(file.id, await db.loadFile(file.id))
          }
        }
      }
    }
    const media = new Map<string, Blob>()
    const data = toSessionFile(
      session,
      ({ id, name }) => {
        const blob = originals.get(id)
        if (!blob) {
          return null
        }
        const path = imagePath(session.id, id, name)
        media.set(path, blob)
        return path
      },
      memoryStates?.get(session.id)
    )
    entries.push({ name: sessionPath(session.id), blob: json(data) })
    for (const [name, blob] of media) {
      mediaEntries.push({ name, blob })
    }
    index.push(toIndexEntry(data))
  }
  entries.push({ name: INDEX_PATH, blob: json(index) })
  return writeArchive(entries.concat(mediaEntries))
}
