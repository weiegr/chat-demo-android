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
import { useTranslate } from '../../i18n/index.js'
import type { ChatModel } from '../../services/api/types.js'
import styles from './RpModelStage.module.css'

const FLASH_MODEL: ChatModel = 'deepseek-flash'
const PRO_MODEL: ChatModel = 'deepseek-v4-pro'

const SPLIT_PERCENT = 46
const BOTTOM_REST_PERCENT = 100 - SPLIT_PERCENT
const DRAG_THRESHOLD_PX = 8
const FLICK_VELOCITY_PX_PER_MS = 0.32
const FLICK_MIN_DISTANCE_PX = 16
const MAX_OVERDRAG = 0.085

/** 临界阻尼弹簧参数（ζ = 1.0）：起步干脆、末段丝滑落定，配合触界锁槽实现零过冲、零弹跳 */
const SPRING_OMEGA = 17
const SPRING_STIFFNESS = SPRING_OMEGA * SPRING_OMEGA
const SPRING_DAMPING = 2 * SPRING_OMEGA
const PHYSICS_STEP_SEC = 0.002
const MAX_FRAME_DT_SEC = 0.05
const MAX_RELEASE_VELOCITY = 6
const SETTLE_EPSILON = 0.0006
const SETTLE_VELOCITY_EPSILON = 0.008

interface VerticalDragState {
  source: 'touch' | 'mouse'
  touchId: number | null
  startX: number
  startY: number
  lastY: number
  lastTime: number
  velocityY: number
  startProgress: number
  dragSpan: number
  dragging: boolean
  progress: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const modelToProgress = (model: ChatModel) => (model === PRO_MODEL ? 1 : 0)

const progressToModel = (progress: number): ChatModel => (progress >= 0.5 ? PRO_MODEL : FLASH_MODEL)

const rubberBandProgress = (raw: number) => {
  if (raw < 0) {
    const over = -raw
    return -(MAX_OVERDRAG * over) / (over + 0.32)
  }
  if (raw > 1) {
    const over = raw - 1
    return 1 + (MAX_OVERDRAG * over) / (over + 0.32)
  }
  return raw
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const progressToClipPath = (progress: number) => {
  let top = progress * SPLIT_PERCENT
  let bottom = (1 - progress) * BOTTOM_REST_PERCENT
  if (progress < 0) {
    top = 0
    bottom = BOTTOM_REST_PERCENT + -progress * 32
  } else if (progress > 1) {
    top = SPLIT_PERCENT + (progress - 1) * 32
    bottom = 0
  }
  return `inset(${clamp(top, 0, 92).toFixed(2)}% 0% ${clamp(bottom, 0, 92).toFixed(2)}% 0%)`
}

/**
 * RP 模式整界面模型选择舞台：
 * 上半区为 Flash、下半区为 Pro，型号稳固置于中间水平分割线上下两侧；
 * 选中侧以品牌蓝铺满并镂空反色显示型号，未选中侧留白并以品牌蓝填充型号，
 * 支持点击与上下跟手滑动驱动蓝色幕布无过冲平滑滑移反色，杜绝字形缩放与位置弹跳。
 */
export const RpModelStage = ({
  active,
  model,
  onSelect,
  onPreviewModelChange,
}: {
  active: boolean
  model: ChatModel
  onSelect: (model: ChatModel) => void
  onPreviewModelChange?: (preview: ChatModel | null) => void
}) => {
  const t = useTranslate()
  const isFlash = model !== PRO_MODEL
  const [dragging, setDragging] = useState(false)

  const fillLayerRef = useRef<HTMLDivElement>(null)
  const hitLayerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<VerticalDragState | null>(null)
  const previewModelRef = useRef<ChatModel | null>(null)
  const suppressClickRef = useRef(false)
  const suppressTimerRef = useRef<number | null>(null)
  const lastTouchEndTimeRef = useRef(0)

  const modelProgress = modelToProgress(model)
  const progressRef = useRef(modelProgress)
  const targetRef = useRef(modelProgress)
  const velocityRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef(0)
  const prevActiveRef = useRef(active)

  const latestRef = useRef({ active, model, onSelect, onPreviewModelChange })
  latestRef.current = { active, model, onSelect, onPreviewModelChange }

  const publishPreview = useCallback((next: ChatModel | null) => {
    if (previewModelRef.current === next) {
      return
    }
    previewModelRef.current = next
    latestRef.current.onPreviewModelChange?.(next)
  }, [])

  const applyClipFrame = useCallback((progress: number) => {
    const fillLayer = fillLayerRef.current
    if (!fillLayer) {
      return
    }
    fillLayer.style.transition = 'none'
    fillLayer.style.clipPath = progressToClipPath(progress)
  }, [])

  const clearInlineMotion = useCallback(() => {
    const fillLayer = fillLayerRef.current
    if (fillLayer) {
      fillLayer.style.removeProperty('transition')
      fillLayer.style.removeProperty('clip-path')
    }
  }, [])

  const stopLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    lastFrameTimeRef.current = 0
  }, [])

  const syncIdleClip = useCallback(() => {
    const settledTarget = targetRef.current
    const expectedModel = progressToModel(settledTarget)
    // 仅当外部 model 类名已同步落到目标态时才移除内联 clip-path，保证零闪跳交接给 CSS
    if (latestRef.current.model === expectedModel) {
      clearInlineMotion()
    } else {
      applyClipFrame(settledTarget)
    }
  }, [applyClipFrame, clearInlineMotion])

  const startLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      return
    }
    lastFrameTimeRef.current = performance.now()

    const step = (now: number) => {
      const rawDt = Math.max(0, (now - lastFrameTimeRef.current) / 1000)
      lastFrameTimeRef.current = now
      const dt = Math.min(MAX_FRAME_DT_SEC, rawDt)

      if (dragRef.current?.dragging || !latestRef.current.active) {
        rafIdRef.current = null
        lastFrameTimeRef.current = 0
        return
      }

      const target = targetRef.current
      let remaining = dt
      let crossed = false
      while (remaining > 0) {
        const h = Math.min(PHYSICS_STEP_SEC, remaining)
        const prevDiff = progressRef.current - target
        const accel = -SPRING_STIFFNESS * prevDiff - SPRING_DAMPING * velocityRef.current
        velocityRef.current += accel * h
        progressRef.current += velocityRef.current * h
        const nextDiff = progressRef.current - target
        // 触达目标边线瞬间直接吸合锁槽，数学上彻底杜绝过冲回弹
        if (prevDiff !== 0 && nextDiff * prevDiff <= 0) {
          progressRef.current = target
          velocityRef.current = 0
          crossed = true
          break
        }
        remaining -= h
      }

      const settled =
        crossed ||
        (Math.abs(target - progressRef.current) <= SETTLE_EPSILON &&
          Math.abs(velocityRef.current) <= SETTLE_VELOCITY_EPSILON)

      if (settled) {
        progressRef.current = target
        velocityRef.current = 0
        rafIdRef.current = null
        lastFrameTimeRef.current = 0
        syncIdleClip()
        return
      }

      applyClipFrame(progressRef.current)
      rafIdRef.current = window.requestAnimationFrame(step)
    }

    rafIdRef.current = window.requestAnimationFrame(step)
  }, [applyClipFrame, syncIdleClip])

  const animateToProgress = useCallback(
    (nextTarget: number, initialVelocity = 0) => {
      targetRef.current = nextTarget

      if (!latestRef.current.active || prefersReducedMotion()) {
        stopLoop()
        progressRef.current = nextTarget
        velocityRef.current = 0
        if (latestRef.current.active) {
          syncIdleClip()
        } else {
          clearInlineMotion()
        }
        return
      }

      const diff = nextTarget - progressRef.current
      if (
        Math.abs(diff) <= SETTLE_EPSILON &&
        Math.abs(initialVelocity) <= SETTLE_VELOCITY_EPSILON
      ) {
        stopLoop()
        progressRef.current = nextTarget
        velocityRef.current = 0
        syncIdleClip()
        return
      }

      // 仅保留与收敛方向一致的释放初速度，避免反向噪声拖曳造成顿挫
      velocityRef.current =
        initialVelocity * diff > 0
          ? clamp(initialVelocity, -MAX_RELEASE_VELOCITY, MAX_RELEASE_VELOCITY)
          : 0

      applyClipFrame(progressRef.current)
      startLoop()
    },
    [applyClipFrame, clearInlineMotion, startLoop, stopLoop, syncIdleClip]
  )

  // 同步 active 与外部 model 变化：进退场由 CSS 控制，active 态切换模型由连续进度平滑接管
  useLayoutEffect(() => {
    const wasActive = prevActiveRef.current
    prevActiveRef.current = active
    const targetProgress = modelToProgress(model)

    if (!active) {
      stopLoop()
      dragRef.current = null
      setDragging(false)
      publishPreview(null)
      progressRef.current = targetProgress
      targetRef.current = targetProgress
      velocityRef.current = 0
      clearInlineMotion()
      return
    }

    if (!wasActive) {
      stopLoop()
      progressRef.current = targetProgress
      targetRef.current = targetProgress
      velocityRef.current = 0
      clearInlineMotion()
      return
    }

    if (dragRef.current?.dragging) {
      return
    }

    if (Math.abs(targetRef.current - targetProgress) > 1e-4) {
      animateToProgress(targetProgress)
    } else if (
      rafIdRef.current === null &&
      Math.abs(progressRef.current - targetProgress) <= SETTLE_EPSILON
    ) {
      clearInlineMotion()
    }
  }, [active, animateToProgress, clearInlineMotion, model, publishPreview, stopLoop])

  useEffect(() => () => stopLoop(), [stopLoop])

  // 原生 Touch + Mouse 上下滑动切换监听：纵向跟手拉动蓝色幕布，横向不抢占侧边栏手势
  useEffect(() => {
    const hitLayer = hitLayerRef.current
    if (!hitLayer) {
      return
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

    const beginDrag = (
      source: 'touch' | 'mouse',
      touchId: number | null,
      clientX: number,
      clientY: number,
      timeStamp: number
    ) => {
      if (!latestRef.current.active) {
        return
      }
      const height = hitLayer.getBoundingClientRect().height
      if (height <= 0) {
        return
      }
      const startProgress = clamp(progressRef.current, 0, 1)
      dragRef.current = {
        source,
        touchId,
        startX: clientX,
        startY: clientY,
        lastY: clientY,
        lastTime: timeStamp,
        velocityY: 0,
        startProgress,
        dragSpan: clamp(height * 0.34, 140, 260),
        dragging: false,
        progress: progressRef.current,
      }
    }

    const moveDrag = (
      clientX: number,
      clientY: number,
      timeStamp: number,
      preventDefault?: () => void
    ) => {
      const drag = dragRef.current
      if (!drag || !latestRef.current.active) {
        return
      }
      const dx = clientX - drag.startX
      const dy = clientY - drag.startY

      if (!drag.dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
          return
        }
        // 横向主导时立即放行，避免影响移动端侧边栏左滑/右滑手势
        if (Math.abs(dx) > Math.abs(dy) * 1.15) {
          dragRef.current = null
          return
        }
        if (Math.abs(dy) < DRAG_THRESHOLD_PX) {
          return
        }
        stopLoop()
        drag.dragging = true
        drag.startProgress = clamp(progressRef.current, 0, 1)
        drag.lastY = clientY
        drag.lastTime = timeStamp
        velocityRef.current = 0
        setDragging(true)
      }

      preventDefault?.()

      const dt = timeStamp - drag.lastTime
      if (dt > 0) {
        const instantVelocity = (clientY - drag.lastY) / dt
        drag.velocityY = drag.velocityY * 0.35 + instantVelocity * 0.65
        drag.lastY = clientY
        drag.lastTime = timeStamp
      }

      const nextProgress = rubberBandProgress(
        drag.startProgress + (clientY - drag.startY) / drag.dragSpan
      )
      drag.progress = nextProgress
      progressRef.current = nextProgress
      applyClipFrame(nextProgress)
      publishPreview(progressToModel(nextProgress))
    }

    const finishDrag = (clientY: number | null, cancelled: boolean) => {
      const drag = dragRef.current
      if (!drag) {
        return
      }
      dragRef.current = null

      if (!drag.dragging) {
        return
      }

      setDragging(false)
      suppressClickRef.current = true
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current)
      }
      suppressTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        suppressTimerRef.current = null
      }, 0)

      const totalDy = cancelled || clientY === null ? 0 : clientY - drag.startY
      const finalProgress =
        cancelled || clientY === null
          ? drag.progress
          : rubberBandProgress(drag.startProgress + totalDy / drag.dragSpan)
      progressRef.current = finalProgress

      let target: ChatModel = cancelled ? latestRef.current.model : progressToModel(finalProgress)
      if (
        !cancelled &&
        Math.abs(totalDy) >= FLICK_MIN_DISTANCE_PX &&
        Math.abs(drag.velocityY) >= FLICK_VELOCITY_PX_PER_MS &&
        Math.sign(drag.velocityY) === Math.sign(totalDy)
      ) {
        target = drag.velocityY > 0 ? PRO_MODEL : FLASH_MODEL
      }

      const releaseVelocity = cancelled ? 0 : (drag.velocityY * 1000) / drag.dragSpan
      if (target !== latestRef.current.model) {
        latestRef.current.onSelect(target)
      }
      publishPreview(null)
      animateToProgress(modelToProgress(target), releaseVelocity)
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
      finishDrag(touch.clientY, false)
    }

    const onTouchCancel = (event: TouchEvent) => {
      const drag = dragRef.current
      if (!drag || drag.source !== 'touch') {
        return
      }
      const touch = findTrackedTouch(event.changedTouches, drag.touchId)
      lastTouchEndTimeRef.current = Date.now()
      finishDrag(touch?.clientY ?? null, true)
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
      finishDrag(event.clientY, false)
    }

    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || Date.now() - lastTouchEndTimeRef.current < 600) {
        return
      }
      beginDrag('mouse', null, event.clientX, event.clientY, event.timeStamp)
      window.addEventListener('mousemove', onWindowMouseMove)
      window.addEventListener('mouseup', onWindowMouseUp)
    }

    hitLayer.addEventListener('touchstart', onTouchStart, { passive: true })
    hitLayer.addEventListener('touchmove', onTouchMove, { passive: false })
    hitLayer.addEventListener('touchend', onTouchEnd, { passive: true })
    hitLayer.addEventListener('touchcancel', onTouchCancel, { passive: true })
    hitLayer.addEventListener('mousedown', onMouseDown)

    return () => {
      hitLayer.removeEventListener('touchstart', onTouchStart)
      hitLayer.removeEventListener('touchmove', onTouchMove)
      hitLayer.removeEventListener('touchend', onTouchEnd)
      hitLayer.removeEventListener('touchcancel', onTouchCancel)
      hitLayer.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onWindowMouseUp)
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current)
        suppressTimerRef.current = null
      }
      stopLoop()
      clearInlineMotion()
    }
  }, [animateToProgress, applyClipFrame, clearInlineMotion, publishPreview, stopLoop])

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

  const selectModel = useCallback(
    (next: ChatModel) => {
      publishPreview(null)
      if (next !== latestRef.current.model) {
        onSelect(next)
      }
      animateToProgress(modelToProgress(next))
    },
    [animateToProgress, onSelect, publishPreview]
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      selectModel(FLASH_MODEL)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      selectModel(PRO_MODEL)
    }
  }

  return (
    <div
      className={clsx(
        styles.stage,
        active && styles.stageActive,
        dragging && styles.stageDragging,
        isFlash ? styles.selectedFlash : styles.selectedPro
      )}
      aria-hidden={!active}
    >
      {/* 底层：页面留白底色 + 品牌蓝填充型号 + 中间水平分割线 */}
      <div className={styles.baseLayer} aria-hidden="true">
        <div className={styles.topSlot}>
          <span className={clsx(styles.modelWord, styles.wordTop, styles.wordBlue)}>Flash</span>
        </div>
        <div className={styles.divider} />
        <div className={styles.bottomSlot}>
          <span className={clsx(styles.modelWord, styles.wordBottom, styles.wordBlue)}>Pro</span>
        </div>
      </div>

      {/* 前景层：与底层像素级重合的蓝色填充幕布 + 留白镂空型号，通过 clip-path 液态滑移反色 */}
      <div ref={fillLayerRef} className={styles.fillLayer} aria-hidden="true">
        <div className={styles.topSlot}>
          <span className={clsx(styles.modelWord, styles.wordTop, styles.wordBlank)}>Flash</span>
        </div>
        <div className={styles.bottomSlot}>
          <span className={clsx(styles.modelWord, styles.wordBottom, styles.wordBlank)}>Pro</span>
        </div>
      </div>

      {/* 交互热区层：整片上半区选 Flash，整片下半区选 Pro，同时支持上下跟手滑动切换 */}
      <div
        ref={hitLayerRef}
        role="radiogroup"
        aria-label={t('settingsRpModel')}
        className={styles.hitLayer}
        onClickCapture={handleClickCapture}
        onKeyDown={handleKeyDown}
      >
        <button
          type="button"
          role="radio"
          aria-checked={isFlash}
          aria-label={t('settingsRpModelFlash')}
          tabIndex={active ? (isFlash ? 0 : -1) : -1}
          className={clsx(styles.hitZone, styles.hitTop)}
          onClick={() => selectModel(FLASH_MODEL)}
        />
        <button
          type="button"
          role="radio"
          aria-checked={!isFlash}
          aria-label={t('settingsRpModelPro')}
          tabIndex={active ? (!isFlash ? 0 : -1) : -1}
          className={clsx(styles.hitZone, styles.hitBottom)}
          onClick={() => selectModel(PRO_MODEL)}
        />
      </div>
    </div>
  )
}
