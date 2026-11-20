import clsx from 'clsx'
import { useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import styles from './Settings.module.css'

const WHEEL_ITEM_HEIGHT = 44

/** 单列上下滑动滚轮选择器，基于 scroll-snap 吸附中心选中项并实时同步 */
export const WheelColumn = ({
  items,
  value,
  ariaLabel,
  liveIndexRef,
  onChange,
}: {
  items: { value: string; label: string }[]
  value: string
  ariaLabel: string
  liveIndexRef: MutableRefObject<number>
  onChange: (value: string) => void
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemsSignature = items.map((item) => item.value).join(',')
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value)
  )
  const initialIndexRef = useRef(selectedIndex)
  initialIndexRef.current = selectedIndex
  const [activeIndex, setActiveIndex] = useState(selectedIndex)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || items.length === 0) {
      return
    }
    const clamped = Math.max(0, Math.min(items.length - 1, initialIndexRef.current))
    el.scrollTop = clamped * WHEEL_ITEM_HEIGHT
    liveIndexRef.current = clamped
    setActiveIndex(clamped)
  }, [itemsSignature, items.length, liveIndexRef])

  const commitIndex = (idx: number) => {
    const target = items[idx]
    if (target && target.value !== value) {
      onChange(target.value)
    }
  }

  const handleScroll = () => {
    const el = containerRef.current
    if (!el || items.length === 0) {
      return
    }
    const idx = Math.max(
      0,
      Math.min(items.length - 1, Math.round(el.scrollTop / WHEEL_ITEM_HEIGHT))
    )
    liveIndexRef.current = idx
    if (idx !== activeIndex) {
      setActiveIndex(idx)
    }
    commitIndex(idx)
  }

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={ariaLabel}
      className={styles.wheelColumn}
      onScroll={handleScroll}
    >
      <div className={styles.wheelSpacer} aria-hidden="true" />
      {items.map((item, idx) => {
        const active = idx === activeIndex
        return (
          <button
            key={item.value}
            type="button"
            role="option"
            aria-selected={active}
            className={clsx(styles.wheelOption, active && styles.wheelOptionActive)}
            onClick={() => {
              const el = containerRef.current
              if (el) {
                el.scrollTo({ top: idx * WHEEL_ITEM_HEIGHT, behavior: 'smooth' })
              }
            }}
          >
            <span className={styles.wheelOptionText}>{item.label}</span>
          </button>
        )
      })}
      <div className={styles.wheelSpacer} aria-hidden="true" />
    </div>
  )
}
