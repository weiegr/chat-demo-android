import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import type { ChatModel } from './api/types.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 对话模式：快速（Flash 全功能）/ 专家（Pro 复杂问题 + OCR）/ RP（长上下文纯净模式） */
export type ChatMode = 'fast' | 'expert' | 'rp'

/** 快速/专家模式系统提示词默认值；可在设置中修改或清空（清空后请求不带基础 system 内容） */
export const DEFAULT_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/** RP 模式系统提示词默认值；默认留空，保持长上下文角色扮演纯净 */
export const DEFAULT_RP_SYSTEM_PROMPT = ''

/** 联网搜索工具（deepseek_web_search）默认提示词说明 */
export const DEFAULT_SEARCH_TOOL_PROMPT = [
  '本轮已启用联网能力：你可以调用 deepseek_web_search 搜索网页。是否调用由你根据问题需要判断，不需要用户先提出「搜索」的要求。',
  '当问题涉及最新信息、具体事实、人物、地点、地标、机构、产品、作品、影视游戏、动植物、事件新闻或操作步骤时，先搜索核实再回答；寒暄、闲聊、纯创作或你已确定的常识问题不必搜索。',
  '你具备上述能力，请不要表示自己无法联网或没有搜索工具。',
].join('\n')

/** 链接阅读工具（deepseek_read_url）默认提示词说明 */
export const DEFAULT_READ_LINK_TOOL_PROMPT =
  '本轮消息包含网页链接，你可以调用 deepseek_read_url 阅读用户消息中的链接内容以辅助回答。'

/** 实时定位工具（get_location）默认描述提示词 */
export const DEFAULT_LOCATION_TOOL_PROMPT =
  "Get the user's real-time physical geographic location (latitude, longitude, and resolved address when available). Call this tool only when the user's request depends on their actual current location (such as local weather, nearby places, current city, or directions)."

export type ModePrompts = {
  systemPrompt: string
  searchToolPrompt: string
  readLinkToolPrompt: string
  locationToolPrompt: string
}

/** 根据对话模式与 RP 模式所选模型解析实际请求的模型 ID */
export const resolveModeModel = (mode: ChatMode, rpModel: ChatModel): ChatModel => {
  if (mode === 'expert') {
    return 'deepseek-v4-pro'
  }
  if (mode === 'rp') {
    return rpModel
  }
  return 'deepseek-flash'
}

/** 本机设置，存 localStorage：API Key、语言、主题、位置与 AI 定位权限、朗读音色、各模式系统与工具提示词、对话模式与 RP 模型、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  locationEnabled: boolean
  allowAiLocation: boolean
  ttsVoice: TtsVoice
  fastSystemPrompt: string
  fastSearchToolPrompt: string
  fastReadLinkToolPrompt: string
  fastLocationToolPrompt: string
  expertSystemPrompt: string
  expertSearchToolPrompt: string
  expertReadLinkToolPrompt: string
  expertLocationToolPrompt: string
  rpSystemPrompt: string
  chatMode: ChatMode
  rpModel: ChatModel
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

/** 按会话模式取出对应的系统提示词与工具提示词配置 */
export const getModePrompts = (
  mode: ChatMode,
  settings: Pick<
    Settings,
    | 'fastSystemPrompt'
    | 'fastSearchToolPrompt'
    | 'fastReadLinkToolPrompt'
    | 'fastLocationToolPrompt'
    | 'expertSystemPrompt'
    | 'expertSearchToolPrompt'
    | 'expertReadLinkToolPrompt'
    | 'expertLocationToolPrompt'
    | 'rpSystemPrompt'
  >
): ModePrompts => {
  if (mode === 'rp') {
    return {
      systemPrompt: settings.rpSystemPrompt,
      searchToolPrompt: '',
      readLinkToolPrompt: '',
      locationToolPrompt: '',
    }
  }
  if (mode === 'expert') {
    return {
      systemPrompt: settings.expertSystemPrompt,
      searchToolPrompt: settings.expertSearchToolPrompt,
      readLinkToolPrompt: settings.expertReadLinkToolPrompt,
      locationToolPrompt: settings.expertLocationToolPrompt,
    }
  }
  return {
    systemPrompt: settings.fastSystemPrompt,
    searchToolPrompt: settings.fastSearchToolPrompt,
    readLinkToolPrompt: settings.fastReadLinkToolPrompt,
    locationToolPrompt: settings.fastLocationToolPrompt,
  }
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  locationEnabled: 'chat-demo:location-enabled',
  allowAiLocation: 'chat-demo:allow-ai-location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  fastSystemPrompt: 'chat-demo:fast-system-prompt',
  fastSearchToolPrompt: 'chat-demo:fast-search-tool-prompt',
  fastReadLinkToolPrompt: 'chat-demo:fast-read-link-tool-prompt',
  fastLocationToolPrompt: 'chat-demo:fast-location-tool-prompt',
  expertSystemPrompt: 'chat-demo:expert-system-prompt',
  expertSearchToolPrompt: 'chat-demo:expert-search-tool-prompt',
  expertReadLinkToolPrompt: 'chat-demo:expert-read-link-tool-prompt',
  expertLocationToolPrompt: 'chat-demo:expert-location-tool-prompt',
  rpSystemPrompt: 'chat-demo:rp-system-prompt',
  legacySystemPrompt: 'chat-demo:system-prompt',
  legacyToolPromptsEnabled: 'chat-demo:tool-prompts-enabled',
  legacyLocationToolPrompt: 'chat-demo:location-tool-prompt',
  chatMode: 'chat-demo:chat-mode',
  rpModel: 'chat-demo:rp-model',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 兼容老版本全局提示词：尚未分别保存新字段时沿用旧配置 */
const legacySystemPrompt = read(KEYS.legacySystemPrompt)
const legacyLocationToolPrompt =
  read(KEYS.legacyToolPromptsEnabled) === 'true' ? read(KEYS.legacyLocationToolPrompt) : null

const initialChatMode = (): ChatMode => {
  const saved = read(KEYS.chatMode)
  return saved === 'expert' || saved === 'rp' ? saved : 'fast'
}

const initialRpModel = (): ChatModel =>
  read(KEYS.rpModel) === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash'

/** 已设置过手动位置的老版本升级时默认保持开启，未配置过或显式关闭时为 false */
const initialLocationValue = initialLocation()
const initialLocationEnabled = (): boolean => {
  const saved = read(KEYS.locationEnabled)
  if (saved === 'true' || saved === 'false') {
    return saved === 'true'
  }
  return initialLocationValue !== null
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocationValue,
  locationEnabled: initialLocationEnabled(),
  allowAiLocation: read(KEYS.allowAiLocation) === 'true',
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  fastSystemPrompt: read(KEYS.fastSystemPrompt) ?? legacySystemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  fastSearchToolPrompt: read(KEYS.fastSearchToolPrompt) ?? DEFAULT_SEARCH_TOOL_PROMPT,
  fastReadLinkToolPrompt: read(KEYS.fastReadLinkToolPrompt) ?? DEFAULT_READ_LINK_TOOL_PROMPT,
  fastLocationToolPrompt:
    read(KEYS.fastLocationToolPrompt) ?? legacyLocationToolPrompt ?? DEFAULT_LOCATION_TOOL_PROMPT,
  expertSystemPrompt: read(KEYS.expertSystemPrompt) ?? legacySystemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  expertSearchToolPrompt: read(KEYS.expertSearchToolPrompt) ?? DEFAULT_SEARCH_TOOL_PROMPT,
  expertReadLinkToolPrompt: read(KEYS.expertReadLinkToolPrompt) ?? DEFAULT_READ_LINK_TOOL_PROMPT,
  expertLocationToolPrompt:
    read(KEYS.expertLocationToolPrompt) ?? legacyLocationToolPrompt ?? DEFAULT_LOCATION_TOOL_PROMPT,
  rpSystemPrompt: read(KEYS.rpSystemPrompt) ?? DEFAULT_RP_SYSTEM_PROMPT,
  chatMode: initialChatMode(),
  rpModel: initialRpModel(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) !== 'false',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setLocationEnabled = (locationEnabled: boolean) => {
  write(KEYS.locationEnabled, String(locationEnabled))
  useSettings.setState({ locationEnabled })
}

export const setAllowAiLocation = (allowAiLocation: boolean) => {
  write(KEYS.allowAiLocation, String(allowAiLocation))
  useSettings.setState({ allowAiLocation })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setFastSystemPrompt = (fastSystemPrompt: string) => {
  write(KEYS.fastSystemPrompt, fastSystemPrompt)
  useSettings.setState({ fastSystemPrompt })
}

export const setFastSearchToolPrompt = (fastSearchToolPrompt: string) => {
  write(KEYS.fastSearchToolPrompt, fastSearchToolPrompt)
  useSettings.setState({ fastSearchToolPrompt })
}

export const setFastReadLinkToolPrompt = (fastReadLinkToolPrompt: string) => {
  write(KEYS.fastReadLinkToolPrompt, fastReadLinkToolPrompt)
  useSettings.setState({ fastReadLinkToolPrompt })
}

export const setFastLocationToolPrompt = (fastLocationToolPrompt: string) => {
  write(KEYS.fastLocationToolPrompt, fastLocationToolPrompt)
  useSettings.setState({ fastLocationToolPrompt })
}

export const setExpertSystemPrompt = (expertSystemPrompt: string) => {
  write(KEYS.expertSystemPrompt, expertSystemPrompt)
  useSettings.setState({ expertSystemPrompt })
}

export const setExpertSearchToolPrompt = (expertSearchToolPrompt: string) => {
  write(KEYS.expertSearchToolPrompt, expertSearchToolPrompt)
  useSettings.setState({ expertSearchToolPrompt })
}

export const setExpertReadLinkToolPrompt = (expertReadLinkToolPrompt: string) => {
  write(KEYS.expertReadLinkToolPrompt, expertReadLinkToolPrompt)
  useSettings.setState({ expertReadLinkToolPrompt })
}

export const setExpertLocationToolPrompt = (expertLocationToolPrompt: string) => {
  write(KEYS.expertLocationToolPrompt, expertLocationToolPrompt)
  useSettings.setState({ expertLocationToolPrompt })
}

export const setRpSystemPrompt = (rpSystemPrompt: string) => {
  write(KEYS.rpSystemPrompt, rpSystemPrompt)
  useSettings.setState({ rpSystemPrompt })
}

export const setChatMode = (chatMode: ChatMode) => {
  write(KEYS.chatMode, chatMode)
  useSettings.setState({ chatMode })
}

export const setRpModel = (rpModel: ChatModel) => {
  write(KEYS.rpModel, rpModel)
  useSettings.setState({ rpModel })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
