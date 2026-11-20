import clsx from 'clsx'
import {
  useCallback,
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

const OPTION_COUNT = CHAT_MODE_OPTIONS.length
const MAX_INDEX = OPTION_COUNT - 1
const TEXT_FADE_OUT_MS = 140
/** 松手吸附与点击切换动画时长（与原 CSS 过渡保持一致） */
const SNAP_DURATION_MS = 280
/** 横向拖动超过该像素后进入滑块跟手拖拽态 */
const DRAG_THRESHOLD_PX = 5
/** 轻甩手势速度阈值（px/ms） */
const FLICK_VELOCITY_PX_PER_MS = 0.3
/** 判定滑块已完整滑过到下一档的容差（约 2px，避免手动贴边差一两像素未触发） */
const SETTLE_EPSILON = 0.02
/** 提示语离场/进场额外缓冲像素，须大于视口边缘 4px 渐隐区以确保静置态不露边 */
const HINT_OFFSCREEN_PAD_PX = 8

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
  originX: number
  lastX: number
  lastTime: number
  velocityX: number
  trackLeft: number
  slotWidth: number
  startIndex: number
  startProgress: number
  pressedOnThumb: boolean
  dragging: boolean
  progress: number
  settledIndex: number
}

interface SnapAnimation {
  rafId: number
  target: number
}

interface HintMetrics {
  stageWidth: number
  itemWidths: number[]
}

const clampProgress = (value: number) => Math.max(0, Math.min(MAX_INDEX, value))

const lerp = (from: number, to: number, t: number) => from + (to - from) * t

const getModeIndex = (mode: ChatMode) =>
  Math.max(
    0,
    CHAT_MODE_OPTIONS.findIndex((item) => item.value === mode)
  )

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 精确求值 cubic-bezier(0.22, 1, 0.36, 1)，与滑块吸附缓动曲线一致 */
const easeOutQuarticLike = (t: number): number => {
  if (t <= 0) {
    return 0
  }
  if (t >= 1) {
    return 1
  }
  const p1x = 0.22
  const p2x = 0.36
  const sampleX = (u: number) =>
    3 * (1 - u) * (1 - u) * u * p1x + 3 * (1 - u) * u * u * p2x + u * u * u
  const sampleY = (u: number) => 3 * (1 - u) * (1 - u) * u + 3 * (1 - u) * u * u + u * u * u

  let lo = 0
  let hi = 1
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) * 0.5
    if (sampleX(mid) < t) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return sampleY((lo + hi) * 0.5)
}

/** 仅当滑块完整滑过到下一档（或回退完整跨档）时才更新当前已到达模式，半途徘徊保持上一模式 */
const resolveSettledIndex = (settledIndex: number, progress: number) => {
  if (progress >= settledIndex + 1 - SETTLE_EPSILON) {
    return Math.min(MAX_INDEX, Math.floor(progress + SETTLE_EPSILON))
  }
  if (progress <= settledIndex - 1 + SETTLE_EPSILON) {
    return Math.max(0, Math.ceil(progress - SETTLE_EPSILON))
  }
  return settledIndex
}

const computeDragProgress = (drag: DragState, clientX: number) => {
  if (drag.pressedOnThumb) {
    return clampProgress(drag.startProgress + (clientX - drag.originX) / drag.slotWidth)
  }
  return clampProgress((clientX - drag.trackLeft) / drag.slotWidth - 0.5)
}

/** 可点击、可拖拽的三模式分段滑块；由单一连续 progress 同帧驱动胶囊位姿、蓝色文字裁剪与下方提示语 */
const ModeSwitch = ({
  mode,
  onProgressChange,
  onPreviewChange,
  onCommit,
}: {
  mode: ChatMode
  onProgressChange: (progress: number) => void
  onPreviewChange: (next: ChatMode) => void
  onCommit: (next: ChatMode) => void
}) => {
  const t = useTranslate()
  const switchRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbSlotRef = useRef<HTMLDivElement>(null)
  const activeLayerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const animRef = useRef<SnapAnimation | null>(null)
  const initializedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const suppressTimerRef = useRef<number | null>(null)
  const lastTouchEndTimeRef = useRef(0)

  const activeIndex = getModeIndex(mode)
  const progressRef = useRef(activeIndex)
  const latestRef = useRef({ activeIndex, mode, onProgressChange, onPreviewChange, onCommit })
  latestRef.current = { activeIndex, mode, onProgressChange, onPreviewChange, onCommit }

  const applyVisualProgress = useCallback((rawProgress: number) => {
    const progress = clampProgress(rawProgress)
    progressRef.current = progress

    const thumbSlot = thumbSlotRef.current
    if (thumbSlot) {
      thumbSlot.style.transform = `translate3d(${progress * 100}%, 0, 0)`
    }

    const activeLayer = activeLayerRef.current
    if (activeLayer) {
      activeLayer.style.setProperty('--mode-clip-left', String(progress / OPTION_COUNT))
      activeLayer.style.setProperty(
        '--mode-clip-right',
        String((MAX_INDEX - progress) / OPTION_COUNT)
      )
    }

    latestRef.current.onProgressChange(progress)
  }, [])

  const stopAnimation = useCallback(() => {
    const running = animRef.current
    if (running) {
      window.cancelAnimationFrame(running.rafId)
      animRef.current = null
    }
  }, [])

  const animateTo = useCallback(
    (target: number) => {
      const clampedTarget = clampProgress(target)
      const running = animRef.current
      if (running && Math.abs(running.target - clampedTarget) < 1e-4) {
        return
      }
      stopAnimation()

      const startProgress = progressRef.current
      if (Math.abs(clampedTarget - startProgress) < 1e-4 || prefersReducedMotion()) {
        applyVisualProgress(clampedTarget)
        return
      }

      const startTime = performance.now()
      const step = (now: number) => {
        const elapsed = now - startTime
        const tRatio = Math.min(1, elapsed / SNAP_DURATION_MS)
        const eased = easeOutQuarticLike(tRatio)
        applyVisualProgress(lerp(startProgress, clampedTarget, eased))

        if (tRatio < 1) {
          animRef.current = { rafId: window.requestAnimationFrame(step), target: clampedTarget }
        } else {
          animRef.current = null
          applyVisualProgress(clampedTarget)
        }
      }

      animRef.current = { rafId: window.requestAnimationFrame(step), target: clampedTarget }
    },
    [applyVisualProgress, stopAnimation]
  )

  // 首次挂载直接对齐初始档位，后续非拖拽态切档时平滑过渡
  useLayoutEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      applyVisualProgress(activeIndex)
      return
    }
    if (dragRef.current?.dragging) {
      return
    }
    animateTo(activeIndex)
  }, [activeIndex, animateTo, applyVisualProgress])

  useEffect(() => () => stopAnimation(), [stopAnimation])

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
      const slotWidth = rect.width / OPTION_COUNT
      const startProgress = progressRef.current
      const pointerSlot = (clientX - rect.left) / slotWidth
      const pressedOnThumb =
        pointerSlot >= startProgress - 0.05 && pointerSlot <= startProgress + 1.05
      const startIndex = latestRef.current.activeIndex
      dragRef.current = {
        source,
        touchId,
        startX: clientX,
        startY: clientY,
        originX: clientX,
        lastX: clientX,
        lastTime: timeStamp,
        velocityX: 0,
        trackLeft: rect.left,
        slotWidth,
        startIndex,
        startProgress,
        pressedOnThumb,
        dragging: false,
        progress: startProgress,
        settledIndex: startIndex,
      }
    }

    const moveDrag = (
      clientX: number,
      clientY: number,
      timeStamp: number,
      preventDefault?: () => void
    ) => {
      const drag = dragRef.current
      if (!drag) {
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
        if (animRef.current) {
          // 吸附动画中途接管拖拽时，以当前实时进度为基准，避免跳变
          stopAnimation()
          drag.startProgress = progressRef.current
          drag.originX = clientX
        }
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
      applyVisualProgress(nextProgress)

      const nextSettledIndex = resolveSettledIndex(drag.settledIndex, nextProgress)
      if (nextSettledIndex !== drag.settledIndex) {
        drag.settledIndex = nextSettledIndex
        const nextOption = CHAT_MODE_OPTIONS[nextSettledIndex]
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
        if (
          !animRef.current &&
          Math.abs(progressRef.current - latestRef.current.activeIndex) > 1e-4
        ) {
          animateTo(latestRef.current.activeIndex)
        }
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
      if (!cancelled && clientX !== null && drag.pressedOnThumb && finalIndex === drag.startIndex) {
        const totalDx = clientX - drag.startX
        if (
          Math.abs(totalDx) > drag.slotWidth * 0.18 &&
          Math.abs(drag.velocityX) >= FLICK_VELOCITY_PX_PER_MS &&
          Math.sign(drag.velocityX) === Math.sign(totalDx)
        ) {
          finalIndex = Math.max(0, Math.min(MAX_INDEX, drag.startIndex + Math.sign(totalDx)))
        }
      }

      track.classList.remove(styles.modeTrackDragging)
      animateTo(finalIndex)

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
  }, [animateTo, applyVisualProgress, stopAnimation])

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
      animateTo(nextIndex)
    }
  }

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
        {CHAT_MODE_OPTIONS.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={option.value === mode}
            className={clsx(styles.modeOption, option.value === mode && styles.modeOptionActive)}
            onClick={() => {
              onPreviewChange(option.value)
              onCommit(option.value)
              animateTo(index)
            }}
          >
            <span className={styles.modeOptionInner}>
              <span className={styles.modeIcon} aria-hidden="true">
                {option.icon}
              </span>
              <span className={styles.modeLabel}>{t(option.labelKey)}</span>
            </span>
          </button>
        ))}

        <div ref={thumbSlotRef} aria-hidden="true" className={styles.modeThumbSlot}>
          <div className={styles.modeThumb} />
        </div>

        <div ref={activeLayerRef} aria-hidden="true" className={styles.modeActiveLayer}>
          {CHAT_MODE_OPTIONS.map((option) => (
            <div key={option.value} className={styles.modeOptionOverlay}>
              <span className={styles.modeOptionInner}>
                <span className={styles.modeIcon}>{option.icon}</span>
                <span className={styles.modeLabel}>{t(option.labelKey)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 根据连续进度（0..2）定位各模式提示语：两档之间同屏呈现离开项后半段与进入项前段 */
const positionHintItems = (
  items: (HTMLParagraphElement | null)[],
  metrics: HintMetrics,
  rawProgress: number
) => {
  const { stageWidth, itemWidths } = metrics
  if (stageWidth <= 0) {
    return
  }
  const progress = clampProgress(rawProgress)
  const enterRight = stageWidth + HINT_OFFSCREEN_PAD_PX

  for (let i = 0; i < OPTION_COUNT; i++) {
    const el = items[i]
    if (!el) {
      continue
    }
    const width = itemWidths[i] ?? 0
    const exitLeft = -(width + HINT_OFFSCREEN_PAD_PX)
    let x = enterRight
    let visible = false

    if (i === 0) {
      if (progress < 1) {
        x = lerp(0, exitLeft, progress)
        visible = true
      } else {
        x = exitLeft
      }
    } else if (i === 1) {
      const restCenter = (stageWidth - width) * 0.5
      if (progress <= 0) {
        x = enterRight
      } else if (progress <= 1) {
        x = lerp(enterRight, restCenter, progress)
        visible = true
      } else if (progress < 2) {
        x = lerp(restCenter, exitLeft, progress - 1)
        visible = true
      } else {
        x = exitLeft
      }
    } else {
      const restRight = stageWidth - width
      if (progress > 1) {
        x = lerp(enterRight, restRight, progress - 1)
        visible = true
      } else {
        x = enterRight
      }
    }

    el.style.transform = `translate3d(${x}px, 0, 0)`
    el.style.visibility = visible ? 'visible' : 'hidden'
  }
}

/** 新对话：模式标题 + 可拖拽三模式滑块 + 模式说明 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const chatMode = useSettings((state) => state.chatMode)
  const [targetMode, setTargetMode] = useState<ChatMode>(chatMode)
  const [displayedMode, setDisplayedMode] = useState<ChatMode>(chatMode)
  const [textHidden, setTextHidden] = useState(false)

  const hintStageRef = useRef<HTMLDivElement>(null)
  const hintItemRefs = useRef<(HTMLParagraphElement | null)[]>([])
  const hintMetricsRef = useRef<HintMetrics>({ stageWidth: 0, itemWidths: [] })
  const hintProgressRef = useRef(getModeIndex(chatMode))

  const handleProgressChange = useCallback((progress: number) => {
    hintProgressRef.current = progress
    positionHintItems(hintItemRefs.current, hintMetricsRef.current, progress)
  }, [])

  // 测量视口及三条提示语的实际宽度与最大高度，仅在布局/语言变动时执行，拖拽期间零布局读取
  useLayoutEffect(() => {
    const stage = hintStageRef.current
    if (!stage) {
      return
    }
    const measureAndSync = () => {
      const stageWidth = stage.clientWidth
      const itemWidths: number[] = []
      let maxHeight = 40
      for (let i = 0; i < OPTION_COUNT; i++) {
        const el = hintItemRefs.current[i]
        itemWidths.push(el ? el.offsetWidth : 0)
        if (el) {
          maxHeight = Math.max(maxHeight, el.offsetHeight)
        }
      }
      hintMetricsRef.current = { stageWidth, itemWidths }
      const nextMinHeight = `${maxHeight}px`
      if (stage.style.minHeight !== nextMinHeight) {
        stage.style.minHeight = nextMinHeight
      }
      positionHintItems(hintItemRefs.current, hintMetricsRef.current, hintProgressRef.current)
    }

    measureAndSync()
    let measureRafId: number | null = null
    const scheduleMeasure = () => {
      if (measureRafId !== null) {
        return
      }
      measureRafId = window.requestAnimationFrame(() => {
        measureRafId = null
        measureAndSync()
      })
    }
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(stage)

    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) {
        measureAndSync()
      }
    })

    return () => {
      cancelled = true
      observer.disconnect()
      if (measureRafId !== null) {
        window.cancelAnimationFrame(measureRafId)
      }
    }
  }, [t])

  // 外部直接改变 chatMode 时同步目标模式
  useEffect(() => {
    setTargetMode(chatMode)
  }, [chatMode])

  // 标题仅在完整滑过到下一档或切档提交时淡出切换，连续滑过时平滑收敛到最新模式
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

          <ModeSwitch
            mode={chatMode}
            onProgressChange={handleProgressChange}
            onPreviewChange={setTargetMode}
            onCommit={setChatMode}
          />

          <div className={styles.modeHintViewport}>
            <div ref={hintStageRef} className={styles.modeHintStage}>
              {CHAT_MODE_OPTIONS.map((option, index) => (
                <p
                  key={option.value}
                  ref={(el) => {
                    hintItemRefs.current[index] = el
                  }}
                  aria-hidden={option.value !== chatMode}
                  className={clsx(styles.modeHintItem, HINT_ALIGN_CLASS[option.value])}
                >
                  {t(option.hintKey)}
                </p>
              ))}
            </div>
          </div>
        </div>

        <ChatInput sessionId={null} />
      </div>
    </div>
  )
}
