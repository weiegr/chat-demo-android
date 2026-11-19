import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 系统提示词默认值；可在设置中修改或清空（清空后请求不带 system 内容） */
export const DEFAULT_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/** 本机设置，存 localStorage：API Key、语言、主题、位置与 AI 定位权限、允许回复插图、朗读音色、系统提示词、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  locationEnabled: boolean
  allowAiLocation: boolean
  allowAiImages: boolean
  ttsVoice: TtsVoice
  systemPrompt: string
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  locationEnabled: 'chat-demo:location-enabled',
  allowAiLocation: 'chat-demo:allow-ai-location',
  allowAiImages: 'chat-demo:allow-ai-images',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  systemPrompt: 'chat-demo:system-prompt',
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

/** 自定义系统提示词，未保存过时使用默认身份说明；保存过空串则请求不带 system 内容 */
const initialSystemPrompt = (): string => read(KEYS.systemPrompt) ?? DEFAULT_SYSTEM_PROMPT

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
  allowAiImages: read(KEYS.allowAiImages) !== 'false',
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  systemPrompt: initialSystemPrompt(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
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

export const setAllowAiImages = (allowAiImages: boolean) => {
  write(KEYS.allowAiImages, String(allowAiImages))
  useSettings.setState({ allowAiImages })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setSystemPrompt = (systemPrompt: string) => {
  write(KEYS.systemPrompt, systemPrompt)
  useSettings.setState({ systemPrompt })
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
