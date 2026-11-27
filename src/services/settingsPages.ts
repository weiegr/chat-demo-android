/**
 * 设置页的深链目标：只列可以稳定定位的入口，不包含主题、语言等内联控件。
 * 同一个 page 在移动端和桌面端可能属于不同分组，由 settingsPageSection 统一换算。
 */
export type SettingsPage =
  | 'general'
  | 'data'
  | 'apiKey'
  | 'personalCenter'
  | 'nickname'
  | 'appBackground'
  | 'chatBackground'
  | 'liveAvatar'
  | 'voiceBroadcast'
  | 'videoUpload'
  | 'location'
  | 'systemPrompt'
  | 'globalMemory'
  | 'memoryFile'
  | 'importSessions'
  | 'exportInfo'

const ALL_PAGES = new Set<string>([
  'general',
  'data',
  'apiKey',
  'personalCenter',
  'nickname',
  'appBackground',
  'chatBackground',
  'liveAvatar',
  'voiceBroadcast',
  'videoUpload',
  'location',
  'systemPrompt',
  'globalMemory',
  'memoryFile',
  'importSessions',
  'exportInfo',
])

/** 移动端「数据管理」分组下的入口；其余个性化/对话/应用设置都在「通用」 */
const MOBILE_DATA_PAGES = new Set<SettingsPage>([
  'apiKey',
  'globalMemory',
  'memoryFile',
  'importSessions',
  'exportInfo',
])

/** 桌面端「数据管理」分组下的入口；个性化与背景在桌面端也放在数据管理 */
const DESKTOP_DATA_PAGES = new Set<SettingsPage>([
  'personalCenter',
  'nickname',
  'appBackground',
  'chatBackground',
  'liveAvatar',
  'apiKey',
  'globalMemory',
  'memoryFile',
  'importSessions',
  'exportInfo',
])

export const isSettingsPage = (value: string): value is SettingsPage => ALL_PAGES.has(value)

export const settingsPageSection = (page: SettingsPage, isMobile: boolean) => {
  if (page === 'general') {
    return 'general' as const
  }
  if (page === 'data') {
    return 'data' as const
  }
  return (isMobile ? MOBILE_DATA_PAGES : DESKTOP_DATA_PAGES).has(page)
    ? ('data' as const)
    : ('general' as const)
}

/** 移动端打开该页需要压入的页面栈；根分组返回空数组 */
export const mobileSettingsPath = (page: SettingsPage): SettingsPage[] => {
  switch (page) {
    case 'general':
    case 'data':
    case 'apiKey':
      return []
    case 'globalMemory':
      // Beta 的全局记忆是一级页；稳定版仍从「数据管理」二级页进入
      return __BETA__ ? ['globalMemory'] : ['data', 'globalMemory']
    case 'memoryFile':
      return __BETA__ ? ['globalMemory', 'memoryFile'] : ['data', 'globalMemory', 'memoryFile']
    case 'chatBackground':
      return ['appBackground', 'chatBackground']
    default:
      return [page]
  }
}

/** 桌面端真正有独立子页的入口；其余只需切到对应分组 */
export const desktopSettingsPage = (page: SettingsPage): SettingsPage | null => {
  switch (page) {
    case 'personalCenter':
    case 'appBackground':
    case 'chatBackground':
    case 'liveAvatar':
    case 'globalMemory':
    case 'memoryFile':
      return page
    default:
      return null
  }
}

/** 模型输出与工具结果共用的应用内链接格式，由 Markdown 链接组件拦截 */
export const settingsPageUrl = (page: SettingsPage) => `app://settings?page=${page}`
