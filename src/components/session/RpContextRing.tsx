import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { useAnchoredPosition } from '../base/anchored.js'
import { useRpContextPercent } from './RpContextProgress.js'
import styles from './RpContextRing.module.css'

export const RpContextRing = ({ mobile = false }: { mobile?: boolean }) => {
  const percent = useRpContextPercent()
  return percent === undefined ? null : <Ring percent={percent} mobile={mobile} />
}

const Ring = ({ percent, mobile }: { percent: number; mobile: boolean }) => {
  const t = useTranslate()
  const label = t('rpContextTokens', { percent: Math.round(percent) })
  const id = useId()
  const [open, setOpen] = useState(false)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { side: 'bottom', align: 'center', minSpace: 36, offset: 5, measureKey: label })
  useEffect(() => {
    if (!open) {
      return
    }
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchorRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [anchorRef, open])
  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className={mobile ? styles.mobile : styles.button}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((visible) => !visible)}
      >
        <svg
          viewBox="0 0 20 20"
          width="20"
          height="20"
          aria-hidden="true"
          fill="none"
          strokeWidth="2"
        >
          <circle className={styles.track} cx="10" cy="10" r="7" />
          {percent > 0 ? (
            <circle
              className={styles.progress}
              cx="10"
              cy="10"
              r="7"
              pathLength="100"
              strokeDasharray={percent < 100 ? percent + ' ' + (100 - percent) : undefined}
              strokeLinecap="round"
              transform="translate(10 10) rotate(-90) scale(1 -1) translate(-10 -10)"
            />
          ) : null}
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              id={id}
              ref={floatingRef}
              className={styles.popover}
              role="status"
              style={position ?? { top: 0, left: 0, visibility: 'hidden' }}
            >
              {label}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
