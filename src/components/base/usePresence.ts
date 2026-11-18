import { useEffect, useRef, useState } from 'react'

/** 控制弹层挂载与过渡展示状态：打开时双帧激活进场过渡，关闭时延迟卸载以播放完整退场动画 */
export const usePresence = (open: boolean, durationMs = 280) => {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  const mountedRef = useRef(mounted)
  mountedRef.current = mounted

  useEffect(() => {
    if (open) {
      setMounted(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setVisible(false)
    if (!mountedRef.current) {
      return
    }
    const timer = setTimeout(() => setMounted(false), durationMs)
    return () => clearTimeout(timer)
  }, [open, durationMs])

  return { mounted, visible }
}
