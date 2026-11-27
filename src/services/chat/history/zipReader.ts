import { Inflate } from 'fflate'

const READ_CHUNK_BYTES = 256 * 1024
// 控制每轮同步解压的工作量；输出交给调用方保存后才继续读取。
const INFLATE_CHUNK_BYTES = 8 * 1024

/** ZIP 结构损坏或使用了不支持的特性 */
export class ArchiveError extends Error {
  constructor() {
    super('Invalid or unsupported history archive')
    this.name = 'ArchiveError'
  }
}

const invalid = (): never => {
  throw new ArchiveError()
}

/** 本地文件头签名 PK\x03\x04，用于在解析前区分 ZIP 与其他文件。 */
export const isZipFile = async (file: File) => {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return bytes.length === 4 && bytes.every((byte, index) => byte === [0x50, 0x4b, 3, 4][index])
}

const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return crc >>> 0
})

const readBytes = async (file: File, start: number, length: number) => {
  if (start < 0 || length < 0 || start + length > file.size) {
    invalid()
  }
  const bytes = new Uint8Array(await file.slice(start, start + length).arrayBuffer())
  if (bytes.length !== length) {
    invalid()
  }
  return bytes
}

/** 相邻的文件头与压缩数据共用一段预读缓冲，最多读取一个块。 */
const createBufferedReader = (file: File, end: number) => {
  let bufferStart = 0
  let buffer = new Uint8Array()
  return async (start: number, required: number, maximum = required) => {
    if (start < 0 || required < 0 || start + required > end) {
      invalid()
    }
    const offset = start - bufferStart
    if (offset < 0 || offset + required > buffer.length) {
      buffer = await readBytes(file, start, Math.min(READ_CHUNK_BYTES, end - start))
      bufferStart = start
    }
    const from = start - bufferStart
    return buffer.subarray(from, from + maximum)
  }
}

type BufferedRead = ReturnType<typeof createBufferedReader>

/** ZIP64、分卷与加密文件不属于导出格式，一律拒绝。 */
const checkExtra = (bytes: Uint8Array) => {
  const view = viewOf(bytes)
  let offset = 0
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length || view.getUint16(offset, true) === 1) {
      invalid()
    }
    offset += 4 + view.getUint16(offset + 2, true)
    if (offset > bytes.length) {
      invalid()
    }
  }
}

const decodePath = (bytes: Uint8Array, flags: number) => {
  // 非 UTF-8 编码的 ZIP 文件名仅接受 ASCII，确保附件路径解码准确。
  if (!(flags & 0x800) && bytes.some((byte) => byte > 0x7f)) {
    invalid()
  }
  const path = new TextDecoder('utf-8', { fatal: true }).decode(bytes).normalize('NFC')
  if (!path || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path)) {
    invalid()
  }
  const parts = (path.endsWith('/') ? path.slice(0, -1) : path).split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    invalid()
  }
  return path
}

type Entry = {
  path: string
  name: Uint8Array
  flags: number
  method: number
  crc: number
  compressedSize: number
  size: number
  offset: number
}

const readDirectory = async (file: File) => {
  if (file.size < 22) {
    invalid()
  }
  const tailStart = Math.max(0, file.size - 22 - 0xffff)
  const tail = await readBytes(file, tailStart, file.size - tailStart)
  const tailView = viewOf(tail)
  let end = tail.length - 22
  while (
    end >= 0 &&
    (tailView.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + tailView.getUint16(end + 20, true) !== tail.length)
  ) {
    end--
  }
  if (end < 0) {
    invalid()
  }
  const count = tailView.getUint16(end + 10, true)
  const size = tailView.getUint32(end + 12, true)
  const offset = tailView.getUint32(end + 16, true)
  if (
    tailView.getUint16(end + 4, true) !== 0 ||
    tailView.getUint16(end + 6, true) !== 0 ||
    tailView.getUint16(end + 8, true) !== count ||
    count === 0xffff ||
    size === 0xffffffff ||
    offset === 0xffffffff ||
    offset + size !== tailStart + end
  ) {
    invalid()
  }
  const entries: Entry[] = []
  const paths = new Set<string>()
  const read = createBufferedReader(file, offset + size)
  let cursor = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > size) {
      invalid()
    }
    const view = viewOf(await read(offset + cursor, 46))
    if (view.getUint32(0, true) !== 0x02014b50) {
      invalid()
    }
    const flags = view.getUint16(8, true)
    const method = view.getUint16(10, true)
    const compressedSize = view.getUint32(20, true)
    const entrySize = view.getUint32(24, true)
    const nameLength = view.getUint16(28, true)
    const extraLength = view.getUint16(30, true)
    const next = cursor + 46 + nameLength + extraLength + view.getUint16(32, true)
    const entryOffset = view.getUint32(42, true)
    // 只允许 deflate 选项、data descriptor 与 UTF-8 标志。
    if (
      flags & ~0x80e ||
      (method !== 0 && method !== 8) ||
      compressedSize === 0xffffffff ||
      entrySize === 0xffffffff ||
      (method === 0 && compressedSize !== entrySize) ||
      entryOffset >= offset ||
      view.getUint16(34, true) !== 0 ||
      ((view.getUint32(38, true) >>> 16) & 0xf000) === 0xa000 ||
      next > size
    ) {
      invalid()
    }
    // 目录只保留文件名，不让小切片持有已读过的缓冲块。
    const name = (await read(offset + cursor + 46, nameLength)).slice()
    const path = decodePath(name, flags)
    // 目录和同名文件也不能互相覆盖。
    const identity = path.endsWith('/') ? path.slice(0, -1) : path
    if (paths.has(identity) || (path.endsWith('/') && entrySize !== 0)) {
      invalid()
    }
    paths.add(identity)
    checkExtra(await read(offset + cursor + 46 + nameLength, extraLength))
    entries.push({
      path,
      name,
      flags,
      method,
      crc: view.getUint32(16, true),
      compressedSize,
      size: entrySize,
      offset: entryOffset,
    })
    cursor = next
  }
  if (cursor !== size) {
    invalid()
  }
  return { entries: entries.sort((a, b) => a.offset - b.offset), offset, size }
}

const readEntryOffset = async (read: BufferedRead, entry: Entry, boundary: number) => {
  if (entry.offset + 30 > boundary) {
    invalid()
  }
  const view = viewOf(await read(entry.offset, 30))
  const nameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  const start = entry.offset + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (
    view.getUint32(0, true) !== 0x04034b50 ||
    view.getUint16(6, true) !== entry.flags ||
    view.getUint16(8, true) !== entry.method ||
    nameLength !== entry.name.length ||
    end + (entry.flags & 8 ? 12 : 0) > boundary
  ) {
    invalid()
  }
  for (const [position, expected] of [
    [14, entry.crc],
    [18, entry.compressedSize],
    [22, entry.size],
  ]) {
    const actual = view.getUint32(position, true)
    if (actual !== expected && (!(entry.flags & 8) || actual !== 0)) {
      invalid()
    }
  }
  const metadata = await read(entry.offset + 30, nameLength + extraLength)
  if (entry.name.some((byte, index) => byte !== metadata[index])) {
    invalid()
  }
  checkExtra(metadata.subarray(nameLength))
  return start
}

/** 数据描述符紧跟条目数据，顺序校验可避免先跳读再返回文件头。 */
const checkDescriptor = async (read: BufferedRead, entry: Entry, end: number, boundary: number) => {
  if (!(entry.flags & 8)) {
    return
  }
  const descriptor = viewOf(await read(end, Math.min(16, boundary - end)))
  const shift = descriptor.getUint32(0, true) === 0x08074b50 ? 4 : 0
  if (
    shift + 12 > descriptor.byteLength ||
    descriptor.getUint32(shift, true) !== entry.crc ||
    descriptor.getUint32(shift + 4, true) !== entry.compressedSize ||
    descriptor.getUint32(shift + 8, true) !== entry.size
  ) {
    invalid()
  }
}

export type ArchiveEntry = {
  path: string
  size: number
  stream: AsyncIterable<Uint8Array>
}

/**
 * 按条目在文件中的物理顺序逐条、逐块解压，跳过目录条目。
 * 调用方必须消费完当前条目的数据，再请求下一个条目。
 * 进度先计入中央目录，再按本地文件头和压缩数据在归档中的位置推进。
 */
export async function* readArchive(
  file: File,
  onRead?: (bytesRead: number) => void
): AsyncGenerator<ArchiveEntry> {
  const directory = await readDirectory(file)
  const read = createBufferedReader(file, directory.offset)
  onRead?.(directory.size)
  for (const [index, entry] of directory.entries.entries()) {
    const boundary = directory.entries[index + 1]?.offset ?? directory.offset
    const start = await readEntryOffset(read, entry, boundary)
    const end = start + entry.compressedSize
    if (entry.path.endsWith('/')) {
      await checkDescriptor(read, entry, end, boundary)
      continue
    }
    let completed = false
    const stream = async function* (): AsyncGenerator<Uint8Array> {
      let written = 0
      let crc = 0xffffffff
      const pending: Uint8Array[] = []
      const append = (chunk: Uint8Array) => {
        written += chunk.length
        if (written > entry.size) {
          invalid()
        }
        for (let index = 0; index < chunk.length; index++) {
          crc = (crc >>> 8) ^ crcTable[(crc ^ chunk[index]) & 0xff]
        }
        if (chunk.length) {
          pending.push(chunk)
        }
      }
      const inflate = entry.method === 8 ? new Inflate(append) : null
      for (let position = start; position < end; ) {
        // 缓冲末尾可能不足一整块，先消费剩余内容，下次再预读。
        const chunk = await read(position, 1, end - position)
        if (inflate) {
          for (let cursor = 0; cursor < chunk.length; cursor += INFLATE_CHUNK_BYTES) {
            const chunkEnd = Math.min(cursor + INFLATE_CHUNK_BYTES, chunk.length)
            inflate.push(chunk.subarray(cursor, chunkEnd), position + chunkEnd === end)
            // yield 暂停解压，等待调用方完成异步写入；不缓存整个条目。
            yield* pending.splice(0)
          }
        } else {
          append(chunk)
          yield* pending.splice(0)
        }
        position += chunk.length
        onRead?.(directory.size + position)
      }
      if (inflate && entry.compressedSize === 0) {
        inflate.push(new Uint8Array(), true)
        yield* pending.splice(0)
      }
      if (written !== entry.size || (crc ^ 0xffffffff) >>> 0 !== entry.crc) {
        invalid()
      }
      await checkDescriptor(read, entry, end, boundary)
      completed = true
    }
    yield { path: entry.path, size: entry.size, stream: stream() }
    if (!completed) {
      invalid()
    }
    onRead?.(directory.size + boundary)
  }
}

/** 读出整个条目：会话 JSON 需要完整解析，图片需要识别类型后整张保存。 */
export const readEntry = async (entry: ArchiveEntry): Promise<Blob> => {
  const parts: Blob[] = []
  for await (const chunk of entry.stream) {
    parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]))
  }
  return new Blob(parts)
}

/** 不需要的条目也要读完，以校验大小与 CRC。 */
export const skipEntry = async (entry: ArchiveEntry): Promise<void> => {
  const reader = entry.stream[Symbol.asyncIterator]()
  while (!(await reader.next()).done) {
    // 丢弃数据。
  }
}
