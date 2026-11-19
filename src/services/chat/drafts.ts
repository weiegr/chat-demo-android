import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { createId } from '../../utils/id.js'
import { isOcrSupportedAttachment } from '../api/ocr.js'
import {
  cancelUpload,
  isImage,
  resolveMimeType,
  uploadAttachment,
  useUploads,
  validateFiles,
  type UploadTask,
} from '../attachments.js'
import { canInlineTextAttachment } from './inlineFiles.js'
import type { FileAttachment } from './types.js'

export type DraftAttachment = {
  /** 本地标识，也是 IndexedDB 原件与上传任务的 key */
  id: string
  file: File
  isImage: boolean
  previewUrl: string | null
}

type Draft = { text: string; attachments: DraftAttachment[] }

export const EMPTY_DRAFT: Draft = { text: '', attachments: [] }

/** 草稿只保存在本次页面的内存中，独立于会话详情缓存；null 是新对话的草稿。 */
export const useDrafts = create<{ drafts: Map<string | null, Draft> }>(() => ({
  drafts: new Map(),
}))

export const getDraft = (sessionId: string | null): Draft =>
  useDrafts.getState().drafts.get(sessionId) ?? EMPTY_DRAFT

const updateDraft = (sessionId: string | null, update: (draft: Draft) => Draft) =>
  useDrafts.setState((state) => {
    const draft = update(state.drafts.get(sessionId) ?? EMPTY_DRAFT)
    const drafts = new Map(state.drafts)
    if (draft.text || draft.attachments.length > 0) {
      drafts.set(sessionId, draft)
    } else {
      drafts.delete(sessionId)
    }
    return { drafts }
  })

export const setDraftText = (sessionId: string | null, text: string) =>
  updateDraft(sessionId, (draft) => ({ ...draft, text }))

/**
 * 判断草稿附件在当前模式下是否无需经 Files API 上传：
 * - 纯文本附件（≤8 MiB）始终本地读出正文内联；
 * - Pro 模型（无原生识图）下图片与 PDF/Office 发送时走 OCR 提取文字，同样无需预上传。
 */
export const shouldSkipDraftUpload = (
  file: Pick<FileAttachment, 'name' | 'size' | 'isImage'>,
  useOcrModel = false
): boolean => canInlineTextAttachment(file) || (useOcrModel && isOcrSupportedAttachment(file))

const upload = (attachment: DraftAttachment, apiKey: string) => {
  // 上传任务负责记录错误，输入框的附件卡片展示失败及重试入口。
  void uploadAttachment(
    apiKey,
    attachment.id,
    attachment.file,
    attachment.file.name,
    attachment.isImage
  ).catch(() => {})
}

/** 整批校验通过后才创建预览和开始上传，返回校验错误与新增附件 ID。 */
export const addDraftFilesWithIds = (
  sessionId: string | null,
  files: File[],
  apiKey: string,
  useOcrModel = false
): { error: TranslationMessage | null; ids: string[] } => {
  if (files.length === 0) {
    return { error: null, ids: [] }
  }
  const error = validateFiles(files, getDraft(sessionId).attachments.length)
  if (error) {
    return { error, ids: [] }
  }
  const added = files.map((file): DraftAttachment => {
    const image = isImage(resolveMimeType(file))
    return {
      id: createId(),
      file,
      isImage: image,
      previewUrl: image ? URL.createObjectURL(file) : null,
    }
  })
  updateDraft(sessionId, (draft) => ({ ...draft, attachments: [...draft.attachments, ...added] }))
  // 纯文本附件与 Pro 模型下的 OCR 附件发送时本地读取/识别，无需提前占用 Files API 配额。
  added.forEach((attachment) => {
    if (
      !shouldSkipDraftUpload(
        { name: attachment.file.name, size: attachment.file.size, isImage: attachment.isImage },
        useOcrModel
      )
    ) {
      upload(attachment, apiKey)
    }
  })
  return { error: null, ids: added.map((item) => item.id) }
}

/** 整批校验通过后才创建预览和开始上传。 */
export const addDraftFiles = (
  sessionId: string | null,
  files: File[],
  apiKey: string,
  useOcrModel = false
): TranslationMessage | null => addDraftFilesWithIds(sessionId, files, apiKey, useOcrModel).error

/** 从 Pro 切回 Flash 模式时，为草稿中此前跳过预上传的图片/文档补发上传 */
export const ensureDraftUploads = (
  sessionId: string | null,
  apiKey: string,
  useOcrModel: boolean
) => {
  if (useOcrModel || !apiKey) {
    return
  }
  const tasks = useUploads.getState().tasks
  for (const attachment of getDraft(sessionId).attachments) {
    if (
      !tasks[attachment.id] &&
      !shouldSkipDraftUpload(
        { name: attachment.file.name, size: attachment.file.size, isImage: attachment.isImage },
        false
      )
    ) {
      upload(attachment, apiKey)
    }
  }
}

export const retryDraftAttachment = (
  sessionId: string | null,
  attachmentId: string,
  apiKey: string
) => {
  const attachment = getDraft(sessionId).attachments.find((item) => item.id === attachmentId)
  if (attachment) {
    upload(attachment, apiKey)
  }
}

/** 发送按钮和实际提交共用规则：有内容，且全部需要上传的附件已上传成功。 */
export const prepareDraftMessage = (
  draft: Draft,
  tasks: Record<string, UploadTask>,
  useOcrModel = false
) => {
  const text = draft.text.trim()
  if (!text && draft.attachments.length === 0) {
    return null
  }
  const files: (FileAttachment & { blob: Blob })[] = []
  for (const attachment of draft.attachments) {
    const meta = {
      name: attachment.file.name,
      size: attachment.file.size,
      isImage: attachment.isImage,
    }
    const inlineText = canInlineTextAttachment(meta)
    const skipUpload = inlineText || (useOcrModel && isOcrSupportedAttachment(meta))
    const task = tasks[attachment.id]
    if (!skipUpload && (task?.status !== 'done' || !task.serverId)) {
      return null
    }
    files.push({
      id: attachment.id,
      serverId: inlineText ? null : task?.status === 'done' ? task.serverId : null,
      name: attachment.file.name,
      size: attachment.file.size,
      isImage: attachment.isImage,
      mimeType: resolveMimeType(attachment.file),
      blob: attachment.file,
    })
  }
  return { text, files }
}

const releaseAttachment = (attachment: DraftAttachment, cancel: boolean) => {
  if (cancel) {
    cancelUpload(attachment.id)
  }
  if (attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}

export const removeDraftAttachment = (sessionId: string | null, attachmentId: string) => {
  const attachment = getDraft(sessionId).attachments.find((item) => item.id === attachmentId)
  if (!attachment) {
    return
  }
  releaseAttachment(attachment, true)
  updateDraft(sessionId, (draft) => ({
    ...draft,
    attachments: draft.attachments.filter((item) => item.id !== attachmentId),
  }))
}

/** 发送成功后原件与 serverId 已交给会话，释放预览但保留上传完成态。 */
export const clearSentDraft = (sessionId: string | null) => {
  getDraft(sessionId).attachments.forEach((attachment) => releaseAttachment(attachment, false))
  updateDraft(sessionId, () => EMPTY_DRAFT)
}

/** 删除会话或替换历史成功后，释放尚未发送的草稿及上传任务。 */
export const clearDraft = (sessionId: string | null) => {
  getDraft(sessionId).attachments.forEach((attachment) => releaseAttachment(attachment, true))
  updateDraft(sessionId, () => EMPTY_DRAFT)
}

export const clearAllDrafts = () => {
  for (const draft of useDrafts.getState().drafts.values()) {
    draft.attachments.forEach((attachment) => releaseAttachment(attachment, true))
  }
  useDrafts.setState({ drafts: new Map() })
}
