import clsx from 'clsx'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { setChatMode, useSettings, type ChatMode } from '../../services/settings.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { CHAT_MODE_OPTIONS, getChatModeMeta } from './chatModeMeta.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

const MAX_INDEX = CHAT_MODE_OPTIONS.length - 1
const TEXT_FADE_OUT_MS = 140
/** 横向拖动超过该像素后进入滑块跟手拖拽态 */
const DRAG_THRESHOLD_PX = 5
/** 轻甩手势速度阈值（px/ms） */
const FLICK_VELOCITY_PX_PER_MS = 0.3

const HINT_ALIGN_CLASS: Record<ChatMode, string> = {
  fast: styles.modeHintStart,
  expert: styles.modeHintCenter,
  rp: styles.modeHintEnd,
}

interface DragState {
  source: 'touch' | 'mouse'
  touchId: number | null
  startX: number
  startY: number
  lastX: number
  lastTime: number
  velocityX: number
  trackLeft: number
  slotWidth: number
  startIndex: number
  pressedOnActive: boolean
  dragging: boolean
  progress: number
  visualIndex: number
}

const clampProgress = (value: number) => Math.max(0, Math.min(MAX_INDEX, value))

const computeDragProgress = (drag: DragState, clientX: number) => {
  if (drag.pressedOnActive) {
    return clampProgress(drag.startIndex + (clientX - drag.startX) / drag.slotWidth)
  }
  return clampProgress((clientX - drag.trackLeft) / drag.slotWidth - 0.5)
}

/** 可点击、可拖拽的三模式分段滑块；拖动期间直接驱动滑块位移，避免触发整页与输入框重渲染 */
const ModeSwitch = ({
  mode,
  onPreviewChange,
  onCommit,
}: {
  mode: ChatMode
  onPreviewChange: (next: ChatMode) => void
  onCommit: (next: ChatMode) => void
}) => {
  const t = useTranslate()
  const [dragVisualIndex, setDragVisualIndex] = useState<number | null>(null)
  const switchRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbSlotRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const suppressTimerRef = useRef<number | null>(null)
  const lastTouchEndTimeRef = useRef(0)

  const activeIndex = Math.max(
    0,
    CHAT_MODE_OPTIONS.findIndex((item) => item.value === mode)
  )
  const latestRef = useRef({ activeIndex, mode, onPreviewChange, onCommit })
  latestRef.current = { activeIndex, mode, onPreviewChange, onCommit }

  // 非拖拽态同步滑块位置到当前激活模式
  useLayoutEffect(() => {
    const thumbSlot = thumbSlotRef.current
    if (!thumbSlot || dragRef.current?.dragging) {
      return
    }
    thumbSlot.style.transform = `translate3d(${activeIndex * 100}%, 0, 0)`
  }, [activeIndex])

  // 检测分段滑块横向空间是否拥挤：放不下时自动切为文字在上、图标在下
  useLayoutEffect(() => {
    const container = switchRef.current
    const track = trackRef.current
    if (!container || !track) {
      return
    }
    const updateLayout = () => {
      container.classList.remove(styles.stacked)
      const options = track.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      let crowded = false
      for (const option of options) {
        const inner = option.firstElementChild as HTMLElement | null
        if (inner && inner.scrollWidth > option.clientWidth - 14) {
          crowded = true
          break
        }
      }
      container.classList.toggle(styles.stacked, crowded)
    }

    updateLayout()
    const observer = new ResizeObserver(updateLayout)
    observer.observe(track)
    return () => observer.disconnect()
  }, [t])

  // 原生 Touch + Mouse 拖拽监听：仅挂载一次，拖动过程中不会因父组件更新而重绑或中断
  useEffect(() => {
    const track = trackRef.current
    if (!track) {
      return
    }

    const beginDrag = (
      source: 'touch' | 'mouse',
      touchId: number | null,
      clientX: number,
      clientY: number,
      timeStamp: number
    ) => {
      const rect = track.getBoundingClientRect()
      if (rect.width <= 0) {
        return
      }
      const slotWidth = rect.width / CHAT_MODE_OPTIONS.length
      const pressedIndex = Math.max(
        0,
        Math.min(MAX_INDEX, Math.floor((clientX - rect.left) / slotWidth))
      )
      const startIndex = latestRef.current.activeIndex
      dragRef.current = {
        source,
        touchId,
        startX: clientX,
        startY: clientY,
        lastX: clientX,
        lastTime: timeStamp,
        velocityX: 0,
        trackLeft: rect.left,
        slotWidth,
        startIndex,
        pressedOnActive: pressedIndex === startIndex,
        dragging: false,
        progress: startIndex,
        visualIndex: startIndex,
      }
    }

    const moveDrag = (
      clientX: number,
      clientY: number,
      timeStamp: number,
      preventDefault?: () => void
    ) => {
      const drag = dragRef.current
      const thumbSlot = thumbSlotRef.current
      if (!drag || !thumbSlot) {
        return
      }
      const dx = clientX - drag.startX
      const dy = clientY - drag.startY

      if (!drag.dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
          return
        }
        // 仅在非常明显的纵向滑动时放弃，避免手指轻斜误判中断横滑
        if (Math.abs(dy) > Math.abs(dx) * 1.8 && Math.abs(dy) > 18) {
          dragRef.current = null
          return
        }
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) {
          return
        }
        drag.dragging = true
        thumbSlot.classList.add(styles.modeThumbDragging)
        track.classList.add(styles.modeTrackDragging)
      }

      preventDefault?.()

      const dt = timeStamp - drag.lastTime
      if (dt > 0) {
        const instantVelocity = (clientX - drag.lastX) / dt
        drag.velocityX = drag.velocityX * 0.35 + instantVelocity * 0.65
        drag.lastX = clientX
        drag.lastTime = timeStamp
      }

      const nextProgress = computeDragProgress(drag, clientX)
      drag.progress = nextProgress
      thumbSlot.style.transform = `translate3d(${nextProgress * 100}%, 0, 0)`

      const nextVisualIndex = Math.round(nextProgress)
      if (nextVisualIndex !== drag.visualIndex) {
        drag.visualIndex = nextVisualIndex
        setDragVisualIndex(nextVisualIndex)
        const nextOption = CHAT_MODE_OPTIONS[nextVisualIndex]
        if (nextOption) {
          latestRef.current.onPreviewChange(nextOption.value)
        }
      }
    }

    const finishDrag = (clientX: number | null, cancelled: boolean) => {
      const drag = dragRef.current
      if (!drag) {
        return
      }
      dragRef.current = null

      if (!drag.dragging) {
        return
      }

      suppressClickRef.current = true
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current)
      }
      suppressTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        suppressTimerRef.current = null
      }, 0)

      const finalProgress =
        cancelled || clientX === null ? drag.progress : computeDragProgress(drag, clientX)
      let finalIndex = Math.round(finalProgress)
      if (
        !cancelled &&
        clientX !== null &&
        drag.pressedOnActive &&
        finalIndex === drag.startIndex
      ) {
        const totalDx = clientX - drag.startX
        if (
          Math.abs(totalDx) > drag.slotWidth * 0.18 &&
          Math.abs(drag.velocityX) >= FLICK_VELOCITY_PX_PER_MS &&
          Math.sign(drag.velocityX) === Math.sign(totalDx)
        ) {
          finalIndex = Math.max(0, Math.min(MAX_INDEX, drag.startIndex + Math.sign(totalDx)))
        }
      }

      const thumbSlot = thumbSlotRef.current
      track.classList.remove(styles.modeTrackDragging)
      if (thumbSlot) {
        // 强制提交当前跟手位置，随后恢复 transition 实现松手平滑吸附
        void thumbSlot.offsetWidth
        thumbSlot.classList.remove(styles.modeThumbDragging)
        thumbSlot.style.transform = `translate3d(${finalIndex * 100}%, 0, 0)`
      }

      setDragVisualIndex(null)
      const nextOption = CHAT_MODE_OPTIONS[finalIndex]
      if (nextOption) {
        latestRef.current.onPreviewChange(nextOption.value)
        if (nextOption.value !== latestRef.current.mode) {
          latestRef.current.onCommit(nextOption.value)
        }
      }
    }

    const findTrackedTouch = (touches: TouchList, touchId: number | null) => {
      if (touchId === null) {
        return null
      }
      for (let i = 0; i < touches.length; i++) {
        const item = touches.item(i)
        if (item && item.identifier === touchId) {
          return item
        }
      }
      return null
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        return
      }
      const touch = event.touches.item(0)
      if (!touch) {
        return
      }
      beginDrag('touch', touch.identifier, touch.clientX, touch.clientY, event.timeStamp)
    }

    const onTouchMove = (event: TouchEvent) => {
      const drag = dragRef.current
      if (!drag || drag.source !== 'touch') {
        return
      }
      const touch = findTrackedTouch(event.touches, drag.touchId)
      if (!touch) {
        return
      }
      moveDrag(touch.clientX, touch.clientY, event.timeStamp, () => {
        if (event.cancelable) {
          event.preventDefault()
        }
        event.stopPropagation()
      })
    }

    const onTouchEnd = (event: TouchEvent) => {
      const drag = dragRef.current
      if (!drag || drag.source !== 'touch') {
        return
      }
      const touch = findTrackedTouch(event.changedTouches, drag.touchId)
      if (!touch) {
        return
      }
      lastTouchEndTimeRef.current = Date.now()
      finishDrag(touch.clientX, false)
    }

    const onTouchCancel = (event: TouchEvent) => {
      const drag = dragRef.current
      if (!drag || drag.source !== 'touch') {
        return
      }
      const touch = findTrackedTouch(event.changedTouches, drag.touchId)
      lastTouchEndTimeRef.current = Date.now()
      finishDrag(touch?.clientX ?? null, true)
    }

    const onWindowMouseMove = (event: globalThis.MouseEvent) => {
      const drag = dragRef.current
      if (!drag || drag.source !== 'mouse') {
        return
      }
      moveDrag(event.clientX, event.clientY, event.timeStamp, () => {
        event.preventDefault()
      })
    }

    const onWindowMouseUp = (event: globalThis.MouseEvent) => {
      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onWindowMouseUp)
      const drag = dragRef.current
      if (!drag || drag.source !== 'mouse') {
        return
      }
      finishDrag(event.clientX, false)
    }

    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || Date.now() - lastTouchEndTimeRef.current < 600) {
        return
      }
      beginDrag('mouse', null, event.clientX, event.clientY, event.timeStamp)
      window.addEventListener('mousemove', onWindowMouseMove)
      window.addEventListener('mouseup', onWindowMouseUp)
    }

    track.addEventListener('touchstart', onTouchStart, { passive: true })
    track.addEventListener('touchmove', onTouchMove, { passive: false })
    track.addEventListener('touchend', onTouchEnd, { passive: true })
    track.addEventListener('touchcancel', onTouchCancel, { passive: true })
    track.addEventListener('mousedown', onMouseDown)

    return () => {
      track.removeEventListener('touchstart', onTouchStart)
      track.removeEventListener('touchmove', onTouchMove)
      track.removeEventListener('touchend', onTouchEnd)
      track.removeEventListener('touchcancel', onTouchCancel)
      track.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onWindowMouseUp)
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current)
        suppressTimerRef.current = null
      }
    }
  }, [])

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) {
      return
    }
    suppressClickRef.current = false
    if (suppressTimerRef.current !== null) {
      window.clearTimeout(suppressTimerRef.current)
      suppressTimerRef.current = null
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = Math.max(0, Math.min(MAX_INDEX, activeIndex + delta))
    const nextOption = CHAT_MODE_OPTIONS[nextIndex]
    if (nextOption && nextOption.value !== mode) {
      onPreviewChange(nextOption.value)
      onCommit(nextOption.value)
    }
  }

  const highlightedIndex = dragVisualIndex ?? activeIndex

  return (
    <div ref={switchRef} className={styles.modeSwitch} data-sider-swipe-ignore="true">
      <div
        ref={trackRef}
        role="tablist"
        aria-label={t('chatModeLabel')}
        className={styles.modeTrack}
        onClickCapture={handleClickCapture}
        onKeyDown={handleKeyDown}
      >
        <div ref={thumbSlotRef} aria-hidden="true" className={styles.modeThumbSlot}>
          <div className={styles.modeThumb} />
        </div>
        {CHAT_MODE_OPTIONS.map((option, index) => {
          const highlighted = index === highlightedIndex
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={option.value === mode}
              className={clsx(styles.modeOption, highlighted && styles.modeOptionActive)}
              onClick={() => {
                onPreviewChange(option.value)
                onCommit(option.value)
              }}
            >
              <span className={styles.modeOptionInner}>
                <span className={styles.modeIcon} aria-hidden="true">
                  {option.icon}
                </span>
                <span className={styles.modeLabel}>{t(option.labelKey)}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 新对话：模式标题 + 可拖拽三模式滑块 + 模式说明 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const chatMode = useSettings((state) => state.chatMode)
  const [targetMode, setTargetMode] = useState<ChatMode>(chatMode)
  const [displayedMode, setDisplayedMode] = useState<ChatMode>(chatMode)
  const [textHidden, setTextHidden] = useState(false)

  // 外部直接改变 chatMode 时同步目标模式
  useEffect(() => {
    setTargetMode(chatMode)
  }, [chatMode])

  // 滑块切换（点击或拖拽跨档）时文字先隐藏再显示，连续滑动时平滑收敛到最新目标模式
  useEffect(() => {
    if (targetMode === displayedMode) {
      if (!textHidden) {
        return
      }
      const rafId = window.requestAnimationFrame(() => setTextHidden(false))
      return () => window.cancelAnimationFrame(rafId)
    }
    setTextHidden(true)
    const timer = window.setTimeout(() => {
      setDisplayedMode(targetMode)
    }, TEXT_FADE_OUT_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [targetMode, displayedMode, textHidden])

  const displayedOption = getChatModeMeta(displayedMode)

  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.hero}>
          <div className={styles.greeting}>
            <span className={clsx(styles.greetingText, textHidden && styles.textHidden)}>
              {t(displayedOption.titleKey)}
            </span>
          </div>

          <ModeSwitch mode={chatMode} onPreviewChange={setTargetMode} onCommit={setChatMode} />

          <p
            className={clsx(
              styles.modeHint,
              HINT_ALIGN_CLASS[displayedOption.value],
              textHidden && styles.textHidden
            )}
          >
            {t(displayedOption.hintKey)}
          </p>
        </div>

        <ChatInput sessionId={null} />
      </div>
    </div>
  )
}
