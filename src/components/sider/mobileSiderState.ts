import { create } from 'zustand'

interface AndroidKeyboardBridge {
  isKeyboardVisible?: () => boolean
  hideKeyboard?: () => void
}

const INPUT_SELECTOR = 'textarea, input:not([type="file"])'
const getAndroidKeyboardBridge = (): AndroidKeyboardBridge | undefined =>
  (window as Window & { AndroidHost?: AndroidKeyboardBridge }).AndroidHost

const isInputFocused = (): boolean => {
  const active = document.activeElement
  return active instanceof HTMLElement && active.matches(INPUT_SELECTOR)
}

/** 当前是否有输入焦点或系统软键盘处于弹出状态 */
export const isKeyboardOpen = (): boolean =>
  Boolean(getAndroidKeyboardBridge()?.isKeyboardVisible?.()) || isInputFocused()

/** 主动让当前输入控件失焦并请求原生层收起系统软键盘 */
export const dismissKeyboard = (): { hadNativeIme: boolean; hadFocus: boolean } => {
  const hadNativeIme = Boolean(getAndroidKeyboardBridge()?.isKeyboardVisible?.())
  const hadFocus = isInputFocused()
  if (hadFocus && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  getAndroidKeyboardBridge()?.hideKeyboard?.()
  return { hadNativeIme, hadFocus }
}

/** 移动端侧边栏抽屉：顶栏菜单按钮打开，切换会话、选择搜索结果或开启新对话后关闭 */
export const useMobileSider = create(() => ({ open: false }))

/**
 * 移动端推开式侧边栏：侧边栏从屏幕左侧完整滑入，紧贴着把对话界面整体往右推。
 * 这里保存 App 注册进来的 <main> 与抽屉动效层，手势拖动时直接写内联样式，避免每帧触发 React 渲染。
 */
let mainElement: HTMLElement | null = null
let drawerMotionElement: HTMLElement | null = null
let mainInlineTimer: number | undefined

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const bindSiderMain = (element: HTMLElement | null) => {
  mainElement = element
}

export const getSiderMain = () => mainElement

export const bindSiderDrawerMotion = (element: HTMLElement | null) => {
  drawerMotionElement = element
}

export const getSiderDrawerMotion = () => drawerMotionElement

/** 按侧边栏推入像素偏移与宽度，同步让抽屉右缘紧贴对话界面左缘一起平移 */
export const applySiderDrawerProgress = (element: HTMLElement, offset: number, width: number) => {
  const safeWidth = Math.max(1, width)
  const clampedOffset = offset <= 0 ? 0 : offset >= safeWidth ? safeWidth : offset
  if (prefersReducedMotion()) {
    element.style.transform =
      clampedOffset >= safeWidth * 0.5 ? 'translate3d(0, 0, 0)' : 'translate3d(-100%, 0, 0)'
    return
  }
  const x = clampedOffset - safeWidth
  element.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`
}

export const cancelClearSiderMainInline = () => {
  window.clearTimeout(mainInlineTimer)
  mainInlineTimer = undefined
}

/** 清除手势拖动遗留在 <main> 与抽屉动效层上的内联样式，立刻交回 CSS 类过渡控制 */
export const clearSiderMainInline = () => {
  cancelClearSiderMainInline()
  if (mainElement) {
    mainElement.style.removeProperty('transition')
    mainElement.style.removeProperty('transform')
    mainElement.style.removeProperty('--sider-shadow-opacity')
    delete mainElement.dataset.siderDragging
  }
  if (drawerMotionElement) {
    drawerMotionElement.style.removeProperty('transition')
    drawerMotionElement.style.removeProperty('transform')
    delete drawerMotionElement.dataset.siderDragging
  }
}

export const scheduleClearSiderMainInline = (delayMs = 340) => {
  cancelClearSiderMainInline()
  mainInlineTimer = window.setTimeout(clearSiderMainInline, delayMs)
}

/**
 * 打开移动端侧边栏：同步请求收起软键盘并零延迟展开抽屉，
 * 使键盘回落与侧栏滑入并发进行、保持跟手响应。
 */
export const openMobileSider = () => {
  if (isKeyboardOpen()) {
    dismissKeyboard()
  }
  if (!useMobileSider.getState().open) {
    useMobileSider.setState({ open: true })
  }
}

export const closeMobileSider = () => {
  useMobileSider.setState({ open: false })
}
