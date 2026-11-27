import clsx from 'clsx'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Modal } from '../base/Modal.js'
import { usePresence } from '../base/usePresence.js'
import { FileCard } from './FileCard.js'
import { useFileUrl } from './useFileUrl.js'
import styles from './AudioFileCard.module.css'

type AudioSource = { blob: Blob } | { id: string; sessionId?: string }

const padTwo = (value: number) => String(value).padStart(2, '0')

/** 将秒数格式化为 m:ss 或 h:mm:ss */
const formatAudioTime = (seconds: number, roundSubSecondUp = false): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00'
  }
  const totalSeconds = roundSubSecondUp && seconds > 0 && seconds < 1 ? 1 : Math.floor(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${padTwo(minutes)}:${padTwo(secs)}`
  }
  return `${minutes}:${padTwo(secs)}`
}

const PlayGlyph = () => (
  <svg
    className={styles.playIcon}
    width={14}
    height={14}
    viewBox="0 0 14 14"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M4.1 2.25a.65.65 0 0 1 .98-.56l6.72 4.18a.65.65 0 0 1 0 1.1l-6.72 4.18a.65.65 0 0 1-.98-.55V2.25Z" />
  </svg>
)

const PauseGlyph = () => (
  <svg width={14} height={14} viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
    <rect x={3.25} y={2.25} width={2.5} height={9.5} rx={0.9} />
    <rect x={8.25} y={2.25} width={2.5} height={9.5} rx={0.9} />
  </svg>
)

export const AudioFileCard = ({
  name,
  size,
  source,
  onRemove,
}: {
  name: string
  size: number
  source: AudioSource
  onRemove?: () => void
}) => {
  const [open, setOpen] = useState(false)
  const presence = usePresence(open)
  return (
    <>
      <FileCard name={name} size={size} onOpen={() => setOpen(true)} onRemove={onRemove} />
      {presence.mounted ? (
        <Modal
          title={<span className={styles.title}>{name}</span>}
          closable
          visible={presence.visible}
          onClose={() => setOpen(false)}
          className={styles.modal}
          mainClassName={styles.main}
        >
          {'blob' in source ? (
            <LocalPreview blob={source.blob} open={open} />
          ) : (
            <StoredPreview id={source.id} sessionId={source.sessionId} open={open} />
          )}
        </Modal>
      ) : null}
    </>
  )
}

const useBlobUrl = (blob: Blob | undefined) => {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const next = blob && URL.createObjectURL(blob)
    setUrl(next)
    return () => {
      if (next) {
        URL.revokeObjectURL(next)
      }
    }
  }, [blob])
  return url
}

const LocalPreview = ({ blob, open }: { blob: Blob; open: boolean }) => {
  const url = useBlobUrl(blob)
  return <AudioPreview url={url} open={open} />
}

const StoredPreview = ({
  id,
  sessionId,
  open,
}: {
  id: string
  sessionId?: string
  open: boolean
}) => {
  const url = useFileUrl(id, sessionId)
  return <AudioPreview url={url} open={open} />
}

/**
 * 音频预览播放器：使用无原生控制条的 `<audio>` 驱动解码播放，
 * 仅提供播放/暂停、进度条拖拽与时长展示，彻底避免 WebView 原生控件自带的三点溢出菜单。
 */
const AudioPreview = ({ url, open }: { url?: string | null; open: boolean }) => {
  const t = useTranslate()
  const audioRef = useRef<HTMLAudioElement>(null)
  const scrubberRef = useRef<HTMLDivElement>(null)
  const dragPointerIdRef = useRef<number | null>(null)
  const draggingTimeRef = useRef<number | null>(null)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [dragTime, setDragTime] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setDragTime(null)
    setFailed(false)
    dragPointerIdRef.current = null
    draggingTimeRef.current = null
  }, [url])

  useEffect(() => {
    if (!open) {
      audioRef.current?.pause()
      dragPointerIdRef.current = null
      draggingTimeRef.current = null
      setDragTime(null)
    }
  }, [open])

  // 播放期间按屏幕刷新率同步进度，避免部分 WebView timeupdate 间隔过大导致进度条卡顿
  useEffect(() => {
    if (!playing || !open) {
      return
    }
    let rafId = 0
    const tick = () => {
      const audio = audioRef.current
      if (audio && draggingTimeRef.current === null) {
        setCurrentTime(audio.currentTime)
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration)
        }
      }
      rafId = window.requestAnimationFrame(tick)
    }
    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [playing, open])

  if (url === null) {
    return <p className={styles.unavailable}>{t('audioOriginalUnavailable')}</p>
  }
  if (!url) {
    return null
  }
  if (failed) {
    return <p className={styles.unavailable}>{t('audioPreviewFailed')}</p>
  }

  const syncDuration = (audio: HTMLAudioElement) => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration)
    }
  }

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) {
      return
    }
    if (!audio.paused) {
      audio.pause()
      return
    }
    if (audio.ended || (duration > 0 && audio.currentTime >= duration - 0.05)) {
      audio.currentTime = 0
      setCurrentTime(0)
    }
    void audio.play().catch(() => {
      setPlaying(false)
    })
  }

  const resolveTimeFromClientX = (clientX: number): number => {
    const track = scrubberRef.current
    if (!track || duration <= 0) {
      return 0
    }
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) {
      return 0
    }
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  const commitSeek = (targetTime: number) => {
    const audio = audioRef.current
    if (!audio || duration <= 0) {
      return
    }
    const clamped = Math.max(0, Math.min(duration, targetTime))
    audio.currentTime = clamped
    setCurrentTime(clamped)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (duration <= 0 || (event.pointerType === 'mouse' && event.button !== 0)) {
      return
    }
    event.preventDefault()
    dragPointerIdRef.current = event.pointerId
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 部分旧版 WebView 模拟指针可能不支持 setPointerCapture
    }
    const next = resolveTimeFromClientX(event.clientX)
    draggingTimeRef.current = next
    setDragTime(next)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) {
      return
    }
    const next = resolveTimeFromClientX(event.clientX)
    draggingTimeRef.current = next
    setDragTime(next)
  }

  const finishPointerDrag = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (dragPointerIdRef.current !== event.pointerId) {
      return
    }
    dragPointerIdRef.current = null
    const pending = draggingTimeRef.current
    draggingTimeRef.current = null
    setDragTime(null)
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // 忽略已释放的指针捕获
    }
    if (commit) {
      commitSeek(pending ?? resolveTimeFromClientX(event.clientX))
    }
  }

  const handleScrubberKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) {
      return
    }
    const step = 5
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      commitSeek((dragTime ?? currentTime) + step)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      commitSeek((dragTime ?? currentTime) - step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      commitSeek(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      commitSeek(duration)
    }
  }

  const displayTime = dragTime ?? currentTime
  const progress = duration > 0 ? Math.max(0, Math.min(1, displayTime / duration)) : 0
  const percent = `${(progress * 100).toFixed(3)}%`
  const atEnd = duration > 0 && displayTime >= duration - 0.01
  const durationLabel = duration > 0 ? formatAudioTime(duration, true) : '--:--'
  const currentLabel = atEnd ? durationLabel : formatAudioTime(displayTime)

  return (
    <div className={styles.player}>
      <audio
        ref={audioRef}
        className={styles.nativeAudio}
        src={url}
        preload="metadata"
        onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
        onDurationChange={(event) => syncDuration(event.currentTarget)}
        onTimeUpdate={(event) => {
          syncDuration(event.currentTarget)
          if (draggingTimeRef.current === null) {
            setCurrentTime(event.currentTarget.currentTime)
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(event) => {
          setPlaying(false)
          syncDuration(event.currentTarget)
          setCurrentTime(event.currentTarget.currentTime)
        }}
        onError={() => {
          setPlaying(false)
          setFailed(true)
        }}
      />
      <button
        type="button"
        className={styles.playButton}
        aria-label={t(playing ? 'audioPause' : 'audioPlay')}
        onClick={togglePlay}
      >
        {playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>
      <div
        ref={scrubberRef}
        role="slider"
        tabIndex={duration > 0 ? 0 : -1}
        className={clsx(
          styles.scrubber,
          dragTime !== null && styles.scrubberDragging,
          duration <= 0 && styles.scrubberDisabled
        )}
        aria-label={t('audioSeek')}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(duration))}
        aria-valuenow={Math.round(displayTime)}
        aria-valuetext={`${currentLabel} / ${durationLabel}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointerDrag(event, true)}
        onPointerCancel={(event) => finishPointerDrag(event, false)}
        onKeyDown={handleScrubberKeyDown}
      >
        <div className={styles.track}>
          <div className={styles.fill} style={{ width: percent }} />
          <div className={styles.thumb} style={{ left: percent }} />
        </div>
      </div>
      <div className={styles.time}>
        <span>{currentLabel}</span>
        <span className={styles.timeDivider}>/</span>
        <span className={styles.timeTotal}>{durationLabel}</span>
      </div>
    </div>
  )
}
