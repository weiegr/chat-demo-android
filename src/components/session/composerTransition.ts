import { Component, type RefObject } from 'react'
import { getImeMotionState } from '../../app/imeMotion.js'

export type ComposerViewKind = 'welcome' | 'session'

interface ComposerSnapshot {
  from: ComposerViewKind
  to: ComposerViewKind | null
  bottom: number
  capturedAt: number
}

const COMPOSER_SELECTOR = '[data-composer-shell="true"]'
const SNAPSHOT_MAX_AGE_MS = 320
const TRANSITION_DURATION_MS = 280
const TRANSITION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

let pendingSnapshot: ComposerSnapshot | null = null

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const getFreshSnapshot = (expectedView: ComposerViewKind): ComposerSnapshot | null => {
  if (!pendingSnapshot) {
    return null
  }
  const age = performance.now() - pendingSnapshot.capturedAt
  if (age > SNAPSHOT_MAX_AGE_MS) {
    pendingSnapshot = null
    return null
  }
  if (pendingSnapshot.from === expectedView) {
    return null
  }
  if (pendingSnapshot.to !== null && pendingSnapshot.to !== expectedView) {
    return null
  }
  return pendingSnapshot
}

export const captureComposerSnapshot = (
  container: HTMLElement | null,
  from: ComposerViewKind,
  to: ComposerViewKind | null
) => {
  const el = container?.querySelector<HTMLElement>(COMPOSER_SELECTOR)
  if (!el) {
    pendingSnapshot = null
    return
  }
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    pendingSnapshot = null
    return
  }
  pendingSnapshot = {
    from,
    to,
    bottom: rect.bottom,
    capturedAt: performance.now(),
  }
}

export const clearComposerSnapshot = () => {
  pendingSnapshot = null
}

export interface ComposerTransitionResult {
  fromOtherView: boolean
  cleanup?: () => void
}

/**
 * 消费跨视图切换快照，并以纯 GPU translate3d 对齐新旧输入框底边后平滑过渡到目标位置：
 * - 移动端两页输入框已等宽等底距吸底，dy ≈ 0，不会引入多余位移；
 * - 桌面端在「屏幕居中 <-> 吸底」之间无缝滑移，且不改变祖先 opacity，保持自定义背景磨砂零闪变。
 */
export const runComposerTransition = (
  container: HTMLElement | null,
  expectedView: ComposerViewKind
): ComposerTransitionResult => {
  const snapshot = getFreshSnapshot(expectedView)
  pendingSnapshot = null
  if (!snapshot) {
    return { fromOtherView: false }
  }
  const ime = getImeMotionState()
  if (
    !container ||
    prefersReducedMotion() ||
    ime.animating ||
    ime.shift > 0.5 ||
    ime.settled > 0.5
  ) {
    return { fromOtherView: true }
  }
  const el = container.querySelector<HTMLElement>(COMPOSER_SELECTOR)
  if (!el) {
    return { fromOtherView: true }
  }
  const nextRect = el.getBoundingClientRect()
  if (nextRect.width <= 0 || nextRect.height <= 0) {
    return { fromOtherView: true }
  }
  const dy = snapshot.bottom - nextRect.bottom
  if (Math.abs(dy) <= 2 || Math.abs(dy) > window.innerHeight) {
    return { fromOtherView: true }
  }

  let finished = false
  let timer = 0

  const cleanup = () => {
    if (finished) {
      return
    }
    finished = true
    window.clearTimeout(timer)
    el.removeEventListener('transitionend', onTransitionEnd)
    el.style.removeProperty('transition')
    el.style.removeProperty('transform')
    el.style.removeProperty('will-change')
  }

  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === el && event.propertyName === 'transform') {
      cleanup()
    }
  }

  el.style.willChange = 'transform'
  el.style.transition = 'none'
  el.style.transform = `translate3d(0, ${dy.toFixed(2)}px, 0)`
  // 强制提交初始偏移帧，确保紧随其后的 GPU 过渡从原位起跑
  void el.getBoundingClientRect()
  el.style.transition = `transform ${TRANSITION_DURATION_MS}ms ${TRANSITION_EASING}`
  el.style.transform = 'translate3d(0, 0, 0)'
  el.addEventListener('transitionend', onTransitionEnd)
  timer = window.setTimeout(cleanup, TRANSITION_DURATION_MS + 60)

  return { fromOtherView: true, cleanup }
}

type BridgeProps = {
  viewKind: ComposerViewKind | null
  containerRef: RefObject<HTMLDivElement | null>
}

/**
 * 在 React 卸载旧视图 DOM 前同步捕获输入框实时坐标，
 * 覆盖发送、开启新对话、快捷键与侧栏切会话等全部切换入口，静默期零开销。
 */
export class ComposerSnapshotBridge extends Component<BridgeProps> {
  override getSnapshotBeforeUpdate(prevProps: BridgeProps): null {
    if (prevProps.viewKind !== null && prevProps.viewKind !== this.props.viewKind) {
      captureComposerSnapshot(
        this.props.containerRef.current,
        prevProps.viewKind,
        this.props.viewKind
      )
    }
    return null
  }

  override componentDidUpdate(): void {
    // getSnapshotBeforeUpdate 要求配套声明 componentDidUpdate
  }

  override componentWillUnmount(): void {
    clearComposerSnapshot()
  }

  override render() {
    return null
  }
}
