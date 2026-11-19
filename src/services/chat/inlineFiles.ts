import { getFileExt, getUploadPurpose } from '../attachments.js'
import { loadFile } from './db.js'
import type { FileAttachment, Message } from './types.js'

/**
 * 纯文本类附件（txt / md / csv / json / 代码等）不再上传为 document 块。
 * 服务端把它们当作待解析文档时，整个请求会走单条 32768 token 的受限通道，
 * 改为本地读出正文并入提问后，在 RP 模式下不受单条 32K 上限约束，也免占 Files 配额。
 */

/** user_data 里仍属二进制的格式：服务端需要转换，无法本地当文本读 */
const BINARY_USER_DATA_EXTS = new Set(['xlsx', 'xls', 'epub', 'mobi'])
/** 与 user_data 的文本内容上限一致，超过就退回上传，避免把超长文本塞进请求 */
const MAX_INLINE_BYTES = 8 * 1024 * 1024

export const isTextAttachment = (file: Pick<FileAttachment, 'name' | 'isImage'>): boolean => {
  if (file.isImage) {
    return false
  }
  const ext = getFileExt(file.name)
  return !BINARY_USER_DATA_EXTS.has(ext) && getUploadPurpose(file.name, false) === 'user_data'
}

/** 满足本地内联条件的纯文本附件：无需经 Files API 上传，发送时直接读出正文并入提问 */
export const canInlineTextAttachment = (
  file: Pick<FileAttachment, 'name' | 'size' | 'isImage'>
): boolean => isTextAttachment(file) && file.size > 0 && file.size <= MAX_INLINE_BYTES

/**
 * 按编码自动解码本地文本：优先识别 UTF-16 BOM，其次严格按 UTF-8 解码，
 * 非法 UTF-8 字节序列回退到 GB18030（兼容 Windows 常见 GBK 中文 txt，避免乱码导致 token 暴涨）。
 */
const decodeTextBytes = (bytes: Uint8Array): string => {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes)
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes)
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

/** 原文本地缓存：同一附件在多轮里反复进入上下文时不必重复读 IndexedDB */
const cache = new Map<string, string>()

const readText = async (
  file: FileAttachment,
  pending?: Map<string, Blob>
): Promise<string | null> => {
  const cached = cache.get(file.id)
  if (cached !== undefined) {
    return cached
  }
  try {
    // 刚发送或刚编辑的附件可能还没写进 IndexedDB，优先用内存里的原件
    const blob = pending?.get(file.id) ?? (await loadFile(file.id))
    if (!blob || blob.size === 0 || blob.size > MAX_INLINE_BYTES) {
      return null
    }
    const text = decodeTextBytes(new Uint8Array(await blob.arrayBuffer()))
    if (!text.trim()) {
      return null
    }
    // 只缓存最近几个附件，避免删除会话后仍长期占着内存
    if (cache.size >= 8) {
      cache.clear()
    }
    cache.set(file.id, text)
    return text
  } catch {
    return null
  }
}

/** 一次请求里所有文档的文本合计上限（与服务端的文档限制一致） */
const MAX_TOTAL_BYTES = 8 * 1024 * 1024

/** 收集本轮请求会用到、且能在本地读到正文的文本附件，按附件 id 索引 */
export const loadInlineTexts = async (
  messages: Message[],
  pendingBlobs?: Map<string, Blob>
): Promise<Map<string, string>> => {
  const files = new Map<string, FileAttachment>()
  // 从最新消息往前收集，当前提问优先占用总预算（用 reverse 兼容 Chrome 105+）
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') {
      continue
    }
    for (const file of message.files) {
      if (!files.has(file.id) && isTextAttachment(file)) {
        files.set(file.id, file)
      }
    }
  }
  const selected: FileAttachment[] = []
  let budget = MAX_TOTAL_BYTES
  for (const file of files.values()) {
    if (file.size > budget) {
      continue
    }
    selected.push(file)
    budget -= file.size
  }
  const entries = await Promise.all(
    selected.map(async (file) => {
      const text = await readText(file, pendingBlobs)
      if (text === null) {
        return null
      }
      return [file.id, text] as const
    })
  )
  return new Map(entries.filter((entry) => entry !== null))
}
