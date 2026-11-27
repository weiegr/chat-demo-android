import { useCallback, useEffect, useRef, type RefObject } from 'react'

export type HeroSnapTarget = 'expanded' | 'collapsed'
export type HeroScrollSource = 'touch' | 'wheel'

interface ScrollSample {
  top: number
  time: number
}

export interface HeroSnapDecisionInput {
  scrollTop: number
  collapseDistance: number
  gestureStartScrollTop: number | null
  releaseVelocity: number
  source: HeroScrollSource
}

export interface SpringStepResult {
  position: number
  velocity: number
  settled: boolean
}

/** 判定处于过渡区间的边界容差（px），兼顾高 DPR 设备亚像素滚动值 */
const SNAP_EDGE_EPSILON = 1
/** 轻扫切态速度阈值（px/ms，即 320px/s） */
const FLICK_VELOCITY_THRESHOLD = 0.32
/** 轻扫切态最小有效位移（px），防止轻触微抖误触发 */
const FLICK_MIN_DISPLACEMENT = 18
/** 慢速拖拽的磁滞脱离比例：从任一磁极拉过 36% 脱离原磁极并吸向对端 */
const TOUCH_HYSTERESIS_RATIO = 0.36
/** 鼠标滚轮/触控板的脱离比例，确保单格滚轮切换干脆顺手 */
const WHEEL_HYSTERESIS_RATIO = 0.28
/** 从设置页顶端往下轻拉时认定处于折叠态边缘的容差（px） */
const COLLAPSED_ZONE_MARGIN = 96
/** 慢拖松手判定阈值（px/ms）：低于此速度视作无原生 fling，快速触发磁吸避免僵直 */
const SLOW_RELEASE_VELOCITY = 0.12
/** 速度采样滑窗时长（ms） */
const VELOCITY_WINDOW_MS = 95
/** 样本过期阈值（ms）：超过此时长无滚动说明手指已静止悬停 */
const VELOCITY_STALE_MS = 75
/** 松手轻扫意图在原生 fling 期间的有效保留时长（ms） */
const FLICK_INTENT_TTL_MS = 650

/** 磁吸弹簧物理参数：轻阻尼弹簧 + 近距磁阱引力增强，越近磁极吸力越干脆，触达磁极即利落锁槽 */
const SPRING_BASE_OMEGA = 20.5
const MAGNETIC_WELL_RADIUS = 64
const MAGNETIC_WELL_STIFFNESS_BOOST = 1.2
const SPRING_DAMPING_RATIO = 0.92
const SPRING_SUB_DT = 1 / 240
const SPRING_SETTLE_DISTANCE = 0.45
const SPRING_SETTLE_VELOCITY = 24
const SPRING_MAX_DURATION_MS = 900

/** 读取滚动容器实际可达的有效折叠距离 */
const getEffectiveCollapseDistance = (el: HTMLElement, maxDistance: number) => {
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  return Math.min(maxDistance, maxScroll)
}

/**
 * 决策过渡带内的磁吸目标：
 * - 从展开态或设置页顶端出发且有明确轻扫速度时，顺应手势方向一步吸合；
 * - 慢速拖拽采用磁滞阈值（36%），微滑自动回弹、过阈果断切换；
 * - 从设置页深处惯性回滚停在过渡带时，按几何中点平分，避免回顶微过冲误弹个人中心。
 */
export const resolveHeroSnapTarget = ({
  scrollTop,
  collapseDistance,
  gestureStartScrollTop,
  releaseVelocity,
  source,
}: HeroSnapDecisionInput): number => {
  if (collapseDistance <= 0) {
    return 0
  }
  const progress = scrollTop / collapseDistance

  if (source === 'touch') {
    if (
      releaseVelocity >= FLICK_VELOCITY_THRESHOLD &&
      scrollTop >= FLICK_MIN_DISPLACEMENT &&
      (gestureStartScrollTop === null || gestureStartScrollTop < collapseDistance)
    ) {
      return collapseDistance
    }
    if (
      releaseVelocity <= -FLICK_VELOCITY_THRESHOLD &&
      collapseDistance - scrollTop >= FLICK_MIN_DISPLACEMENT &&
      (gestureStartScrollTop === null ||
        gestureStartScrollTop <= collapseDistance + COLLAPSED_ZONE_MARGIN)
    ) {
      return 0
    }
  }

  const threshold = source === 'wheel' ? WHEEL_HYSTERESIS_RATIO : TOUCH_HYSTERESIS_RATIO

  if (gestureStartScrollTop !== null) {
    if (gestureStartScrollTop < collapseDistance * 0.5) {
      return progress >= threshold ? collapseDistance : 0
    }
    if (gestureStartScrollTop <= collapseDistance + COLLAPSED_ZONE_MARGIN) {
      return progress <= 1 - threshold ? 0 : collapseDistance
    }
    return progress < 0.5 ? 0 : collapseDistance
  }

  return progress >= 0.5 ? collapseDistance : 0
}

/**
 * 240Hz 固定子步长的磁吸弹簧积分器：
 * 距离目标磁极小于 64px 时仅增强磁吸刚度而不增加粘滞阻尼，营造真磁铁近距利落吸合的手感；
 * 触达磁极瞬间直接锁槽归位，杜绝越界回弹抖动。
 */
export const stepMagneticSpring = (
  position: number,
  velocity: number,
  target: number,
  dtSeconds: number
): SpringStepResult => {
  let pos = position
  let vel = velocity
  let remaining = Math.min(Math.max(dtSeconds, 0), 0.05)
  const baseStiffness = SPRING_BASE_OMEGA * SPRING_BASE_OMEGA
  const damping = 2 * SPRING_DAMPING_RATIO * SPRING_BASE_OMEGA

  while (remaining > 0) {
    const step = remaining > SPRING_SUB_DT ? SPRING_SUB_DT : remaining
    remaining -= step

    const displacement = pos - target
    const dist = Math.abs(displacement)
    const wellFactor = dist < MAGNETIC_WELL_RADIUS ? 1 - dist / MAGNETIC_WELL_RADIUS : 0
    const stiffness = baseStiffness * (1 + MAGNETIC_WELL_STIFFNESS_BOOST * wellFactor)

    const accel = -stiffness * displacement - damping * vel
    vel += accel * step
    const nextPos = pos + vel * step

    // 穿越磁极瞬间直接贴合锁槽（像磁铁吸住铁片一样干脆止步，不弹过头）
    if (displacement !== 0 && (nextPos - target) * displacement <= 0) {
      return { position: target, velocity: 0, settled: true }
    }
    pos = nextPos
  }

  const settled =
    Math.abs(target - pos) <= SPRING_SETTLE_DISTANCE && Math.abs(vel) <= SPRING_SETTLE_VELOCITY

  return settled
    ? { position: target, velocity: 0, settled: true }
    : { position: pos, velocity: vel, settled: false }
}

/**
 * 个人中心 <-> 设置页的磁铁吸附控制器：
 * - 手指按住拖动与大力甩入设置页下方时完全保持原生滚动零干涉；
 * - 松手或惯性停留在 (0, collapseDistance) 过渡带时，自动以磁吸弹簧落位至展开态或设置页顶端；
 * - 任何新触摸、滚轮或页面切换都会即时让权并清理动画。
 */
export const useHeroMagneticSnap = ({
  scrollRef,
  enabled,
  collapseDistance,
  onFrame,
  prefersReducedMotion,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  enabled: boolean
  collapseDistance: number
  onFrame: (scrollTop: number, force?: boolean) => void
  prefersReducedMotion: () => boolean
}) => {
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame
  const prefersReducedMotionRef = useRef(prefersReducedMotion)
  prefersReducedMotionRef.current = prefersReducedMotion

  const isSnapAnimatingRef = useRef(false)
  const snapRafRef = useRef(0)
  const confirmRafRef = useRef(0)
  const settleTimerRef = useRef(0)

  const isTouchingRef = useRef(false)
  const isPointerDownRef = useRef(false)
  const gestureSourceRef = useRef<HeroScrollSource>('touch')
  const gestureStartTopRef = useRef<number | null>(null)
  const samplesRef = useRef<ScrollSample[]>([])
  const lastWheelAtRef = useRef(0)
  const lastReleaseVelocityRef = useRef(0)
  const lastReleaseAtRef = useRef(0)
  const ignoreSettleUntilRef = useRef(0)

  const clearPendingSchedule = useCallback(() => {
    if (confirmRafRef.current) {
      cancelAnimationFrame(confirmRafRef.current)
      confirmRafRef.current = 0
    }
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = 0
    }
  }, [])

  const stopSnapAnimation = useCallback(() => {
    if (snapRafRef.current) {
      cancelAnimationFrame(snapRafRef.current)
      snapRafRef.current = 0
    }
    isSnapAnimatingRef.current = false
  }, [])

  const cancelSnap = useCallback(() => {
    clearPendingSchedule()
    stopSnapAnimation()
    samplesRef.current = []
    lastReleaseVelocityRef.current = 0
    lastReleaseAtRef.current = 0
  }, [clearPendingSchedule, stopSnapAnimation])

  const recordSample = useCallback((top: number, now: number) => {
    const list = samplesRef.current
    list.push({ top, time: now })
    const cutoff = now - VELOCITY_WINDOW_MS - 40
    while (list.length > 12 || (list.length > 2 && list[0] && list[0].time < cutoff)) {
      list.shift()
    }
  }, [])

  const readRecentVelocity = useCallback((now: number) => {
    const list = samplesRef.current
    const newest = list.at(-1)
    if (!newest || now - newest.time > VELOCITY_STALE_MS) {
      return 0
    }
    let oldest = newest
    for (let i = list.length - 2; i >= 0; i -= 1) {
      const candidate = list[i]
      if (!candidate) {
        continue
      }
      if (now - candidate.time <= VELOCITY_WINDOW_MS) {
        oldest = candidate
      } else {
        break
      }
    }
    const dt = newest.time - oldest.time
    if (dt < 8) {
      return 0
    }
    return (newest.top - oldest.top) / dt
  }, [])

  const startSnapAnimation = useCallback(
    (targetTop: number, initialVelocityPxPerMs = 0) => {
      const el = scrollRef.current
      if (!el || !enabledRef.current) {
        return
      }
      clearPendingSchedule()
      stopSnapAnimation()

      const effectiveMax = getEffectiveCollapseDistance(el, collapseDistance)
      const clampedTarget = Math.max(0, Math.min(targetTop, effectiveMax))

      if (Math.abs(el.scrollTop - clampedTarget) <= SNAP_EDGE_EPSILON) {
        el.scrollTop = clampedTarget
        onFrameRef.current(clampedTarget, true)
        gestureStartTopRef.current = null
        lastReleaseVelocityRef.current = 0
        return
      }

      if (prefersReducedMotionRef.current()) {
        el.scrollTop = clampedTarget
        onFrameRef.current(clampedTarget, true)
        gestureStartTopRef.current = null
        lastReleaseVelocityRef.current = 0
        return
      }

      isSnapAnimatingRef.current = true
      const startPos = el.scrollTop
      const direction = clampedTarget >= startPos ? 1 : -1
      // 仅保留与目标方向一致的残余初速度，避免微弱噪声造成反向回扯
      const alignedVelPxPerMs =
        initialVelocityPxPerMs * direction > 0
          ? Math.max(-0.9, Math.min(0.9, initialVelocityPxPerMs))
          : 0

      let pos = startPos
      let vel = alignedVelPxPerMs * 1000
      let lastWrittenTop = el.scrollTop
      let stalledFrames = 0
      const startedAt = performance.now()
      let lastFrameAt = startedAt

      const finish = (finalTop: number, stalled = false) => {
        snapRafRef.current = 0
        el.scrollTop = finalTop
        onFrameRef.current(el.scrollTop, true)
        isSnapAnimatingRef.current = false
        gestureStartTopRef.current = null
        lastReleaseVelocityRef.current = 0
        samplesRef.current = []
        if (stalled) {
          ignoreSettleUntilRef.current = performance.now() + 200
        }
      }

      const tick = (now: number) => {
        const currentEl = scrollRef.current
        if (
          !currentEl ||
          !enabledRef.current ||
          isTouchingRef.current ||
          isPointerDownRef.current
        ) {
          stopSnapAnimation()
          return
        }
        // 若被滚动条拖动或其他外部滚动打断，立刻让出控制权
        if (Math.abs(currentEl.scrollTop - lastWrittenTop) > 4) {
          stopSnapAnimation()
          return
        }

        const dt = (now - lastFrameAt) / 1000
        lastFrameAt = now

        const stepped = stepMagneticSpring(pos, vel, clampedTarget, dt)
        let nextPos = stepped.position
        let nextVel = stepped.velocity
        let settled = stepped.settled

        // 触达磁极即利落卡位，不越过目标边界
        if (
          (direction > 0 && nextPos >= clampedTarget) ||
          (direction < 0 && nextPos <= clampedTarget)
        ) {
          nextPos = clampedTarget
          nextVel = 0
          settled = true
        }
        if (now - startedAt >= SPRING_MAX_DURATION_MS) {
          nextPos = clampedTarget
          nextVel = 0
          settled = true
        }

        const prevActual = currentEl.scrollTop
        currentEl.scrollTop = nextPos
        const actualAfter = currentEl.scrollTop
        lastWrittenTop = actualAfter

        if (
          !settled &&
          Math.abs(nextPos - pos) >= 0.8 &&
          Math.abs(actualAfter - prevActual) < 0.1
        ) {
          stalledFrames += 1
          if (stalledFrames >= 3) {
            finish(actualAfter, true)
            return
          }
        } else {
          stalledFrames = 0
        }

        pos = nextPos
        vel = nextVel

        if (settled) {
          finish(clampedTarget)
          return
        }

        onFrameRef.current(pos)
        snapRafRef.current = requestAnimationFrame(tick)
      }

      snapRafRef.current = requestAnimationFrame(tick)
    },
    [clearPendingSchedule, collapseDistance, scrollRef, stopSnapAnimation]
  )

  const evaluateAndSnap = useCallback(
    (initialVelocityPxPerMs = 0) => {
      clearPendingSchedule()
      const el = scrollRef.current
      if (
        !el ||
        !enabledRef.current ||
        isTouchingRef.current ||
        isPointerDownRef.current ||
        isSnapAnimatingRef.current
      ) {
        return
      }
      const effectiveMax = getEffectiveCollapseDistance(el, collapseDistance)
      if (effectiveMax <= SNAP_EDGE_EPSILON * 2) {
        return
      }
      const currentTop = el.scrollTop
      if (currentTop <= SNAP_EDGE_EPSILON || currentTop >= effectiveMax - SNAP_EDGE_EPSILON) {
        gestureStartTopRef.current = null
        lastReleaseVelocityRef.current = 0
        return
      }

      const now = performance.now()
      const releaseVelocity =
        now - lastReleaseAtRef.current <= FLICK_INTENT_TTL_MS ? lastReleaseVelocityRef.current : 0

      const target = resolveHeroSnapTarget({
        scrollTop: currentTop,
        collapseDistance: effectiveMax,
        gestureStartScrollTop: gestureStartTopRef.current,
        releaseVelocity,
        source: gestureSourceRef.current,
      })
      startSnapAnimation(target, initialVelocityPxPerMs)
    },
    [clearPendingSchedule, collapseDistance, scrollRef, startSnapAnimation]
  )

  const scheduleSettleCheck = useCallback(
    (delayMs: number) => {
      if (settleTimerRef.current) {
        window.clearTimeout(settleTimerRef.current)
      }
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = 0
        evaluateAndSnap(0)
      }, delayMs)
    },
    [evaluateAndSnap]
  )

  const snapTo = useCallback(
    (target: HeroSnapTarget) => {
      const el = scrollRef.current
      if (!el || !enabledRef.current) {
        return
      }
      const effectiveMax = getEffectiveCollapseDistance(el, collapseDistance)
      startSnapAnimation(target === 'expanded' ? 0 : effectiveMax, 0)
    },
    [collapseDistance, scrollRef, startSnapAnimation]
  )

  const notifyScroll = useCallback(
    (scrollTop: number) => {
      if (!enabledRef.current || isSnapAnimatingRef.current) {
        return
      }
      const now = performance.now()
      recordSample(scrollTop, now)

      if (isTouchingRef.current || isPointerDownRef.current || now < ignoreSettleUntilRef.current) {
        return
      }
      const el = scrollRef.current
      if (!el) {
        return
      }
      const effectiveMax = getEffectiveCollapseDistance(el, collapseDistance)
      if (scrollTop <= SNAP_EDGE_EPSILON || scrollTop >= effectiveMax - SNAP_EDGE_EPSILON) {
        if (settleTimerRef.current) {
          window.clearTimeout(settleTimerRef.current)
          settleTimerRef.current = 0
        }
        return
      }
      const supportsScrollEnd = typeof window !== 'undefined' && 'onscrollend' in window
      const delay = gestureSourceRef.current === 'wheel' ? 115 : supportsScrollEnd ? 85 : 68
      scheduleSettleCheck(delay)
    },
    [collapseDistance, recordSample, scheduleSettleCheck, scrollRef]
  )

  // 监听触摸/滚轮/惯性结束事件，全部使用 passive 保证 120Hz 原生跟手度
  useEffect(() => {
    const el = scrollRef.current
    if (!enabled || !el) {
      cancelSnap()
      isTouchingRef.current = false
      isPointerDownRef.current = false
      gestureStartTopRef.current = null
      return
    }

    const supportsScrollEnd = typeof window !== 'undefined' && 'onscrollend' in window

    const onTouchStart = () => {
      isTouchingRef.current = true
      gestureSourceRef.current = 'touch'
      cancelSnap()
      const startTop = el.scrollTop
      gestureStartTopRef.current = startTop
      recordSample(startTop, performance.now())
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) {
        return
      }
      isTouchingRef.current = false
      const now = performance.now()
      const velocity = readRecentVelocity(now)
      lastReleaseVelocityRef.current = velocity
      lastReleaseAtRef.current = now

      const effectiveMax = getEffectiveCollapseDistance(el, collapseDistance)
      const currentTop = el.scrollTop
      if (currentTop <= SNAP_EDGE_EPSILON || currentTop >= effectiveMax - SNAP_EDGE_EPSILON) {
        // 即使松手当下位于设置页下方，也允许原生惯性滑入过渡带后由 scroll/scrollend 接管
        return
      }

      if (Math.abs(velocity) < SLOW_RELEASE_VELOCITY) {
        // 慢拖静止松手几乎无原生 fling：确认 2 帧无惯性位移后立刻磁吸，消除僵直感
        const releaseTop = currentTop
        confirmRafRef.current = requestAnimationFrame(() => {
          confirmRafRef.current = requestAnimationFrame(() => {
            confirmRafRef.current = 0
            if (isTouchingRef.current || !enabledRef.current) {
              return
            }
            if (Math.abs(el.scrollTop - releaseTop) < 1.5) {
              evaluateAndSnap(velocity)
            } else {
              scheduleSettleCheck(supportsScrollEnd ? 85 : 68)
            }
          })
        })
        return
      }

      scheduleSettleCheck(supportsScrollEnd ? 85 : 68)
    }

    const onWheel = () => {
      const now = performance.now()
      stopSnapAnimation()
      if (confirmRafRef.current) {
        cancelAnimationFrame(confirmRafRef.current)
        confirmRafRef.current = 0
      }
      gestureSourceRef.current = 'wheel'
      if (now - lastWheelAtRef.current > 260) {
        gestureStartTopRef.current = el.scrollTop
        lastReleaseVelocityRef.current = 0
        samplesRef.current = [{ top: el.scrollTop, time: now }]
      }
      lastWheelAtRef.current = now
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        return
      }
      // 鼠标拖动滚动条或触控笔点击时立即中断磁吸，不与用户抢控制权
      isPointerDownRef.current = true
      gestureSourceRef.current = 'wheel'
      cancelSnap()
      gestureStartTopRef.current = el.scrollTop
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !isPointerDownRef.current) {
        return
      }
      isPointerDownRef.current = false
      const effectiveMax = getEffectiveCollapseDistance(el, collapseDistance)
      if (el.scrollTop > SNAP_EDGE_EPSILON && el.scrollTop < effectiveMax - SNAP_EDGE_EPSILON) {
        evaluateAndSnap(0)
      }
    }

    const onScrollEnd = () => {
      if (!isTouchingRef.current && !isPointerDownRef.current && !isSnapAnimatingRef.current) {
        evaluateAndSnap(0)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointercancel', onPointerUp, { passive: true })
    if (supportsScrollEnd) {
      el.addEventListener('scrollend', onScrollEnd, { passive: true })
    }

    // 若从二级子页返回时发现上次动画中途被打断停在过渡带，自动磁吸归位
    const initialMax = getEffectiveCollapseDistance(el, collapseDistance)
    if (el.scrollTop > SNAP_EDGE_EPSILON && el.scrollTop < initialMax - SNAP_EDGE_EPSILON) {
      gestureStartTopRef.current = null
      evaluateAndSnap(0)
    }

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      if (supportsScrollEnd) {
        el.removeEventListener('scrollend', onScrollEnd)
      }
      isPointerDownRef.current = false
      cancelSnap()
    }
  }, [
    cancelSnap,
    collapseDistance,
    enabled,
    evaluateAndSnap,
    readRecentVelocity,
    recordSample,
    scheduleSettleCheck,
    scrollRef,
    stopSnapAnimation,
  ])

  return {
    isSnapAnimatingRef,
    notifyScroll,
    snapTo,
    cancelSnap,
  }
}
