import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseFill14 } from '../base/icons.js'
import { closeImagePreview, useImagePreview } from './imagePreviewState.js'
import styles from './ImagePreview.module.css'

/** 当前打开的预览层，后打开的在末尾；叠放时 Esc 只关闭最上层 */
const openPreviews: object[] = []

/**
 * 图片预览：全屏遮罩内看原图，右上角关闭。
 * 关闭方式：关闭按钮 / 点击遮罩空白 / Esc；打开时焦点在关闭按钮上，关闭后还给缩略图。
 */
export const ImagePreview = () => {
  const t = useTranslate()
  const preview = useImagePreview((state) => state.preview)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')

  const src = preview?.src ?? null
  useEffect(() => {
    setStatus('loading')
  }, [src])

  useEffect(() => {
    if (src === null) {
      return
    }
    const token = {}
    openPreviews.push(token)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openPreviews.at(-1) === token) {
        closeImagePreview()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => {
      openPreviews.splice(openPreviews.indexOf(token), 1)
      document.removeEventListener('keydown', onKeyDown)
      focused?.focus()
    }
  }, [src])

  if (!preview) {
    return null
  }

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={preview.alt}
      onMouseDown={(event) => {
        // 只有点在遮罩空白处才关闭；点在图片上不关
        if (event.target === event.currentTarget) {
          closeImagePreview()
        }
      }}
      onKeyDown={(event) => {
        // 层内只有关闭按钮可聚焦，Tab 不跑到遮罩背后的页面
        if (event.key === 'Tab') {
          event.preventDefault()
          closeRef.current?.focus()
        }
      }}
    >
      <button
        ref={closeRef}
        type="button"
        className={styles.close}
        aria-label={t('close')}
        title={t('close')}
        onClick={closeImagePreview}
      >
        <IconCloseFill14 />
      </button>
      {status === 'loading' ? <span className={styles.spinner} /> : null}
      {status === 'error' ? (
        <span className={styles.failed}>{t('imagePreviewFailed')}</span>
      ) : (
        <img
          className={clsx(styles.image, status === 'loading' && styles.imageLoading)}
          src={preview.src}
          alt={preview.alt}
          referrerPolicy="no-referrer"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      )}
    </div>,
    document.body
  )
}
