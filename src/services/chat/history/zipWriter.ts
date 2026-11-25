import { Zip, ZipPassThrough } from 'fflate'

// ZIP32 字段中的哨兵值表示需要 ZIP64；当前格式不支持 ZIP64。
const ZIP64_SIZE = 0xffffffff
const ZIP64_COUNT = 0xffff
/** 单次读取与向原生桥接刷写的分片上限（256KB），将导出峰值内存控制在极低水平 */
const STREAM_CHUNK_SIZE = 256 * 1024

export class ArchiveLimitError extends Error {
  constructor() {
    super('History archive requires unsupported ZIP64 fields')
    this.name = 'ArchiveLimitError'
  }
}

export type ArchiveWriteEntry =
  | { name: string; blob: Blob }
  | { name: string; size: number; load: () => Promise<Blob | undefined> | Blob | undefined }

const invalid = (): never => {
  throw new Error('Invalid history archive entry')
}

/** 与读取端保持相同路径规则，成品必须能再次导入。 */
const entryName = (name: string) => {
  const normalized = name.normalize('NFC')
  if (
    !normalized ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    invalid()
  }
  const bytes = new TextEncoder().encode(normalized)
  if (bytes.length > 0xffff) {
    throw new ArchiveLimitError()
  }
  // 拒绝孤立代理项，避免编码时替换成 U+FFFD 后改变附件的关联路径。
  if (new TextDecoder().decode(bytes) !== normalized) {
    invalid()
  }
  return { name: normalized, byteLength: bytes.length }
}

/** 分块读取 Blob：优先 stream()，在不支持 Blob.prototype.stream 的旧 WebView 上降级为 slice().arrayBuffer() */
const readBlobChunks = async (
  blob: Blob,
  onChunk: (chunk: Uint8Array) => Promise<void> | void
): Promise<number> => {
  let written = 0
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        for (let offset = 0; offset < value.byteLength; offset += STREAM_CHUNK_SIZE) {
          const end = Math.min(value.byteLength, offset + STREAM_CHUNK_SIZE)
          const slice = offset === 0 && end === value.byteLength ? value : value.subarray(offset, end)
          written += slice.byteLength
          if (written > blob.size) {
            invalid()
          }
          await onChunk(slice)
        }
      }
      return written
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }

  for (let offset = 0; offset < blob.size; offset += STREAM_CHUNK_SIZE) {
    const end = Math.min(blob.size, offset + STREAM_CHUNK_SIZE)
    const buffer = await blob.slice(offset, end).arrayBuffer()
    const slice = new Uint8Array(buffer)
    written += slice.byteLength
    if (written > blob.size) {
      invalid()
    }
    await onChunk(slice)
  }
  return written
}

/** STORE 流式写出到异步消费端：单次仅刷出 ≤ 256KB 分片，避免移动端 WebView 大导出 OOM */
export const writeArchiveToSink = async (
  entries: readonly ArchiveWriteEntry[],
  writeChunk: (chunk: Uint8Array) => Promise<void> | void
): Promise<void> => {
  if (entries.length >= ZIP64_COUNT) {
    throw new ArchiveLimitError()
  }
  const names = new Set<string>()
  let dataSize = 0
  let directorySize = 0
  const prepared = entries.map((entry) => {
    const normalized = entryName(entry.name)
    if (names.has(normalized.name)) {
      invalid()
    }
    names.add(normalized.name)
    const entrySize = 'blob' in entry ? entry.blob.size : entry.size
    if (!Number.isSafeInteger(entrySize) || entrySize < 0) {
      invalid()
    }
    if (entrySize >= ZIP64_SIZE) {
      throw new ArchiveLimitError()
    }
    dataSize += entrySize + 46 + normalized.byteLength
    directorySize += 46 + normalized.byteLength
    if (dataSize >= ZIP64_SIZE || directorySize >= ZIP64_SIZE) {
      throw new ArchiveLimitError()
    }
    return { name: normalized.name, size: entrySize, entry }
  })

  const expectedSize = dataSize + directorySize + 22
  let pending: Uint8Array[] = []
  let pendingBytes = 0
  let size = 0
  let completed = false

  const flushPending = async (force: boolean) => {
    if (pendingBytes === 0 || (!force && pendingBytes < STREAM_CHUNK_SIZE)) {
      return
    }
    const batch = pending
    const total = pendingBytes
    pending = []
    pendingBytes = 0

    if (batch.length === 1 && batch[0].byteLength <= STREAM_CHUNK_SIZE) {
      await writeChunk(batch[0])
      return
    }

    const merged = new Uint8Array(total)
    let cursor = 0
    for (const part of batch) {
      merged.set(part, cursor)
      cursor += part.byteLength
    }
    for (let offset = 0; offset < merged.byteLength; offset += STREAM_CHUNK_SIZE) {
      const end = Math.min(merged.byteLength, offset + STREAM_CHUNK_SIZE)
      await writeChunk(
        offset === 0 && end === merged.byteLength ? merged : merged.subarray(offset, end)
      )
    }
  }

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      throw error
    }
    size += chunk.byteLength
    if (size > expectedSize) {
      invalid()
    }
    if (chunk.byteLength > 0) {
      pending.push(chunk)
      pendingBytes += chunk.byteLength
    }
    completed = final
  })

  try {
    for (const { name, size: expectedEntrySize, entry: source } of prepared) {
      const blob = 'blob' in source ? source.blob : await source.load()
      if (!blob || blob.size !== expectedEntrySize) {
        return invalid()
      }
      const zipEntry = new ZipPassThrough(name)
      zipEntry.mtime = new Date(1980, 0, 1)
      zip.add(zipEntry)
      const written = await readBlobChunks(blob, async (slice) => {
        zipEntry.push(slice)
        await flushPending(false)
      })
      if (written !== expectedEntrySize) {
        invalid()
      }
      zipEntry.push(new Uint8Array(), true)
      await flushPending(false)
    }
    zip.end()
    await flushPending(true)
    if (!completed || size !== expectedSize) {
      invalid()
    }
  } finally {
    zip.terminate()
  }
}

/** STORE 流式写入为内存 Blob（浏览器直接下载使用）；成品必须能再次导入。 */
export const writeArchive = async (entries: readonly ArchiveWriteEntry[]): Promise<Blob> => {
  const chunks: Blob[] = []
  await writeArchiveToSink(entries, (chunk) => {
    const copy = new Uint8Array(chunk.byteLength)
    copy.set(chunk)
    chunks.push(new Blob([copy]))
  })
  return new Blob(chunks, { type: 'application/zip' })
}
