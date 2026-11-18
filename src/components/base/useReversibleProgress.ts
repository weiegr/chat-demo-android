import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 三次缓入缓出曲线：中段高速掠过侧面，首尾及折返柔和收敛无割裂感 */
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/**
 * 可逆进度动画控制器：
 * - 初次挂载按 `active` 对齐到 0 或 1，不触发动画；
 * - 正常开启（0 -> 1）与关闭（1 -> 0）分别正向/反向完整运行一轮；
 * - 若运行中途打断切换 `active`，直接从当前实际进度原地平滑折返，无跳变。
 */
export function useReversibleProgress(
  active: boolean | undefined,
  durationMs: number,
  onFrame: (progress: number) => void
): boolean {
  const [animating, setAnimating] = useState(false)
  const progressRef = useRef(active ? 1 : 0)
  const prevActiveRef = useRef(active)
  const onFrameRef = useRef(onFrame)

  useLayoutEffect(() => {
    onFrameRef.current = onFrame
  })

  useLayoutEffect(() => {
    if (animating) {
      onFrameRef.current(progressRef.current)
    }
  }, [animating])

  useEffect(() => {
    if (active === undefined || active === prevActiveRef.current) {
      prevActiveRef.current = active
      return
    }
    prevActiveRef.current = active

    const target = active ? 1 : 0
    const start = progressRef.current
    const distance = Math.abs(target - start)
    if (distance < 0.001) {
      progressRef.current = target
      setAnimating(false)
      return
    }

    setAnimating(true)
    const spanMs = Math.max(170, durationMs * distance)
    let rafId = 0
    let startTime = 0

    const step = (now: number) => {
      if (startTime === 0) {
        startTime = now
      }
      const raw = Math.min(1, (now - startTime) / spanMs)
      const current = start + (target - start) * easeInOutCubic(raw)
      progressRef.current = current
      onFrameRef.current(current)

      if (raw < 1) {
        rafId = window.requestAnimationFrame(step)
      } else {
        progressRef.current = target
        setAnimating(false)
      }
    }

    rafId = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(rafId)
  }, [active, durationMs])

  return animating
}
