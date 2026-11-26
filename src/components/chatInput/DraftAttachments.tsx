import clsx from 'clsx'
import { memo, useEffect, useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useUploads, type UploadTask } from '../../services/attachments.js'
import { getAudioSpectrogramIds } from '../../services/audio/metadata.js'
import {
  shouldSkipDraftUpload,
  type DraftAttachment,
  type DraftVideo,
} from '../../services/chat/drafts.js'
import type { FileAttachment, VideoAttachment } from '../../services/chat/types.js'
import { IconCloseFill14, IconPhotoErrorFill20, IconRefreshOutline16 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import { AudioFileCard } from '../files/AudioFileCard.js'
import { FileCard } from '../files/FileCard.js'
import { useFileUrl } from '../files/useFileUrl.js'
import { StoredVideoTile, VideoTile } from '../files/VideoTile.js'
import { openImagePreview } from '../messages/imagePreviewState.js'
import styles from './ChatInput.module.css'

const UPLOADING: UploadTask = { status: 'uploading' }
const INLINE_READY: UploadTask = { status: 'done', serverId: '' }

/** 未发送的附件只有本地原件，点击时临时开一个地址，留出加载时间再释放 */
const openLocalFile = (file: File) => {
  const url = URL.createObjectURL(file)
  window.open(url, '_blank', 'noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** 列表只随草稿或正在编辑的消息附件变化更新；每张新上传卡片独立订阅上传状态。 */
export const DraftAttachments = memo(function DraftAttachments({
  items,
  sessionId,
  existingFiles = [],
  existingVideo,
  video,
  useOcrModel = false,
  videoAllowed,
  onRetry,
  onRemove,
  onRemoveExisting,
}: {
  items: DraftAttachment[]
  sessionId: string | null
  existingFiles?: FileAttachment[]
  existingVideo?: VideoAttachment
  video?: DraftVideo
  useOcrModel?: boolean
  videoAllowed: boolean
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onRemoveExisting?: (id: string) => void
}) {
  if (items.length === 0 && existingFiles.length === 0) {
    return null
  }
  const spectrogramIds = getAudioSpectrogramIds(existingFiles)
  return (
    <div className={styles.attachments}>
      {existingVideo && sessionId !== null ? (
        <StoredVideoTile
          key={existingVideo.id}
          video={existingVideo}
          sessionId={sessionId}
          onRemove={onRemoveExisting ? () => onRemoveExisting(existingVideo.id) : undefined}
        />
      ) : null}
      {existingFiles
        .filter(
          (file) => !existingVideo?.frameIds.includes(file.id) && !spectrogramIds.has(file.id)
        )
        .map((file) => {
          const remove = onRemoveExisting ? () => onRemoveExisting(file.id) : undefined
          return file.audio ? (
            <AudioFileCard
              key={`existing:${file.id}`}
              name={file.name}
              size={file.size}
              source={{ id: file.id, sessionId: sessionId ?? undefined }}
              onRemove={remove}
            />
          ) : (
            <ExistingAttachmentItem key={`existing:${file.id}`} file={file} onRemove={remove} />
          )
        })}
      {video ? (
        <DraftVideoTile
          key={video.id}
          video={video}
          onRetry={videoAllowed ? onRetry : undefined}
          onRemove={() => onRemove(video.id)}
        />
      ) : null}
      {items
        .filter((item) => !video?.frameIds.includes(item.id))
        .map((item) =>
          item.audio ? (
            <AudioFileCard
              key={item.id}
              name={item.file.name}
              size={item.file.size}
              source={{ blob: item.file }}
              onRemove={() => onRemove(item.id)}
            />
          ) : (
            <AttachmentItem
              key={item.id}
              item={item}
              useOcrModel={useOcrModel}
              onRetry={() => onRetry(item.id)}
              onRemove={() => onRemove(item.id)}
            />
          )
        )}
    </div>
  )
})

const DraftVideoTile = ({
  video,
  onRetry,
  onRemove,
}: {
  video: DraftVideo
  onRetry?: (id: string) => void
  onRemove: () => void
}) => {
  const t = useTranslate()
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const originalUrl = URL.createObjectURL(video.file)
    setUrl(originalUrl)
    return () => URL.revokeObjectURL(originalUrl)
  }, [video.file])
  const task = useUploads((state) => {
    const errors = video.frameIds
      .map((id) => state.tasks[id])
      .filter((task) => task?.status === 'error')
    return errors.find((error) => !error.retryable) ?? errors[0]
  })
  const uploading = useUploads((state) =>
    video.frameIds.some((id) => !state.tasks[id] || state.tasks[id].status === 'uploading')
  )
  return (
    <VideoTile
      name={video.name}
      url={url}
      uploading={uploading}
      error={task ? t(task.error.key, task.error.params) : undefined}
      onRetry={
        task?.retryable && onRetry
          ? () => {
              const tasks = useUploads.getState().tasks
              for (const id of video.frameIds) {
                const failure = tasks[id]
                if (failure?.status === 'error' && failure.retryable) {
                  onRetry(id)
                }
              }
            }
          : undefined
      }
      onRemove={onRemove}
    />
  )
}

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
  useOcrModel,
  onRetry,
  onRemove,
}: {
  item: DraftAttachment
  useOcrModel: boolean
  onRetry?: () => void
  onRemove?: () => void
}) => {
  const t = useTranslate()
  const skipUpload = shouldSkipDraftUpload(
    {
      name: item.file.name,
      size: item.file.size,
      isImage: item.isImage,
    },
    useOcrModel
  )
  const task = useUploads(
    (state) => state.tasks[item.id] ?? (skipUpload ? INLINE_READY : UPLOADING)
  )
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
