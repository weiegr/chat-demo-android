import { settingsPageUrl, type SettingsPage } from './settingsPages.js'

/**
 * 应用功能文档：只写「有什么用、在哪找」，不写实现细节。
 * 供 get_app_guide 工具与本地文档注入共用。
 */
export type AppGuideEntry = {
  id: string
  title: string
  summary: string
  steps?: string
  page?: SettingsPage
  keywords: string[]
}

export type AppGuideMatch = {
  id: string
  title: string
  summary: string
  steps?: string
  page?: SettingsPage
  settingsUrl?: string
}

export type AppGuideOverviewItem = {
  title: string
  summary: string
  entryId?: string
}

export type AppGuideOverviewCategory = {
  id: string
  title: string
  items: AppGuideOverviewItem[]
}

/** 面向“这个软件有什么功能”的功能树；比逐条文档更短，先给分类再让用户追问 */
const APP_GUIDE_OVERVIEW: AppGuideOverviewCategory[] = [
  {
    id: 'chat',
    title: '对话与模型',
    items: [
      {
        title: '三种对话模式',
        summary: '快速模式适合日常，专家模式适合复杂分析，RP 模式用于角色扮演',
        entryId: 'modes',
      },
      {
        title: '深度思考',
        summary: '先推理再回答，适合数学、代码和复杂问题',
        entryId: 'thinking',
      },
      { title: '智能搜索', summary: '回答前上网查最新信息', entryId: 'search' },
      { title: '阅读链接', summary: '读取消息里的网页内容', entryId: 'read-link' },
      {
        title: '重新生成与分支',
        summary: '同一问题保留多个回答并切换',
        entryId: 'branch',
      },
      { title: '继续生成', summary: '回答被截断时接着写' },
      { title: '搜索聊天', summary: '按关键词找回历史会话', entryId: 'chat-search' },
    ],
  },
  {
    id: 'input',
    title: '输入与附件',
    items: [
      { title: '语音输入', summary: '说话转文字，最长 120 秒', entryId: 'voice-input' },
      {
        title: '图片与文件',
        summary: '图片、PDF、Word、PPT 读取',
        entryId: 'attachments',
      },
      { title: '视频输入', summary: '结合画面和人物对白回答', entryId: 'video' },
      { title: '音频附件', summary: '转写音频并结合声音特征', entryId: 'audio' },
      { title: '快捷拍照', summary: '附件菜单直接拍照', entryId: 'quick-camera' },
    ],
  },
  {
    id: 'voice',
    title: '语音与通话',
    items: [
      { title: '实时通话', summary: '像打电话一样连续对话', entryId: 'live-call' },
      { title: '自动朗读', summary: '回答完成后自动读出来', entryId: 'auto-read' },
      { title: '朗读音色', summary: '女声/男声可选', entryId: 'auto-read' },
    ],
  },
  {
    id: 'memory',
    title: '记忆与个性化',
    items: [
      {
        title: '全局记忆',
        summary: '跨会话记住长期偏好',
        entryId: 'global-memory',
      },
      {
        title: '会话记忆',
        summary: '只记住当前会话的设定',
        entryId: 'session-memory',
      },
      {
        title: '系统提示词',
        summary: '分模式设定语气、身份或格式',
        entryId: 'system-prompt',
      },
      { title: '昵称', summary: '让 AI 在回复里称呼你', entryId: 'nickname' },
      {
        title: '聊天背景',
        summary: '自定义背景图和动态视差',
        entryId: 'chat-background',
      },
      {
        title: '个人中心',
        summary: '控制头像、昵称、背景图展示',
        entryId: 'personal-center',
      },
      {
        title: '主题与语言',
        summary: '深色/浅色、中文/英文',
        entryId: 'theme-language',
      },
    ],
  },
  {
    id: 'account',
    title: '位置与账户',
    items: [
      {
        title: '位置',
        summary: '手动地区或允许 AI 获取真实位置',
        entryId: 'location',
      },
      { title: 'API Key', summary: '配置、更换或清除 Key', entryId: 'api-key' },
      {
        title: '余额查询',
        summary: '问 AI 查询当前 Key 的余额',
        entryId: 'balance',
      },
    ],
  },
  {
    id: 'data',
    title: '数据管理',
    items: [
      {
        title: '导入聊天记录',
        summary: '从文件或 URL 导入旧会话',
        entryId: 'import-export',
      },
      {
        title: '导出备份',
        summary: '把全部会话导出成文件',
        entryId: 'import-export',
      },
      { title: '删除会话', summary: '清理不需要的历史记录' },
    ],
  },
]

const ENTRIES: AppGuideEntry[] = [
  {
    id: 'overview',
    title: '功能总览',
    summary:
      '这个应用可以聊天、联网搜索、深度思考、语音输入与朗读、视频理解、实时通话，还能记住长期偏好、导入导出聊天记录。想了解某一项时，直接问具体功能名即可。',
    keywords: [
      '功能',
      '有什么功能',
      '能做什么',
      '介绍',
      '帮助',
      '怎么用',
      '使用说明',
      'feature',
      'help',
      'guide',
    ],
  },
  {
    id: 'settings-entry',
    title: '设置入口',
    summary:
      '设置里可以配置 API Key、全局记忆、导入导出、语音播报、系统提示词、位置、主题与语言等。手机端在侧边栏底部，桌面端在左下角。',
    steps: '侧边栏底部「设置」',
    page: 'general',
    keywords: ['设置', '设置在哪', '设置入口', '打开设置', 'setting', 'settings'],
  },
  {
    id: 'modes',
    title: '三种对话模式',
    summary:
      '快速模式适合日常聊天和轻量任务；专家模式适合复杂分析；RP 模式用于角色扮演和长对话。模式绑定在会话上，切换模式需要新建会话。',
    steps: '新建对话页选择模式；已有会话不能直接换模式',
    keywords: ['模式', '快速模式', '专家模式', 'rp', '角色扮演', '切换模式', 'mode'],
  },
  {
    id: 'thinking',
    title: '深度思考',
    summary:
      '让 AI 先推理再回答，适合数学、代码和复杂分析；简单聊天可以关掉，回复更快。',
    steps: '输入框下方的「深度思考」开关',
    keywords: ['深度思考', '思考', '推理', '复杂问题', 'thinking', 'reasoning'],
  },
  {
    id: 'search',
    title: '智能搜索',
    summary:
      '让 AI 回答前先上网查资料，适合新闻、最新信息、人物、地点等需要核实的提问；快速和专家模式可用，RP 模式不启用。',
    steps: '输入框下方的「智能搜索」开关',
    keywords: ['智能搜索', '联网', '搜索', '最新', '新闻', '查资料', 'search', 'web'],
  },
  {
    id: 'read-link',
    title: '阅读链接',
    summary: '消息里带网页链接时，AI 可以打开链接读内容再回答，不需要额外开开关；仅快速模式可用。',
    steps: '直接在消息里粘贴 http(s) 链接',
    keywords: ['链接', '阅读链接', '网页', 'url', 'link'],
  },
  {
    id: 'voice-input',
    title: '语音输入',
    summary: '按住麦克风说话，转成文字后发送，最长 120 秒。',
    steps: '输入框右侧麦克风按钮',
    keywords: ['语音输入', '语音', '麦克风', '说话', '转文字', 'voice', 'mic'],
  },
  {
    id: 'live-call',
    title: '实时通话',
    summary:
      '像打电话一样和 AI 连续对话，适合边走边聊、练习口语或不想打字时使用；需要快速模式和麦克风权限。',
    steps: '输入框右侧「+」菜单 → 通话（快速模式）',
    keywords: ['通话', '打电话', '实时通话', '语音通话', 'live', 'call'],
  },
  {
    id: 'auto-read',
    title: '自动朗读',
    summary:
      '回答完成后自动把回复读出来，也可以手动点朗读；需要先在设置里选择女声或男声。',
    steps: '设置 → 对话设置 → 语音播报',
    page: 'voiceBroadcast',
    keywords: [
      '朗读',
      '自动朗读',
      '语音播报',
      '语音',
      '听回答',
      '女声',
      '男声',
      'tts',
      'read aloud',
    ],
  },
  {
    id: 'video',
    title: '视频输入',
    summary:
      '发送视频让 AI 结合画面回答；开启对白转写后，还能结合视频里人物说的话。仅快速模式可用。',
    steps: '设置 → 对话设置 → 上传视频（开启后仅快速模式可用）',
    page: 'videoUpload',
    keywords: ['视频', '上传视频', '视频理解', '对白', '转写', 'video'],
  },
  {
    id: 'quick-camera',
    title: '快捷拍照',
    summary: '在附件菜单里直接打开相机拍照发送。',
    steps: '设置 → 对话设置 → 上传视频 → 快捷拍照',
    page: 'videoUpload',
    keywords: ['拍照', '相机', '快捷拍照', 'camera'],
  },
  {
    id: 'location',
    title: '位置',
    summary:
      '手动设置所在地区，或允许 AI 在需要天气、附近地点时获取真实位置；需要快速模式，并同时开启深度思考和智能搜索。',
    steps: '设置 → 应用设置 → 位置（打开「允许 AI 定位」）；系统需授予定位权限',
    page: 'location',
    keywords: ['位置', '定位', '地区', '天气', '附近', '设置位置', 'location'],
  },
  {
    id: 'global-memory',
    title: '全局记忆',
    summary:
      '让 AI 记住跨会话的长期偏好和重要信息，之后聊天会自动参考；需要快速模式并使用 DeepSeek Flash，开启后会在合适轮次自动归纳。',
    steps: '设置 → 数据管理 → 全局记忆',
    page: 'globalMemory',
    keywords: ['全局记忆', '记忆', '记住', '偏好', 'memory'],
  },
  {
    id: 'session-memory',
    title: '会话记忆',
    summary:
      '只让 AI 记住当前会话里的设定和细节，不影响其他会话；需要先开启全局记忆，并在快速模式下使用 DeepSeek Flash。',
    steps: '会话页顶部的记忆按钮',
    keywords: ['会话记忆', '这次对话', '记住这个会话'],
  },
  {
    id: 'system-prompt',
    title: '系统提示词',
    summary:
      '给快速、专家、RP 模式分别设定长期生效的回复要求，比如固定语气、身份或输出格式。',
    steps: '设置 → 对话设置 → 系统提示词',
    page: 'systemPrompt',
    keywords: ['提示词', '系统提示词', '人设', '语气', '自定义', 'prompt'],
  },
  {
    id: 'chat-background',
    title: '聊天背景',
    summary:
      '给聊天页面换一张背景图，可以从相册选择，也可以开启轻微的动态视差。',
    steps: '设置 → 个性化 → 应用背景 → 聊天背景',
    page: 'chatBackground',
    keywords: ['聊天背景', '背景', '壁纸', '换背景', '视差', 'background'],
  },
  {
    id: 'personal-center',
    title: '个人中心',
    summary:
      '控制设置页顶部是否显示背景图、头像和昵称，以及侧边栏的账号入口；默认关闭，需要手动开启。',
    steps: '设置 → 个性化 → 个人中心',
    page: 'personalCenter',
    keywords: ['个人中心', '头像', '昵称', '背景图', '账号', 'profile'],
  },
  {
    id: 'nickname',
    title: '昵称',
    summary: '设置昵称后，AI 可以在合适的时候这样称呼你；也可以选择不使用昵称。',
    steps: '设置 → 个性化 → 设置昵称',
    page: 'nickname',
    keywords: ['昵称', '称呼', '名字', 'nickname'],
  },
  {
    id: 'import-export',
    title: '导入与导出',
    summary:
      '把旧聊天记录导入进来，或把全部会话导出成文件备份；换机时再导入即可恢复。',
    steps: '设置 → 数据管理 → 导入会话 / 导出信息',
    page: 'data',
    keywords: ['导入', '导出', '备份', '换机', '聊天记录', 'import', 'export', 'backup'],
  },
  {
    id: 'api-key',
    title: 'API Key',
    summary:
      '填好 DeepSeek API Key 才能开始对话；Key 只保存在本机，可以随时更换或清除。',
    steps: '设置 → 数据管理 → API Key',
    page: 'apiKey',
    keywords: ['api key', 'key', '密钥', '配置', '充值', '余额不足', 'apikey'],
  },
  {
    id: 'balance',
    title: '余额查询',
    summary:
      '直接问 AI「我还有多少余额」，它会查询当前 API Key 的账户余额；需要先配置 API Key，并在快速模式下同时开启深度思考和智能搜索。',
    steps: '快速模式 + 深度思考 + 智能搜索',
    keywords: ['余额', '额度', '欠费', '还能用多久', '充值', 'balance', 'credit'],
  },
  {
    id: 'branch',
    title: '分支与重新生成',
    summary:
      '同一个提问可以重新生成多个回答，用左右箭头切换；也可以编辑提问后重新发送，保留旧版本。',
    steps: '回答下方的重新生成按钮和版本箭头',
    keywords: ['重新生成', '分支', '版本', '切换回答', '编辑消息', 'regenerate', 'branch'],
  },
  {
    id: 'chat-search',
    title: '搜索聊天',
    summary: '按关键词搜索所有会话的标题和内容，快速找回以前聊过的东西。',
    steps: '侧边栏搜索框',
    keywords: ['搜索聊天', '搜索会话', '找聊天', '关键词', 'search chats'],
  },
  {
    id: 'theme-language',
    title: '主题与语言',
    summary: '切换浅色、深色或跟随系统，以及中文或英文界面。',
    steps: '设置 → 应用设置 → 主题 / 语言',
    page: 'general',
    keywords: ['主题', '深色', '浅色', '夜间', '语言', '英文', '中文', 'theme', 'language'],
  },
  {
    id: 'attachments',
    title: '文件与图片',
    summary:
      '可以发送图片、PDF、Word、PPT 等附件，让 AI 读取内容并回答；文件较大时会先压缩或提取文字。',
    steps: '输入框右侧「+」按钮',
    keywords: ['文件', '图片', '附件', 'pdf', 'word', 'ppt', 'ocr', '识别'],
  },
  {
    id: 'audio',
    title: '音频附件',
    summary: '发送音频文件后，AI 可以结合转写文字和声音特征来回答；仅快速模式可用，单个文件不超过 32 MB、120 秒。',
    steps: '输入框右侧「+」按钮 → 选择音频',
    keywords: ['音频', '录音文件', '频谱', 'audio'],
  },
]

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\s,，。.!！?？、;；:："'“”‘’()（）【】<>《》|·~`@#$%^&*+=_\\/-]+/g, '')

const bigrams = (text: string) => {
  const chars = Array.from(text)
  const result = new Set<string>()
  for (let index = 0; index < chars.length - 1; index += 1) {
    result.add(`${chars[index]}${chars[index + 1]}`)
  }
  return result
}

const scoreEntry = (entry: AppGuideEntry, query: string, queryBigrams: Set<string>) => {
  const title = normalize(entry.title)
  const summary = normalize(entry.summary)
  const keywords = entry.keywords.map(normalize).filter(Boolean)
  let score = 0
  if (title && (query.includes(title) || title.includes(query))) {
    score += 120
  }
  for (const keyword of keywords) {
    if (query === keyword) {
      score += 100
    } else if (query.includes(keyword)) {
      score += 40 + Math.min(keyword.length * 5, 40)
    } else if (keyword.includes(query) && query.length >= 2) {
      score += 30
    }
  }
  const haystack = `${title}${keywords.join('')}${summary}`
  let hits = 0
  for (const bigram of queryBigrams) {
    if (haystack.includes(bigram)) {
      hits += 1
    }
  }
  score += Math.min(hits * 4, 40)
  return score
}

/** 返回与问题最相关的功能文档；阈值过滤掉“天气”这类只擦到关键词的普通提问。 */
export const searchAppGuide = (rawQuery: string, limit = 4): AppGuideEntry[] => {
  const query = normalize(rawQuery)
  if (!query) {
    return []
  }
  const queryBigrams = bigrams(query)
  return ENTRIES.map((entry) => ({ entry, score: scoreEntry(entry, query, queryBigrams) }))
    .filter(({ score }) => score >= 50)
    .sort((a, b) => b.score - a.score || a.entry.title.length - b.entry.title.length)
    .slice(0, limit)
    .map(({ entry }) => entry)
}

export const toAppGuideMatch = (entry: AppGuideEntry): AppGuideMatch => ({
  id: entry.id,
  title: entry.title,
  summary: entry.summary,
  ...(entry.steps ? { steps: entry.steps } : {}),
  ...(entry.page ? { page: entry.page, settingsUrl: settingsPageUrl(entry.page) } : {}),
})

const OVERVIEW_PATTERN =
  /(有什么功能|功能总览|功能列表|功能树|全部功能|所有功能|能做什么|会做什么|支持哪些|支持什么|功能介绍|介绍一下|有什么用处|whatcan|features|overview|capabilities)/

/** 泛问“有什么功能”时返回功能树，而不是命中某一条具体文档 */
export const isAppGuideOverviewQuery = (query: string) => {
  const normalized = normalize(query)
  if (!normalized) {
    return false
  }
  if (
    !(
      OVERVIEW_PATTERN.test(normalized) ||
      normalized === '功能' ||
      normalized === '介绍' ||
      normalized === '帮助'
    )
  ) {
    return false
  }
  // 提问里已经点名了具体功能时按具体文档处理，例如“全局记忆有什么功能”
  return !ENTRIES.some(
    (entry) => entry.id !== 'overview' && normalized.includes(normalize(entry.title))
  )
}

export type AppGuideOverview = {
  title: string
  categories: { title: string; items: AppGuideOverviewItem[] }[]
}

export const toAppGuideOverview = (): AppGuideOverview => ({
  title: '功能总览',
  categories: APP_GUIDE_OVERVIEW.map(({ title, items }) => ({ title, items })),
})

export const buildAppGuideOverviewContext = () =>
  [
    '### 功能总览',
    '这个应用的功能分为以下几类：',
    ...APP_GUIDE_OVERVIEW.flatMap((category, index) => [
      `${index + 1}. ${category.title}`,
      ...category.items.map((item) => `   - ${item.title}：${item.summary}`),
    ]),
    '回答时先按分类概括，不要把所有子项逐条念完；用户追问某一项时再展开用途和设置入口。',
  ].join('\n')

/** 只有明确的“怎么用/在哪设置”类提问才自动注入，避免天气、闲聊等误触 */
const FEATURE_QUESTION_PATTERN =
  /(怎么(?!样)|如何|怎样|在哪|哪里|设置|功能|开关|有什么用|干什么|支持|能不能|可不可以|介绍|帮助|余额|额度|欠费|充值|导入|导出|备份|换机|朗读|聊天背景|换(?:个|一张)?背景|记忆|昵称|头像|提示词|定位|通话|麦克风|拍照|重新生成|分支|主题|语言|howto|where|setting|feature|support|balance|import|export|backup|memory|theme|language)/

const isFeatureQuestion = (query: string) =>
  FEATURE_QUESTION_PATTERN.test(normalize(query))

/** 本地注入用：把命中的文档拼成可直接放进 system 提示词的摘录。 */
export const buildAppGuideContext = (query: string, limit = 3): string => {
  if (isAppGuideOverviewQuery(query)) {
    return buildAppGuideOverviewContext()
  }
  const normalizedQuery = normalize(query)
  const entries = searchAppGuide(query, limit)
  if (entries.length === 0) {
    return ''
  }
  if (!isFeatureQuestion(normalizedQuery)) {
    const matchedByTitle = entries.some((entry) => {
      const title = normalize(entry.title)
      return normalizedQuery.includes(title) || title.includes(normalizedQuery)
    })
    if (!matchedByTitle) {
      return ''
    }
  }
  return entries
    .map((entry) =>
      [
        `### ${entry.title}`,
        `用途：${entry.summary}`,
        entry.steps ? `入口：${entry.steps}` : '',
        entry.page ? `设置链接：[打开设置](${settingsPageUrl(entry.page)})` : '',
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n')
}
