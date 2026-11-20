import { getUploadPurpose } from '../attachments.js'
import type { FileAttachment } from '../chat/types.js'
import { ApiError, API_ORIGIN, request } from './client.js'

/**
 * 独立 OCR 接口：POST /v1/tools/ocr（multipart/form-data，鉴权 Authorization: Bearer）。
 * 用于 deepseek-v4-pro（无原生识图能力）时将图片及版面文档转为纯文本并入提问，
 * 识别文件不会写入 Files API。
 */
const OCR_URL = `${API_ORIGIN}/v1/tools/ocr`

type OcrPage = {
  index?: number
  text?: string
  finish_reason?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** 判断附件是否可交给 DeepSeek OCR 接口提取文字（图片及 PDF/Word/PPT 版面文档） */
export const isOcrSupportedAttachment = (file: Pick<FileAttachment, 'name' | 'isImage'>): boolean =>
  file.isImage || getUploadPurpose(file.name, false) === 'rich_layout_recognition'

/**
 * 调用 POST /v1/tools/ocr 提取文件文字。
 * 服务端处理期间可能先下发空白字符保活，再输出单个 JSON 对象，这里先 trim 再解析。
 */
export const recognizeFileText = async (
  apiKey: string,
  file: Blob,
  name: string,
  signal?: AbortSignal
): Promise<string> => {
  const form = new FormData()
  form.append('purpose', 'text_recognition')
  const bodyFile = file instanceof File ? file : new File([file], name, { type: file.type })
  form.append('file', bodyFile, name)

  const response = await request(OCR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  })

  const raw = (await response.text()).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiError('protocol', raw)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.pages)) {
    throw new ApiError('protocol', raw)
  }

  const pages = parsed.pages
    .filter((item): item is OcrPage => isRecord(item))
    .map((page, idx) => ({
      index: typeof page.index === 'number' ? page.index : idx,
      text: typeof page.text === 'string' ? page.text.trim() : '',
    }))
    .sort((a, b) => a.index - b.index)
    .map((page) => page.text)
    .filter(Boolean)

  return pages.join('\n\n')
}
