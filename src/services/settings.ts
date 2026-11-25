import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import type { ChatModel } from './api/types.js'
import { loadStoredApiKey, saveStoredApiKey } from './apiKeyStorage.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 对话模式：快速（Flash 全功能）/ 专家（Pro 复杂问题 + OCR）/ RP（长上下文纯净模式） */
export type ChatMode = 'fast' | 'expert' | 'rp'
export type QuickCameraShortcut = 'on' | 'when-occupied' | 'off'

/** 快速模式系统提示词默认值；可在设置中修改或清空（清空后请求不带基础 system 内容） */
export const DEFAULT_FAST_SYSTEM_PROMPT = '该助手为DeepSeek Flash，由深度求索公司创造。'

/** 专家模式系统提示词默认值；对模型只提档位（Pro），不暴露具体型号 */
export const DEFAULT_EXPERT_SYSTEM_PROMPT = '该助手为DeepSeek Pro，由深度求索公司创造。'

/** RP 模式系统提示词默认值：明确角色扮演边界，可在设置中修改或清空 */
export const DEFAULT_RP_SYSTEM_PROMPT =
  '你是 AI RP 助手，专注于沉浸式虚构角色扮演。请始终遵循用户设定的角色、语气与世界观，保持人设和剧情连贯，不擅自跳出角色或代替用户行动；用户未指定设定时，主动配合并推动剧情发展。'

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

/** API Key 从加密存储载入，其他本机设置保存在 localStorage。 */
type Settings = {
  apiKey: string | null
  apiKeyStorageMode: 'loading' | 'ready' | 'temporary' | 'error'
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  locationEnabled: boolean
  allowAiLocation: boolean
  allowVideoUpload: boolean
  videoAudioEnabled: boolean
  quickCameraShortcut: QuickCameraShortcut
  ttsVoice: TtsVoice
  /** 回答完成后是否自动朗读回复内容 */
  autoReadAloud: boolean
  fastSystemPrompt: string
  expertSystemPrompt: string
  rpSystemPrompt: string
  chatMode: ChatMode
  rpModel: ChatModel
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 新对话界面是否启用陀螺仪动态视差效果 */
  chatParallaxEnabled: boolean
}

/** 按会话模式取出对应的基础系统提示词配置 */
export const getModeSystemPrompt = (
  mode: ChatMode,
  settings: Pick<Settings, 'fastSystemPrompt' | 'expertSystemPrompt' | 'rpSystemPrompt'>
): string => {
  if (mode === 'rp') {
    return settings.rpSystemPrompt
  }
  if (mode === 'expert') {
    return settings.expertSystemPrompt
  }
  return settings.fastSystemPrompt
}

const KEYS = {
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  locationEnabled: 'chat-demo:location-enabled',
  allowAiLocation: 'chat-demo:allow-ai-location',
  allowVideoUpload: 'chat-demo:allow-video-upload',
  videoAudioEnabled: 'chat-demo:transcribe-video-audio',
  quickCameraShortcut: 'chat-demo:quick-camera-shortcut',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  autoReadAloud: 'chat-demo:auto-read-aloud',
  fastSystemPrompt: 'chat-demo:fast-system-prompt',
  expertSystemPrompt: 'chat-demo:expert-system-prompt',
  rpSystemPrompt: 'chat-demo:rp-system-prompt',
  legacySystemPrompt: 'chat-demo:system-prompt',
  chatMode: 'chat-demo:chat-mode',
  rpModel: 'chat-demo:rp-model',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  chatParallaxEnabled: 'chat-demo:chat-parallax',
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

const initialChatMode = (): ChatMode => {
  const saved = read(KEYS.chatMode)
  return saved === 'expert' || saved === 'rp' ? saved : 'fast'
}

const initialRpModel = (): ChatModel =>
  read(KEYS.rpModel) === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash'

const initialQuickCameraShortcut = (): QuickCameraShortcut => {
  const saved = read(KEYS.quickCameraShortcut)
  return saved === 'when-occupied' || saved === 'off' ? saved : 'on'
}

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
  apiKey: null,
  apiKeyStorageMode: 'loading',
  locale: initialLocale(),
  location: initialLocationValue,
  locationEnabled: initialLocationEnabled(),
  allowAiLocation: read(KEYS.allowAiLocation) === 'true',
  allowVideoUpload: read(KEYS.allowVideoUpload) === 'true',
  videoAudioEnabled: read(KEYS.videoAudioEnabled) === 'true',
  quickCameraShortcut: initialQuickCameraShortcut(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  autoReadAloud: read(KEYS.autoReadAloud) === 'true',
  fastSystemPrompt: read(KEYS.fastSystemPrompt) ?? legacySystemPrompt ?? DEFAULT_FAST_SYSTEM_PROMPT,
  expertSystemPrompt:
    read(KEYS.expertSystemPrompt) ?? legacySystemPrompt ?? DEFAULT_EXPERT_SYSTEM_PROMPT,
  rpSystemPrompt: read(KEYS.rpSystemPrompt) ?? DEFAULT_RP_SYSTEM_PROMPT,
  chatMode: initialChatMode(),
  rpModel: initialRpModel(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) !== 'false',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  chatParallaxEnabled: read(KEYS.chatParallaxEnabled) === 'true',
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

export const setAllowVideoUpload = (allowVideoUpload: boolean) => {
  write(KEYS.allowVideoUpload, String(allowVideoUpload))
  useSettings.setState({ allowVideoUpload })
}

export const setQuickCameraShortcut = (quickCameraShortcut: QuickCameraShortcut) => {
  write(KEYS.quickCameraShortcut, quickCameraShortcut)
  useSettings.setState({ quickCameraShortcut })
}

export const canUploadVideo = (
  mode: ChatMode,
  { allowVideoUpload }: Pick<Settings, 'allowVideoUpload'> = useSettings.getState()
) => mode === 'fast' && allowVideoUpload

export const setVideoAudioEnabled = (videoAudioEnabled: boolean) => {
  write(KEYS.videoAudioEnabled, String(videoAudioEnabled))
  useSettings.setState({ videoAudioEnabled })
}

export const canTranscribeVideo = (
  mode: ChatMode,
  settings: Pick<Settings, 'allowVideoUpload' | 'videoAudioEnabled'> = useSettings.getState()
) => canUploadVideo(mode, settings) && settings.videoAudioEnabled

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setAutoReadAloud = (autoReadAloud: boolean) => {
  write(KEYS.autoReadAloud, String(autoReadAloud))
  useSettings.setState({ autoReadAloud })
}

export const setFastSystemPrompt = (fastSystemPrompt: string) => {
  write(KEYS.fastSystemPrompt, fastSystemPrompt)
  useSettings.setState({ fastSystemPrompt })
}

export const setExpertSystemPrompt = (expertSystemPrompt: string) => {
  write(KEYS.expertSystemPrompt, expertSystemPrompt)
  useSettings.setState({ expertSystemPrompt })
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

let apiKeyInitialization: Promise<void> | undefined
let apiKeyWrite = Promise.resolve()

export const initApiKey = () =>
  (apiKeyInitialization ??= loadStoredApiKey().then(
    (stored) => useSettings.setState(stored),
    () => useSettings.setState({ apiKeyStorageMode: 'error' })
  ))

export const setApiKey = (apiKey: string | null) => {
  const write = apiKeyWrite.then(async () => {
    await initApiKey()
    const apiKeyStorageMode = await saveStoredApiKey(apiKey)
    useSettings.setState({ apiKey, apiKeyStorageMode })
  })
  apiKeyWrite = write.catch(() => {})
  return write
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

export const setChatParallaxEnabled = (chatParallaxEnabled: boolean) => {
  write(KEYS.chatParallaxEnabled, String(chatParallaxEnabled))
  useSettings.setState({ chatParallaxEnabled })
}
