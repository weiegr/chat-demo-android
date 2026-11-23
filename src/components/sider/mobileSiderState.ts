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
 * 抽屉改为把对话界面整体右移，抽屉本身留在下层。
 * 这里保存 App 注册进来的 <main>，手势拖动时直接写内联 transform，避免每帧触发 React 渲染。
 */
let mainElement: HTMLElement | null = null
let mainInlineTimer: number | undefined

export const bindSiderMain = (element: HTMLElement | null) => {
  mainElement = element
}

export const getSiderMain = () => mainElement

/** 清除手势拖动遗留在 <main> 上的内联样式，立刻交回 CSS 类过渡控制 */
export const clearSiderMainInline = () => {
  window.clearTimeout(mainInlineTimer)
  mainInlineTimer = undefined
  if (!mainElement) {
    return
  }
  mainElement.style.removeProperty('transition')
  mainElement.style.removeProperty('transform')
  mainElement.style.removeProperty('box-shadow')
  delete mainElement.dataset.siderDragging
}

export const scheduleClearSiderMainInline = (delayMs = 320) => {
  window.clearTimeout(mainInlineTimer)
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
