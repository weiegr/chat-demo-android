import clsx from 'clsx'
import { memo, useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useUploads, type UploadTask } from '../../services/attachments.js'
import type { DraftAttachment } from '../../services/chat/drafts.js'
import type { FileAttachment } from '../../services/chat/types.js'
import { IconCloseFill14, IconPhotoErrorFill20, IconRefreshOutline16 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import { FileCard } from '../files/FileCard.js'
import { useFileUrl } from '../files/useFileUrl.js'
import { openImagePreview } from '../messages/imagePreviewState.js'
import styles from './ChatInput.module.css'

const UPLOADING: UploadTask = { status: 'uploading' }

/** 未发送的附件只有本地原件，点击时临时开一个地址，留出加载时间再释放 */
const openLocalFile = (file: File) => {
  const url = URL.createObjectURL(file)
  window.open(url, '_blank', 'noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** 列表只随草稿或正在编辑的消息附件变化更新；每张新上传卡片独立订阅上传状态。 */
export const DraftAttachments = memo(function DraftAttachments({
  items,
  existingFiles = [],
  onRetry,
  onRemove,
  onRemoveExisting,
}: {
  items: DraftAttachment[]
  existingFiles?: FileAttachment[]
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onRemoveExisting?: (id: string) => void
}) {
  if (items.length === 0 && existingFiles.length === 0) {
    return null
  }
  return (
    <div className={styles.attachments}>
      {existingFiles.map((file) => (
        <ExistingAttachmentItem
          key={`existing:${file.id}`}
          file={file}
          onRemove={onRemoveExisting ? () => onRemoveExisting(file.id) : undefined}
        />
      ))}
      {items.map((item) => (
        <AttachmentItem
          key={item.id}
          item={item}
          onRetry={() => onRetry(item.id)}
          onRemove={() => onRemove(item.id)}
        />
      ))}
    </div>
  )
})

/** 图片缩略图通用外壳：预览图 + 状态蒙层 + 右上角移除按钮 */
const ImageTileShell = ({
  name,
  title,
  imageUrl,
  failed,
  invalidRemove,
  onRemove,
  children,
}: {
  name: string
  title: string
  imageUrl: string | undefined
  failed?: boolean
  invalidRemove?: boolean
  onRemove?: () => void
  children?: ReactNode
}) => {
  const t = useTranslate()
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const isBroken = Boolean(imageUrl && brokenUrl === imageUrl)
  return (
    <div className={clsx(styles.attachment, failed && styles.attachmentFailed)} title={title}>
      <button
        type="button"
        className={styles.preview}
        title={name}
        disabled={!imageUrl || isBroken}
        onClick={() => imageUrl && !isBroken && openImagePreview(imageUrl, name)}
      >
        {imageUrl ? (
          isBroken ? (
            <span className={styles.brokenIcon} role="img" aria-label={name}>
              <IconPhotoErrorFill20 />
            </span>
          ) : (
            <img src={imageUrl} alt={name} onError={() => setBrokenUrl(imageUrl)} />
          )
        ) : null}
      </button>
      {children}
      {onRemove ? (
        <button
          type="button"
          className={clsx(styles.remove, invalidRemove && styles.invalidRemove)}
          aria-label={t('removeAttachment')}
          onClick={onRemove}
        >
          <IconCloseFill14 />
        </button>
      ) : null}
    </div>
  )
}

/** 正在编辑的用户消息原有附件：本地有图则按缩略图呈现，否则展示文件卡片 */
const ExistingAttachmentItem = ({
  file,
  onRemove,
}: {
  file: FileAttachment
  onRemove?: () => void
}) => {
  const url = useFileUrl(file.id)
  if (file.isImage && url !== null) {
    return <ImageTileShell name={file.name} title={file.name} imageUrl={url} onRemove={onRemove} />
  }
  return (
    <FileCard
      name={file.name}
      size={file.size}
      status="done"
      onRemove={onRemove}
      onOpen={url ? () => window.open(url, '_blank', 'noreferrer') : undefined}
    />
  )
}

/** 输入框里的新增附件：图片显示缩略图，其余显示文件卡片 */
const AttachmentItem = ({
  item,
  onRetry,
  onRemove,
}: {
  item: DraftAttachment
  onRetry: () => void
  onRemove: () => void
}) => {
  const t = useTranslate()
  const task = useUploads((state) => state.tasks[item.id] ?? UPLOADING)
  const status = task.status
  const error = task.status === 'error' ? t(task.error.key, task.error.params) : undefined
  // 过大、格式不支持等重试无效的失败只提示原因，需删除后再发送
  const retry = task.status === 'error' && task.retryable ? onRetry : undefined
  const failed = status === 'error'
  const retryLabel = t('uploadRetry', { message: error ?? t('uploadFileStatusFailed') })
  // 「上传失败」只显示重试图标，其余原因写在图片上：可重试时在图标下方，不可重试时贴底
  const showReason = failed && error !== undefined && error !== t('uploadFileStatusFailed')
  const previewUrl = item.previewUrl
  return previewUrl ? (
    <ImageTileShell
      name={item.file.name}
      title={error ?? item.file.name}
      imageUrl={previewUrl}
      failed={failed}
      invalidRemove={failed && !retry}
      onRemove={onRemove}
    >
      {status === 'uploading' ? <div className={styles.uploading} /> : null}
      {failed && retry ? (
        <Tooltip content={retryLabel}>
          <button type="button" className={styles.failed} aria-label={retryLabel} onClick={retry}>
            <IconRefreshOutline16 />
            {showReason ? <span className={styles.failedReason}>{error}</span> : null}
          </button>
        </Tooltip>
      ) : null}
      {failed && !retry ? (
        <div className={clsx(styles.failed, styles.failedStatic)} aria-label={error}>
          {showReason ? <span className={styles.failedReason}>{error}</span> : null}
        </div>
      ) : null}
    </ImageTileShell>
  ) : (
    <FileCard
      name={item.file.name}
      size={item.file.size}
      status={status}
      error={error}
      onRetry={retry}
      onRemove={onRemove}
      onOpen={() => openLocalFile(item.file)}
    />
  )
}
