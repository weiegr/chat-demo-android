export type ImeMotionPhase = 'prepare' | 'start' | 'progress' | 'end'

export interface ImeMotionState {
  /** 原生上报的实时键盘抬升高度（高出导航栏的 CSS px，>= 0） */
  raise: number
  /** 经柔和底距收敛后的输入区上移高度（CSS px，抬升前 32px 平滑吸收 8px 底距） */
  shift: number
  /** 静止态最终结算的键盘抬升高度（CSS px），仅在动画结束或无动画切换时更新 */
  settled: number
  /** 当前是否处于键盘进/退场动画中 */
  animating: boolean
  /** 最近一次动画的方向：true 为弹出，false 为收起 */
  opening: boolean
  /** 动画目标键盘高度（CSS px） */
  targetRaise: number
  /** 系统上报的动画时长（ms） */
  durationMs: number
  /** 仅在 end 阶段为 true：说明本次结算未经逐帧 progress 平滑过渡就发生了大幅跳变，需要短促 GPU 过渡兜底防止闪现 */
  smoothSettle: boolean
}

export type ImeMotionListener = (phase: ImeMotionPhase, state: ImeMotionState) => void

interface AndroidImeHost {
  getCurrentImeRaiseCss?: () => number
  isKeyboardVisible?: () => boolean
}

interface NativeImeBridge {
  prepare: () => void
  start: (targetRaiseCss: number, durationMs: number, opening: boolean) => void
  progress: (raiseCss: number) => void
  end: (finalRaiseCss: number, visible: boolean) => void
}

declare global {
  interface Window {
    AndroidHost?: AndroidImeHost
    __imeBridge?: NativeImeBridge
  }
}

const listeners = new Set<ImeMotionListener>()

/**
 * 键盘抬升前 32px 平滑吸收 8px 底部留白，
 * 使输入区在键盘完全弹起后紧凑贴合键盘顶沿（8px 间距），且全程免去切换根属性引发全文档重算。
 */
export const computeImeShift = (raiseCss: number): number => {
  if (raiseCss <= 0) {
    return 0
  }
  return Math.max(0, raiseCss - Math.min(8, raiseCss * 0.25))
}

const state: ImeMotionState = {
  raise: 0,
  shift: 0,
  settled: 0,
  animating: false,
  opening: false,
  targetRaise: 0,
  durationMs: 220,
  smoothSettle: false,
}

/** 未经中间帧过渡、单步 end 跳变超过该阈值（CSS px）时启用短促 GPU 兜底过渡 */
const SMOOTH_SETTLE_JUMP_THRESHOLD = 16

const syncSettledCssVar = (settledShift: number) => {
  const root = document.documentElement
  if (settledShift > 0.5) {
    root.style.setProperty('--ime-settled', `${settledShift.toFixed(1)}px`)
  } else {
    root.style.removeProperty('--ime-settled')
  }
}

const notify = (phase: ImeMotionPhase) => {
  for (const listener of listeners) {
    listener(phase, state)
  }
}

const bridge: NativeImeBridge = {
  prepare() {
    state.animating = true
    state.smoothSettle = false
    notify('prepare')
  },
  start(targetRaiseCss, durationMs, opening) {
    const safeTarget = Number.isFinite(targetRaiseCss) ? Math.max(0, targetRaiseCss) : 0
    const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 220
    state.animating = true
    state.opening = Boolean(opening)
    state.targetRaise = safeTarget
    state.durationMs = safeDuration
    state.smoothSettle = false
    notify('start')
    if (opening) {
      window.dispatchEvent(
        new CustomEvent('android-ime-start', {
          detail: { durationMs: safeDuration, targetRaiseCss: Math.round(safeTarget) },
        })
      )
    }
  },
  progress(raiseCss) {
    const safeRaise = Number.isFinite(raiseCss) ? Math.max(0, raiseCss) : 0
    state.raise = safeRaise
    state.shift = computeImeShift(safeRaise)
    state.smoothSettle = false
    notify('progress')
  },
  end(finalRaiseCss, visible) {
    const wasSettled = state.settled > 0
    const prevShift = state.shift
    const safeRaise = visible && Number.isFinite(finalRaiseCss) ? Math.max(0, finalRaiseCss) : 0
    const nextShift = computeImeShift(safeRaise)
    state.raise = safeRaise
    state.shift = nextShift
    state.settled = nextShift
    state.animating = false
    state.opening = Boolean(visible)
    state.targetRaise = safeRaise
    state.smoothSettle = Math.abs(nextShift - prevShift) > SMOOTH_SETTLE_JUMP_THRESHOLD
    syncSettledCssVar(nextShift)
    notify('end')
    if (visible && !wasSettled) {
      window.dispatchEvent(new Event('android-ime-shown'))
    } else if (!visible && wasSettled) {
      window.dispatchEvent(new Event('android-ime-hidden'))
    }
  },
}

let installed = false

const ensureBridgeInstalled = () => {
  if (installed || typeof window === 'undefined') {
    return
  }
  installed = true
  window.__imeBridge = bridge
  const host = window.AndroidHost
  if (host?.getCurrentImeRaiseCss) {
    const initialRaise = Math.max(0, Number(host.getCurrentImeRaiseCss()) || 0)
    if (initialRaise > 0) {
      const initialShift = computeImeShift(initialRaise)
      state.raise = initialRaise
      state.shift = initialShift
      state.settled = initialShift
      state.opening = true
      state.targetRaise = initialRaise
      syncSettledCssVar(initialShift)
    }
  }
}

export const hasNativeImeMotion = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.AndroidHost)

export const getImeMotionState = (): Readonly<ImeMotionState> => {
  ensureBridgeInstalled()
  return state
}

export const subscribeImeMotion = (listener: ImeMotionListener): (() => void) => {
  ensureBridgeInstalled()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
