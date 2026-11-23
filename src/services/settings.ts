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

export const DEFAULT_FAST_LIVE_PROMPT = [
  '你正在 DeepSeek Live 通话模式中，由 DeepSeek Flash 模型提供回答。',
  '像当面聊天一样，用自然口语和简短连贯的句子直接回答。少用书面语、列表、分点、括号注释和复杂长句。',
  '复杂话题先讲当前最关键的一小段，把后续逻辑拆成几轮对话，给用户留出插话和追问的空间。',
  '用户打断或改问时，跟随最新发言。需要核实信息或实际位置时，按可用工具和授权使用搜索或定位。',
].join('\n')

const LEGACY_FAST_VIDEO_PROMPTS = [
  '带时间戳的 2×2 拼图是用户视频中按时间均匀抽取的画面。按拼图顺序阅读，每张先左后右、先上后下。根据可见画面和时间戳回答，区分画面中可见的内容与推断。你只能看到抽样画面，无法听到音轨或确认两帧之间的细节。普通图片附件仍按普通图片理解。',
  '「视频画面」后的每张图按左上、右上、左下、右下排列四幅画面。每格对应独立时刻，以单格画面判断该时刻的物体数量和位置。将「视频对白转写」当作视频中人物的发言，结合画面和可用对白直接回答用户的问题。用户问及处理方式时，简短说明收到的是按时间排列的画面和可用的对白转写。证据不足时，只指出影响回答的具体细节。',
]

export const DEFAULT_FAST_VIDEO_PROMPT = [
  '「视频画面」后的每张图按左上、右上、左下、右下排列四幅画面。每格对应独立时刻，以单格画面判断该时刻的物体数量和位置。',
  '「视频对白」是视频中人物说的话。结合画面和对白，用自然的语言直接回答用户的问题。需要引用时，直接说视频里的人讲了什么。',
  '回答聚焦视频内容。只有用户问到处理方式时，才说明提供了哪些画面和对白。证据不足时，只指出影响回答的具体细节。',
].join('\n')

/** 专家模式系统提示词默认值；对模型只提档位（Pro），不暴露具体型号 */
export const DEFAULT_EXPERT_SYSTEM_PROMPT = '该助手为DeepSeek Pro，由深度求索公司创造。'

/** RP 模式系统提示词默认值：明确角色扮演边界，可在设置中修改或清空 */
export const DEFAULT_RP_SYSTEM_PROMPT =
  '你是 AI RP 助手，专注于沉浸式虚构角色扮演。请始终遵循用户设定的角色、语气与世界观，保持人设和剧情连贯，不擅自跳出角色或代替用户行动；用户未指定设定时，主动配合并推动剧情发展。'

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
  fastLivePrompt: string
  fastVideoPrompt: string
  fastSearchToolPrompt: string
  fastReadLinkToolPrompt: string
  fastLocationToolPrompt: string
  expertSystemPrompt: string
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
    | 'fastVideoPrompt'
    | 'allowVideoUpload'
    | 'fastSearchToolPrompt'
    | 'fastReadLinkToolPrompt'
    | 'fastLocationToolPrompt'
    | 'expertSystemPrompt'
    | 'rpSystemPrompt'
  >,
  hasVideoContext: boolean
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
      // v4-pro 不声明任何服务端/客户端工具，工具提示词在专家模式无请求侧用途
      searchToolPrompt: '',
      readLinkToolPrompt: '',
      locationToolPrompt: '',
    }
  }
  return {
    systemPrompt: hasVideoContext && canUploadVideo(mode, settings)
      ? [settings.fastSystemPrompt.trim(), settings.fastVideoPrompt.trim()]
          .filter(Boolean)
          .join('\n\n')
      : settings.fastSystemPrompt,
    searchToolPrompt: settings.fastSearchToolPrompt,
    readLinkToolPrompt: settings.fastReadLinkToolPrompt,
    locationToolPrompt: settings.fastLocationToolPrompt,
  }
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
  fastLivePrompt: 'chat-demo:fast-live-prompt',
  fastVideoPrompt: 'chat-demo:fast-video-prompt',
  fastSearchToolPrompt: 'chat-demo:fast-search-tool-prompt',
  fastReadLinkToolPrompt: 'chat-demo:fast-read-link-tool-prompt',
  fastLocationToolPrompt: 'chat-demo:fast-location-tool-prompt',
  expertSystemPrompt: 'chat-demo:expert-system-prompt',
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

const initialQuickCameraShortcut = (): QuickCameraShortcut => {
  const saved = read(KEYS.quickCameraShortcut)
  return saved === 'when-occupied' || saved === 'off' ? saved : 'on'
}

const initialVideoPrompt = () => {
  const saved = read(KEYS.fastVideoPrompt)
  return saved === null || LEGACY_FAST_VIDEO_PROMPTS.includes(saved)
    ? DEFAULT_FAST_VIDEO_PROMPT
    : saved
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
  fastLivePrompt: read(KEYS.fastLivePrompt) ?? DEFAULT_FAST_LIVE_PROMPT,
  fastVideoPrompt: initialVideoPrompt(),
  fastSearchToolPrompt: read(KEYS.fastSearchToolPrompt) ?? DEFAULT_SEARCH_TOOL_PROMPT,
  fastReadLinkToolPrompt: read(KEYS.fastReadLinkToolPrompt) ?? DEFAULT_READ_LINK_TOOL_PROMPT,
  fastLocationToolPrompt:
    read(KEYS.fastLocationToolPrompt) ?? legacyLocationToolPrompt ?? DEFAULT_LOCATION_TOOL_PROMPT,
  expertSystemPrompt:
    read(KEYS.expertSystemPrompt) ?? legacySystemPrompt ?? DEFAULT_EXPERT_SYSTEM_PROMPT,
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

export const setFastLivePrompt = (fastLivePrompt: string) => {
  write(KEYS.fastLivePrompt, fastLivePrompt)
  useSettings.setState({ fastLivePrompt })
}

export const setFastVideoPrompt = (fastVideoPrompt: string) => {
  write(KEYS.fastVideoPrompt, fastVideoPrompt)
  useSettings.setState({ fastVideoPrompt })
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
