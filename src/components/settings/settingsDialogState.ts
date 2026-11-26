import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'
import {
  isSettingsPage,
  settingsPageSection,
  type SettingsPage,
} from '../../services/settingsPages.js'
import { dismissKeyboard } from '../sider/mobileSiderState.js'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
  /** 深链目标；SettingsDialog 打开时消费并清空 */
  page: null as SettingsPage | null,
}))

export const openSettings = (section: SettingsSection, page: SettingsPage | null = null) =>
  useSettingsDialog.setState({ open: true, section, page })

/** 从功能文档或应用内链接打开设置；分组由页面在移动端/桌面端的归属决定 */
export const openSettingsPage = (page: SettingsPage) => {
  dismissKeyboard()
  const isMobile =
    typeof window !== 'undefined' &&
    window.matchMedia('not all and (min-width: 768px)').matches
  useSettingsDialog.setState({
    open: true,
    section: settingsPageSection(page, isMobile),
    page,
  })
}

/** Markdown 链接只接受白名单页面，避免任意 app:// 地址打开设置 */
export const readSettingsPageFromUrl = (url: string): SettingsPage | null => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'app:' || parsed.hostname !== 'settings') {
      return null
    }
    const page = parsed.searchParams.get('page') ?? 'general'
    return isSettingsPage(page) ? page : null
  } catch {
    return null
  }
}

export const closeSettings = () => {
  dismissKeyboard()
  useSettingsDialog.setState({ open: false })
}

/** 没有 API Key 时打开设置并选中 API Key 所在的「数据管理」，返回是否已有 Key */
export const ensureApiKey = () => {
  const { apiKey, apiKeyStorageMode } = useSettings.getState()
  if (apiKey) {
    return true
  }
  if (apiKeyStorageMode !== 'loading') {
    openSettings('data')
  }
  return false
}
