import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Modal } from '../base/Modal.js'
import { usePresence } from '../base/usePresence.js'
import { FileCard } from './FileCard.js'
import { useFileUrl } from './useFileUrl.js'
import styles from './AudioFileCard.module.css'

type AudioSource = { blob: Blob } | { id: string; sessionId?: string }

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

const AudioPreview = ({ url, open }: { url?: string | null; open: boolean }) => {
  const t = useTranslate()
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (!open) {
      audioRef.current?.pause()
    }
  }, [open])
  if (url === null) {
    return <p className={styles.unavailable}>{t('audioOriginalUnavailable')}</p>
  }
  return url ? (
    <audio ref={audioRef} className={styles.player} src={url} controls preload="metadata" />
  ) : null
}
