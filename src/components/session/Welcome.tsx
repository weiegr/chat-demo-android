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
import { getImeMotionState, hasNativeImeMotion, subscribeImeMotion } from '../../app/imeMotion.js'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { setChatMode, useSettings, type ChatMode } from '../../services/settings.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { useMobileSider } from '../sider/mobileSiderState.js'
import { CHAT_MODE_OPTIONS } from './chatModeMeta.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

const OPTION_COUNT = CHAT_MODE_OPTIONS.length
const MAX_INDEX = OPTION_COUNT - 1

/** 二阶弹簧物理参数：阻尼比 ~0.78，起步跟手清脆、落位带 ~1.8% 极致克制的微弹手感 */
const SPRING_STIFFNESS = 380
const SPRING_DAMPING = 30.5
/** 固定物理积分步长（2ms），保证 60/90/120Hz 刷新率下弹簧手感完全一致 */
const PHYSICS_STEP_SEC = 0.002
const MAX_FRAME_DT_SEC = 0.05
const MAX_FLING_VELOCITY = 16
/** 左右边界橡皮筋最大越界幅度（档位） */
const MAX_OVERDRAG = 0.085
/** 胶囊外扩缓冲（与 CSS .modeActiveLayer 左右额外留白一致，确保微弹与橡皮筋不裁边） */
const ACTIVE_LAYER_EXTRA_PAD_PX = 12
const THUMB_BASE_OUTSET_PX = 4

/** 横向拖动超过该像素后进入滑块跟手拖拽态 */
const DRAG_THRESHOLD_PX = 5
/** 轻甩手势速度阈值（px/ms） */
const FLICK_VELOCITY_PX_PER_MS = 0.28

/** 标题与提示语的连续交叉淡入淡出参数：0.56 窗口兼顾零空白感与中点零重影 */
const TITLE_FADE_SPAN = 0.56
const TITLE_SHIFT_PX = 16
const HINT_FADE_SPAN = 0.56
const HINT_SHIFT_PX = 28

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
}

/** 点击跨两档（0 <-> 2）直达信息：跳过中间档文字闪现，拖拽接管时立即清空 */
interface DirectTransition {
  from: number
  to: number
}

export interface ModeMotionFrame {
  progress: number
  direct: DirectTransition | null
}

interface HintMetrics {
  stageWidth: number
  itemWidths: number[]
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/** 边界橡皮筋阻尼：区间 [0, 2] 内 1:1 跟手，越界后渐进增加阻力 */
const rubberBandProgress = (raw: number): number => {
  if (raw < 0) {
    const over = -raw
    return -(MAX_OVERDRAG * over) / (over + 0.35)
  }
  if (raw > MAX_INDEX) {
    const over = raw - MAX_INDEX
    return MAX_INDEX + (MAX_OVERDRAG * over) / (over + 0.35)
  }
  return raw
}

const getModeIndex = (mode: ChatMode) =>
  Math.max(
    0,
    CHAT_MODE_OPTIONS.findIndex((item) => item.value === mode)
  )

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const computeDragProgress = (drag: DragState, clientX: number) => {
  const raw = drag.pressedOnThumb
    ? drag.startProgress + (clientX - drag.originX) / drag.slotWidth
    : (clientX - drag.trackLeft) / drag.slotWidth - 0.5
  return rubberBandProgress(raw)
}

/**
 * 解析各选项相对当前动效状态的带符号距离 d：
 * - 拖拽 / 单档切换：d = i - progress，完全连续跟手；
 * - 点击跨两档直达（0 <-> 2）：仅在 from 与 to 之间平滑过渡，中间档不闪现。
 */
const resolveTextDistance = (
  index: number,
  progress: number,
  direct: DirectTransition | null
): number | null => {
  if (direct && Math.abs(direct.to - direct.from) > 1) {
    if (index !== direct.from && index !== direct.to) {
      return null
    }
    const span = direct.to - direct.from
    const dir = Math.sign(span)
    const u = clamp((progress - direct.from) / span, 0, 1)
    return index === direct.from ? -dir * u : dir * (1 - u)
  }
  return index - progress
}

/** 由单一连续动效帧同步驱动三条标题：零空白期、带方向微移与轻微景深缩放 */
const positionTitleItems = (
  items: (HTMLSpanElement | null)[],
  progress: number,
  direct: DirectTransition | null
) => {
  for (let i = 0; i < OPTION_COUNT; i++) {
    const el = items[i]
    if (!el) {
      continue
    }
    const d = resolveTextDistance(i, progress, direct)
    if (d === null || Math.abs(d) >= TITLE_FADE_SPAN) {
      el.style.opacity = '0'
      el.style.visibility = 'hidden'
      continue
    }
    const alpha = smoothstep(1 - Math.abs(d) / TITLE_FADE_SPAN)
    const tx = d * TITLE_SHIFT_PX
    const scale = 0.965 + 0.035 * alpha
    el.style.visibility = 'visible'
    el.style.opacity = alpha.toFixed(4)
    el.style.transform = `translate3d(${tx.toFixed(2)}px, 0, 0) scale(${scale.toFixed(4)})`
  }
}

/** 由单一连续动效帧同步驱动三条模式说明：在各自对齐锚点附近短距柔滑移并交叉淡入淡出 */
const positionHintItems = (
  items: (HTMLParagraphElement | null)[],
  metrics: HintMetrics,
  progress: number,
  direct: DirectTransition | null
) => {
  const { stageWidth, itemWidths } = metrics
  if (stageWidth <= 0) {
    return
  }
  for (let i = 0; i < OPTION_COUNT; i++) {
    const el = items[i]
    if (!el) {
      continue
    }
    const d = resolveTextDistance(i, progress, direct)
    if (d === null || Math.abs(d) >= HINT_FADE_SPAN) {
      el.style.opacity = '0'
      el.style.visibility = 'hidden'
      continue
    }
    const width = itemWidths[i] ?? 0
    const restX = i === 0 ? 0 : i === 1 ? (stageWidth - width) * 0.5 : stageWidth - width
    const alpha = smoothstep(1 - Math.abs(d) / HINT_FADE_SPAN)
    const tx = restX + d * HINT_SHIFT_PX
    el.style.visibility = 'visible'
    el.style.opacity = alpha.toFixed(4)
    el.style.transform = `translate3d(${tx.toFixed(2)}px, 0, 0)`
  }
}

/**
 * 可点击、可拖拽的三模式分段滑块：
 * 二阶弹簧物理驱动胶囊位姿、按压微膨、速度果冻拉伸与边界橡皮筋阻尼，
 * 并像素级锁步同步蓝字高亮裁切与上下文字过渡。
 */
const ModeSwitch = ({
  mode,
  onMotionFrame,
  onMotionActiveChange,
  onCommit,
}: {
  mode: ChatMode
  onMotionFrame: (frame: ModeMotionFrame) => void
  onMotionActiveChange: (active: boolean) => void
  onCommit: (next: ChatMode) => void
}) => {
  const t = useTranslate()
  const switchRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbSlotRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const activeLayerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const initializedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const suppressTimerRef = useRef<number | null>(null)
  const lastTouchEndTimeRef = useRef(0)

  const [popTick, setPopTick] = useState(0)
  const [popIndex, setPopIndex] = useState(-1)

  const activeIndex = getModeIndex(mode)
  const trackWidthRef = useRef(0)
  const progressRef = useRef(activeIndex)
  const velocityRef = useRef(0)
  const targetRef = useRef(activeIndex)
  const pressRef = useRef(0)
  const targetPressRef = useRef(0)
  const stretchRef = useRef(0)
  const directRef = useRef<DirectTransition | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef(0)
  const motionActiveRef = useRef(false)

  const latestRef = useRef({ activeIndex, mode, onMotionFrame, onMotionActiveChange, onCommit })
  latestRef.current = { activeIndex, mode, onMotionFrame, onMotionActiveChange, onCommit }

  const setMotionActive = useCallback((active: boolean) => {
    if (motionActiveRef.current === active) {
      return
    }
    motionActiveRef.current = active
    latestRef.current.onMotionActiveChange(active)
  }, [])

  const renderVisuals = useCallback(() => {
    const progress = progressRef.current
    const press = pressRef.current
    const stretch = stretchRef.current

    // 按压时胶囊轻盈膨起，高速掠过时水平微拉、纵向微收（保持体积感的果冻形变）
    const scaleX = 1 + 0.022 * press + stretch
    const scaleY = 1 + 0.032 * press - 0.45 * stretch

    const thumbSlot = thumbSlotRef.current
    if (thumbSlot) {
      thumbSlot.style.transform = `translate3d(${progress * 100}%, 0, 0)`
    }

    const thumb = thumbRef.current
    if (thumb) {
      thumb.style.transform = `scale3d(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)}, 1)`
    }

    const activeLayer = activeLayerRef.current
    const trackWidth = trackWidthRef.current || trackRef.current?.clientWidth || 0
    if (activeLayer && trackWidth > 0) {
      const slotWidth = trackWidth / OPTION_COUNT
      const baseThumbWidth = slotWidth + THUMB_BASE_OUTSET_PX * 2
      const extraX = baseThumbWidth * (scaleX - 1) * 0.5
      const clipLeft = Math.max(0, ACTIVE_LAYER_EXTRA_PAD_PX + progress * slotWidth - extraX)
      const clipRight = Math.max(
        0,
        ACTIVE_LAYER_EXTRA_PAD_PX + (MAX_INDEX - progress) * slotWidth - extraX
      )
      activeLayer.style.clipPath = `inset(0px ${clipRight.toFixed(2)}px 0px ${clipLeft.toFixed(2)}px round var(--mode-clip-radius))`
    }

    latestRef.current.onMotionFrame({
      progress,
      direct: directRef.current,
    })
  }, [])

  const stopLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    lastFrameTimeRef.current = 0
    setMotionActive(false)
  }, [setMotionActive])

  const startLoop = useCallback(() => {
    setMotionActive(true)
    if (rafIdRef.current !== null) {
      return
    }
    lastFrameTimeRef.current = performance.now()

    const step = (now: number) => {
      const rawDt = Math.max(0, (now - lastFrameTimeRef.current) / 1000)
      lastFrameTimeRef.current = now
      const dt = Math.min(MAX_FRAME_DT_SEC, rawDt)

      const dragging = Boolean(dragRef.current?.dragging)

      if (!dragging) {
        let remaining = dt
        while (remaining > 0) {
          const h = Math.min(PHYSICS_STEP_SEC, remaining)
          const accel =
            SPRING_STIFFNESS * (targetRef.current - progressRef.current) -
            SPRING_DAMPING * velocityRef.current
          velocityRef.current += accel * h
          progressRef.current += velocityRef.current * h
          remaining -= h
        }
      }

      // 按压与速度形变做一阶平滑跟随，避免瞬时加速度跳跃
      const targetStretch = clamp(Math.abs(velocityRef.current) * 0.0044, 0, 0.055)
      const pressBlend = 1 - Math.exp(-dt * 28)
      const stretchBlend = 1 - Math.exp(-dt * 26)
      pressRef.current += (targetPressRef.current - pressRef.current) * pressBlend
      stretchRef.current += (targetStretch - stretchRef.current) * stretchBlend

      const settledSpring =
        !dragging &&
        Math.abs(targetRef.current - progressRef.current) < 0.0008 &&
        Math.abs(velocityRef.current) < 0.008
      const settledMorph =
        Math.abs(targetPressRef.current - pressRef.current) < 0.002 && stretchRef.current < 0.0008

      if (settledSpring) {
        progressRef.current = targetRef.current
        velocityRef.current = 0
        directRef.current = null
      }
      if (settledMorph) {
        pressRef.current = targetPressRef.current
        stretchRef.current = 0
      }

      renderVisuals()

      if (dragging || !settledSpring || !settledMorph) {
        rafIdRef.current = window.requestAnimationFrame(step)
      } else {
        rafIdRef.current = null
        lastFrameTimeRef.current = 0
        setMotionActive(false)
      }
    }

    rafIdRef.current = window.requestAnimationFrame(step)
  }, [renderVisuals, setMotionActive])

  const springTo = useCallback(
    (
      nextIndex: number,
      options?: { initialVelocity?: number; directFrom?: number | null; triggerPop?: boolean }
    ) => {
      const clampedTarget = clamp(nextIndex, 0, MAX_INDEX)
      targetRef.current = clampedTarget

      if (options?.initialVelocity !== undefined) {
        velocityRef.current = clamp(
          options.initialVelocity,
          -MAX_FLING_VELOCITY,
          MAX_FLING_VELOCITY
        )
      }

      if (options?.directFrom !== undefined) {
        directRef.current =
          options.directFrom !== null && Math.abs(clampedTarget - options.directFrom) > 1
            ? { from: options.directFrom, to: clampedTarget }
            : null
      }

      if (options?.triggerPop && !prefersReducedMotion()) {
        setPopIndex(clampedTarget)
        setPopTick((tick) => tick + 1)
      }

      if (prefersReducedMotion()) {
        stopLoop()
        progressRef.current = clampedTarget
        velocityRef.current = 0
        pressRef.current = 0
        targetPressRef.current = 0
        stretchRef.current = 0
        directRef.current = null
        renderVisuals()
        return
      }

      startLoop()
    },
    [renderVisuals, startLoop, stopLoop]
  )

  // 首次挂载直接对齐初始档位，后续非拖拽态切档时以弹簧丝滑过渡
  useLayoutEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      trackWidthRef.current = trackRef.current?.clientWidth ?? 0
      progressRef.current = activeIndex
      targetRef.current = activeIndex
      velocityRef.current = 0
      directRef.current = null
      renderVisuals()
      return
    }
    if (dragRef.current?.dragging) {
      return
    }
    if (Math.abs(targetRef.current - activeIndex) > 1e-4) {
      const from = Math.round(clamp(progressRef.current, 0, MAX_INDEX))
      springTo(activeIndex, { directFrom: from, triggerPop: true })
    }
  }, [activeIndex, renderVisuals, springTo])

  useEffect(() => () => stopLoop(), [stopLoop])

  // 检测分段滑块横向空间是否拥挤并同步轨道宽度，保证 clip-path 像素级精确
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
      trackWidthRef.current = track.clientWidth
      renderVisuals()
    }

    updateLayout()
    const observer = new ResizeObserver(updateLayout)
    observer.observe(track)
    return () => observer.disconnect()
  }, [renderVisuals, t])

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
      trackWidthRef.current = rect.width
      const slotWidth = rect.width / OPTION_COUNT
      const startProgress = progressRef.current
      const pointerSlot = (clientX - rect.left) / slotWidth
      const pressedOnThumb =
        pointerSlot >= startProgress - 0.08 && pointerSlot <= startProgress + 1.08
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
      }
      if (pressedOnThumb && !prefersReducedMotion()) {
        targetPressRef.current = 1
        startLoop()
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
          targetPressRef.current = 0
          startLoop()
          return
        }
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) {
          return
        }
        drag.dragging = true
        // 拖拽接管：切回全连续 scrub 模式，以当前实时进度为基准零跳变跟手
        directRef.current = null
        drag.startProgress = clamp(progressRef.current, 0, MAX_INDEX)
        drag.originX = clientX
        drag.lastX = clientX
        drag.lastTime = timeStamp
        velocityRef.current = 0
        targetPressRef.current = 1
        track.classList.add(styles.modeTrackDragging)
        startLoop()
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
      progressRef.current = nextProgress
      // 同步速度用于驱动跟手期间极轻的果冻微拉伸
      velocityRef.current = clamp(
        (drag.velocityX * 1000) / drag.slotWidth,
        -MAX_FLING_VELOCITY,
        MAX_FLING_VELOCITY
      )
      renderVisuals()
    }

    const finishDrag = (clientX: number | null, cancelled: boolean) => {
      const drag = dragRef.current
      if (!drag) {
        return
      }
      dragRef.current = null
      targetPressRef.current = 0

      if (!drag.dragging) {
        if (Math.abs(progressRef.current - latestRef.current.activeIndex) > 1e-4) {
          springTo(latestRef.current.activeIndex, { directFrom: null })
        } else if (!prefersReducedMotion()) {
          startLoop()
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
      const clampedForRound = clamp(finalProgress, 0, MAX_INDEX)
      let finalIndex = Math.round(clampedForRound)
      if (!cancelled && clientX !== null && drag.pressedOnThumb && finalIndex === drag.startIndex) {
        const totalDx = clientX - drag.startX
        if (
          Math.abs(totalDx) > drag.slotWidth * 0.16 &&
          Math.abs(drag.velocityX) >= FLICK_VELOCITY_PX_PER_MS &&
          Math.sign(drag.velocityX) === Math.sign(totalDx)
        ) {
          finalIndex = clamp(drag.startIndex + Math.sign(totalDx), 0, MAX_INDEX)
        }
      }

      track.classList.remove(styles.modeTrackDragging)
      const releaseVelocity = cancelled ? 0 : (drag.velocityX * 1000) / drag.slotWidth
      const changed = CHAT_MODE_OPTIONS[finalIndex]?.value !== latestRef.current.mode
      springTo(finalIndex, {
        initialVelocity: releaseVelocity,
        directFrom: null,
        triggerPop: changed,
      })

      const nextOption = CHAT_MODE_OPTIONS[finalIndex]
      if (nextOption && nextOption.value !== latestRef.current.mode) {
        latestRef.current.onCommit(nextOption.value)
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
  }, [renderVisuals, springTo, startLoop])

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

  const selectIndex = useCallback(
    (index: number) => {
      const nextOption = CHAT_MODE_OPTIONS[index]
      if (!nextOption) {
        return
      }
      const from = activeIndex
      if (nextOption.value !== mode) {
        onCommit(nextOption.value)
        springTo(index, { directFrom: from, triggerPop: true })
      } else if (Math.abs(progressRef.current - index) > 1e-3) {
        springTo(index, { directFrom: null })
      }
    },
    [activeIndex, mode, onCommit, springTo]
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = clamp(activeIndex + delta, 0, MAX_INDEX)
    selectIndex(nextIndex)
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
            onClick={() => selectIndex(index)}
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
          <div ref={thumbRef} className={styles.modeThumb} />
        </div>

        <div ref={activeLayerRef} aria-hidden="true" className={styles.modeActiveLayer}>
          {CHAT_MODE_OPTIONS.map((option, index) => (
            <div key={option.value} className={styles.modeOptionOverlay}>
              <span className={styles.modeOptionInner}>
                <span
                  key={index === popIndex ? `pop-${popTick}` : option.value}
                  className={clsx(
                    styles.modeIcon,
                    index === popIndex && popTick > 0 && styles.modeIconPop
                  )}
                >
                  {option.icon}
                </span>
                <span className={styles.modeLabel}>{t(option.labelKey)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 新对话：模式标题 + 物理弹性三模式滑块 + 模式说明 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = ({ onStartCall }: { onStartCall?: (sessionId: string | null) => void }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const chatMode = useSettings((state) => state.chatMode)

  const heroRef = useRef<HTMLDivElement>(null)
  const cameraShortcutRef = useRef<(() => void) | null>(null)
  const inputSlotRef = useRef<HTMLDivElement>(null)
  const maxHeroLiftRef = useRef(0)
  const prewarmTimerRef = useRef<number | null>(null)
  const titleItemRefs = useRef<(HTMLSpanElement | null)[]>([])
  const hintStageRef = useRef<HTMLDivElement>(null)
  const hintItemRefs = useRef<(HTMLParagraphElement | null)[]>([])
  const hintMetricsRef = useRef<HintMetrics>({ stageWidth: 0, itemWidths: [] })
  const motionFrameRef = useRef<ModeMotionFrame>({
    progress: getModeIndex(chatMode),
    direct: null,
  })

  const handleMotionFrame = useCallback((frame: ModeMotionFrame) => {
    motionFrameRef.current = frame
    positionTitleItems(titleItemRefs.current, frame.progress, frame.direct)
    positionHintItems(hintItemRefs.current, hintMetricsRef.current, frame.progress, frame.direct)
  }, [])

  const handleMotionActiveChange = useCallback((active: boolean) => {
    heroRef.current?.classList.toggle(styles.heroAnimating, active)
  }, [])

  // 手指刚触碰输入框时（早于系统 IME onPrepare ~50ms）提前预热两个小合成层，消除冷启动首帧上传尖峰
  const prewarmImeLayers = useCallback(() => {
    if (!isMobile || !hasNativeImeMotion()) {
      return
    }
    const hero = heroRef.current
    const inputSlot = inputSlotRef.current
    if (!hero || !inputSlot) {
      return
    }
    hero.style.willChange = 'transform'
    inputSlot.style.willChange = 'transform'
    if (prewarmTimerRef.current !== null) {
      window.clearTimeout(prewarmTimerRef.current)
    }
    prewarmTimerRef.current = window.setTimeout(() => {
      prewarmTimerRef.current = null
      const ime = getImeMotionState()
      if (!ime.animating && ime.shift <= 0.05) {
        heroRef.current?.style.removeProperty('will-change')
        inputSlotRef.current?.style.removeProperty('will-change')
      }
    }, 500)
  }, [isMobile])

  // Android 原生键盘动效：由纯 GPU translate3d 同步驱动输入框与 hero 区，零重排零 WebView Resize
  useLayoutEffect(() => {
    const hero = heroRef.current
    const inputSlot = inputSlotRef.current
    if (!isMobile || !hasNativeImeMotion() || !hero || !inputSlot) {
      return
    }

    const SMOOTH_SETTLE_TRANSITION = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)'
    let smoothTimer: number | null = null

    const clearSmoothTransition = () => {
      if (smoothTimer !== null) {
        window.clearTimeout(smoothTimer)
        smoothTimer = null
      }
      hero.style.removeProperty('transition')
      inputSlot.style.removeProperty('transition')
    }

    const cacheMaxHeroLift = () => {
      // 附件面板展开或向键盘收拢期间 hero 已被临时顶高，保持自然态上移余量，避免截断或收起首帧回跳
      if (
        inputSlot.querySelector('[data-open="true"], [aria-hidden="true"][style*="height"]') &&
        maxHeroLiftRef.current > 0
      ) {
        return
      }
      // offsetTop 不受 transform 影响，直接反映自然状态下 hero 距顶栏下沿的可用上移余量
      maxHeroLiftRef.current = Math.max(0, hero.offsetTop - 8)
    }

    let lifted = false

    const applyShift = (shift: number, animating: boolean, smoothSettle = false) => {
      lifted = shift > 0.05
      clearSmoothTransition()
      if (smoothSettle && !prefersReducedMotion()) {
        hero.style.willChange = 'transform'
        inputSlot.style.willChange = 'transform'
        hero.style.transition = SMOOTH_SETTLE_TRANSITION
        inputSlot.style.transition = SMOOTH_SETTLE_TRANSITION
        const heroShift = shift > 0.05 ? Math.min(shift * 0.5, maxHeroLiftRef.current) : 0
        inputSlot.style.transform =
          shift > 0.05 ? `translate3d(0, ${(-shift).toFixed(2)}px, 0)` : 'translate3d(0, 0, 0)'
        hero.style.transform =
          heroShift > 0.05
            ? `translate3d(0, ${(-heroShift).toFixed(2)}px, 0)`
            : 'translate3d(0, 0, 0)'
        smoothTimer = window.setTimeout(() => {
          smoothTimer = null
          hero.style.removeProperty('transition')
          inputSlot.style.removeProperty('transition')
          if (shift <= 0.05) {
            inputSlot.style.removeProperty('transform')
            hero.style.removeProperty('transform')
            hero.style.removeProperty('will-change')
            inputSlot.style.removeProperty('will-change')
          }
        }, 200)
        return
      }
      if (animating) {
        hero.style.willChange = 'transform'
        inputSlot.style.willChange = 'transform'
      } else if (shift <= 0.05) {
        hero.style.removeProperty('will-change')
        inputSlot.style.removeProperty('will-change')
      }
      if (shift > 0.05) {
        const heroShift = Math.min(shift * 0.5, maxHeroLiftRef.current)
        inputSlot.style.transform = `translate3d(0, ${(-shift).toFixed(2)}px, 0)`
        hero.style.transform =
          heroShift > 0.05 ? `translate3d(0, ${(-heroShift).toFixed(2)}px, 0)` : ''
      } else {
        inputSlot.style.removeProperty('transform')
        hero.style.removeProperty('transform')
      }
    }

    cacheMaxHeroLift()
    const initial = getImeMotionState()
    if (!useMobileSider.getState().open) {
      applyShift(initial.shift, initial.animating)
    }

    const unsubscribe = subscribeImeMotion((phase, ime) => {
      if (prewarmTimerRef.current !== null) {
        window.clearTimeout(prewarmTimerRef.current)
        prewarmTimerRef.current = null
      }
      // 移动端侧边栏打开期间（如侧栏重命名会话）弹起键盘时，保持右侧露出的欢迎页静止
      if (useMobileSider.getState().open && !lifted) {
        return
      }
      if (phase === 'prepare') {
        clearSmoothTransition()
        cacheMaxHeroLift()
        hero.style.willChange = 'transform'
        inputSlot.style.willChange = 'transform'
        return
      }
      if (phase === 'start' && ime.opening && maxHeroLiftRef.current <= 0) {
        cacheMaxHeroLift()
      }
      applyShift(ime.shift, ime.animating, phase === 'end' && ime.smoothSettle)
    })

    return () => {
      unsubscribe()
      clearSmoothTransition()
      if (prewarmTimerRef.current !== null) {
        window.clearTimeout(prewarmTimerRef.current)
        prewarmTimerRef.current = null
      }
      hero.style.removeProperty('transform')
      hero.style.removeProperty('will-change')
      inputSlot.style.removeProperty('transform')
      inputSlot.style.removeProperty('will-change')
    }
  }, [isMobile])

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
      const { progress, direct } = motionFrameRef.current
      positionTitleItems(titleItemRefs.current, progress, direct)
      positionHintItems(hintItemRefs.current, hintMetricsRef.current, progress, direct)
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

  return (
    <div className={styles.container}>
      {isMobile ? (
        <MobileHeader memorySession={null} onTakePhoto={() => cameraShortcutRef.current?.()} />
      ) : null}
      <div className={styles.welcome}>
        <div ref={heroRef} className={styles.hero}>
          <div className={styles.greeting}>
            {CHAT_MODE_OPTIONS.map((option, index) => (
              <span
                key={option.value}
                ref={(el) => {
                  titleItemRefs.current[index] = el
                }}
                aria-hidden={option.value !== chatMode}
                className={styles.greetingText}
              >
                {t(option.titleKey)}
              </span>
            ))}
          </div>

          <ModeSwitch
            mode={chatMode}
            onMotionFrame={handleMotionFrame}
            onMotionActiveChange={handleMotionActiveChange}
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

        <div
          ref={inputSlotRef}
          className={styles.inputSlot}
          onTouchStartCapture={prewarmImeLayers}
          onFocusCapture={prewarmImeLayers}
        >
          <ChatInput
            sessionId={null}
            onStartCall={onStartCall}
            cameraShortcutRef={cameraShortcutRef}
          />
        </div>
      </div>
    </div>
  )
}
