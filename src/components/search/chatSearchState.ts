import { create } from 'zustand'
import { clearSiderMainInline, dismissKeyboard } from '../sider/mobileSiderState.js'

/** 全局会话搜索页：侧边栏搜索框、桌面 Ctrl+K 都可打开 */
type ChatSearchState = {
  open: boolean
  /** 正在展示或播放退场过渡：用于移动端与侧边栏静态胶囊无缝交接 */
  presenting: boolean
  /** 点击搜索结果直达会话：移动端由主界面滑回盖住搜索页，不在下方闪回侧边栏 */
  closingToSession: boolean
}

export const useChatSearch = create<ChatSearchState>(() => ({
  open: false,
  presenting: false,
  closingToSession: false,
}))

export const openChatSearch = () => {
  // 若侧边栏刚完成拖拽手势、内联样式定时器尚未触发，立即交回 CSS 控制以保证同帧启动过渡
  clearSiderMainInline()
  useChatSearch.setState({ open: true, presenting: true, closingToSession: false })
}

export const closeChatSearch = (options?: { toSession?: boolean }) => {
  const { open } = useChatSearch.getState()
  if (!open) {
    return
  }
  dismissKeyboard()
  useChatSearch.setState({
    open: false,
    presenting: true,
    closingToSession: Boolean(options?.toSession),
  })
}

export const finishChatSearchClose = () => {
  if (!useChatSearch.getState().open) {
    useChatSearch.setState({ presenting: false, closingToSession: false })
  }
}
