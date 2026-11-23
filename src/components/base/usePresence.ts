import { useEffect, useState } from 'react'

/**
 * 控制弹层挂载与过渡展示状态：
 * 1. 打开时先挂载 DOM，确认已提交挂载后再经双帧激活进场过渡，确保首次冷挂载也能锁定初始态、播放完整入场动画；
 * 2. 关闭时立刻切为不可见并延迟卸载，以播放完整退场动画。
 */
export const usePresence = (open: boolean, durationMs = 280) => {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    setVisible(false)
    if (!mounted) {
      return
    }
    const timer = window.setTimeout(() => setMounted(false), durationMs)
    return () => window.clearTimeout(timer)
  }, [open, mounted, durationMs])

  useEffect(() => {
    if (!open || !mounted) {
      return
    }
    let raf2 = 0
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => setVisible(true))
    })
    return () => {
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
    }
  }, [open, mounted])

  return { mounted, visible }
}
