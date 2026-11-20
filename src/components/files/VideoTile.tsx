import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { VideoAttachment } from '../../services/chat/types.js'
import { seekVideoCover } from '../../services/video/frames.js'
import { IconCloseFill14, IconRefreshOutline16 } from '../base/icons.js'
import { openVideoPreview } from '../messages/imagePreviewState.js'
import { useFileUrl } from './useFileUrl.js'
import styles from './VideoTile.module.css'

export const VideoTile = ({
  name,
  url,
  uploading,
  error,
  onRetry,
  onRemove,
}: {
  name: string
  url?: string | null
  uploading?: boolean
  error?: string
  onRetry?: () => void
  onRemove?: () => void
}) => {
  const t = useTranslate()
  const [frameUrl, setFrameUrl] = useState<string>()
  const title = error ?? (url === null ? t('videoOriginalUnavailable') : name)
  return (
    <div className={clsx(styles.tile, error && styles.failed)} title={title}>
      <button
        type="button"
        className={styles.preview}
        aria-label={name}
        disabled={!url}
        onClick={() => url && openVideoPreview(url, name)}
      >
        {url ? (
          <video
            key={url}
            className={frameUrl !== url ? styles.coverLoading : undefined}
            src={url}
            preload="metadata"
            muted
            playsInline
            aria-hidden="true"
            onLoadedMetadata={(event) => seekVideoCover(event.currentTarget)}
            onSeeked={() => setFrameUrl(url)}
          />
        ) : null}
        <span className={styles.play} aria-hidden="true">
          <svg width={14} height={14} viewBox="0 0 14 14" fill="currentColor">
            <path d="M4 2.3a.6.6 0 0 1 .9-.5l7 4.7a.6.6 0 0 1 0 1l-7 4.7a.6.6 0 0 1-.9-.5z" />
          </svg>
        </span>
      </button>
      {uploading && !error ? (
        <span
          className={styles.uploading}
          role="status"
          aria-label={t('uploadFileStatusUploading')}
        />
      ) : null}
      {error && onRetry ? (
        <button
          type="button"
          className={styles.retry}
          aria-label={t('uploadRetry', { message: error })}
          onClick={onRetry}
        >
          <IconRefreshOutline16 />
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          className={styles.remove}
          aria-label={t('videoRemove')}
          onClick={onRemove}
        >
          <IconCloseFill14 />
        </button>
      ) : null}
    </div>
  )
}

export const StoredVideoTile = ({
  video,
  sessionId,
  onRemove,
}: {
  video: VideoAttachment
  sessionId: string
  onRemove?: () => void
}) => {
  const url = useFileUrl(video.id, sessionId)
  return <VideoTile name={video.name} url={url} onRemove={onRemove} />
}
