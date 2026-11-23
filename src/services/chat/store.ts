import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { ApiError, streamMessage } from '../api/client.js'
import { isOcrSupportedAttachment, recognizeFileText } from '../api/ocr.js'
import {
  planSearchQuery,
  searchWeb,
  truncateSearchQuery,
  type SearchApiResult,
} from '../api/search.js'
import type { ChatModel, ClientToolDefinition, CreateMessageRequest } from '../api/types.js'
import {
  classifyStatus,
  extractFileIds,
  getFileErrorCode,
  isRetryableApiError,
} from '../api/errors.js'
import { cancelUpload, describeUploadError, uploadAttachment, useUploads } from '../attachments.js'
import { GeolocationError, getCurrentPosition } from '../geolocation.js'
import {
  canTranscribeVideo,
  canUploadVideo,
  DEFAULT_LOCATION_TOOL_PROMPT,
  getModePrompts,
  resolveModeModel,
  useSettings,
  type ChatMode,
  type Locale,
} from '../settings.js'
import { appendBranch, getVisibleMessages, normalizeSession, selectVersion } from './branches.js'
import * as db from './db.js'
import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  getDraft,
  getEditDraftKey,
  prepareDraftMessage,
  type DraftVideoTranscript,
} from './drafts.js'
import { isTextAttachment, loadInlineTexts } from './inlineFiles.js'
import { createLatestReminder } from './latestReminder.js'
import { autoStartReadAloud } from '../speech/readAloud.js'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  getReplyText,
  settleReply,
  toRequestMessages,
} from './reply.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type ClientToolResultBlock,
  type ClientToolUseBlock,
  type FileAttachment,
  type Message,
  type Session,
  type SessionSummary,
  type UserMessage,
} from './types.js'
import { buildReplyView } from './view.js'

/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/**
 * 请求安全检查级别：RP 模式省略安全参数（保持长上下文纯净）；
 * 其余模式统一使用 low —— high 会拦截定位等正常提问，且定位工具要求 low。
 */
const safetyCheck = (isRpMode: boolean): CreateMessageRequest['safety_check'] =>
  isRpMode ? undefined : { level: 'low' }
/** RP 模式省略服务端 title 时的本地兜底标题字数上限 */
const LOCAL_TITLE_MAX_CHARS = 24
/** 服务端判定 file_id 失效后，重新补传并重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000
/** 单次提问内客户端工具（如真实定位）连续调用次数上限 */
const MAX_TOOL_ROUNDS = 5

const LINK_PATTERN = /https?:\/\//i

const buildLocationTool = (description: string): ClientToolDefinition => ({
  name: 'get_location',
  description: description.trim() || DEFAULT_LOCATION_TOOL_PROMPT,
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Brief reason why the current physical location is needed',
      },
    },
  },
})

/**
 * 组装本轮请求的 system 提示词：
 * - RP 模式仅发送 RP 模式基础系统提示词，不附带任何工具提示词；
 * - 快速/专家模式在基础系统提示词后，按本轮实际启用的工具附带对应模式的搜索与链接阅读工具提示词。
 */
const buildRequestSystem = (
  basePrompt: string,
  {
    isRpMode,
    search,
    hasLink,
    searchToolPrompt,
    readLinkToolPrompt,
  }: {
    isRpMode: boolean
    search: boolean
    hasLink: boolean
    searchToolPrompt: string
    readLinkToolPrompt: string
  }
): string => {
  if (isRpMode) {
    return basePrompt.trim()
  }
  return [
    basePrompt.trim(),
    search ? searchToolPrompt.trim() : '',
    hasLink ? readLinkToolPrompt.trim() : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * 声明本轮可用工具：
 * - RP 模式与专家模式（v4-pro）不声明任何工具；
 * - 快速模式下，read_url 仅在本轮正文含链接时声明，search 开关控制 deepseek_web_search；
 *   客户端定位工具仅在快速模式、思考 + 搜索均开启时声明（服务端约束，且缺少推理时模型无法正确安排调用顺序）。
 */
const requestTools = (
  isRpMode: boolean,
  isV4Pro: boolean,
  search: boolean,
  hasLink: boolean,
  allowAiLocation: boolean,
  thinking: boolean,
  locationToolDescription: string
): NonNullable<CreateMessageRequest['tools']> => {
  if (isRpMode || isV4Pro) {
    return []
  }
  const tools: NonNullable<CreateMessageRequest['tools']> = []
  if (hasLink) {
    tools.push({ type: 'deepseek_read_url', name: 'deepseek_read_url' })
  }
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  // 服务端约束：客户端工具只能在思考模式下与 deepseek_web_search 一同声明，缺一返回 400
  if (allowAiLocation && thinking && search) {
    tools.push(buildLocationTool(locationToolDescription))
  }
  return tools
}

/** RP 模式省略服务端 title 时的本地兜底标题：优先取提问正文，无正文时取首个附件名 */
const buildLocalTitle = (question: UserMessage): string => {
  const fromContent = question.content.replace(/\s+/g, ' ').trim()
  const attachmentName = question.video?.name ?? question.files[0]?.name
  const raw = fromContent || attachmentName?.replace(/\.[^.]+$/, '').trim() || ''
  return Array.from(raw).slice(0, LOCAL_TITLE_MAX_CHARS).join('').trim()
}

/**
 * 旁路搜索的附件判断上下文：本轮提问各附件的文件名 + 内联/OCR 文本片段。
 * 供 flash 判断“这是什么”类指代问句是否有可检索对象，并让查询词结合附件关键信息。
 */
const buildSearchAttachmentContext = (prepared: PreparedRequest): string =>
  prepared.question.files
    .map((file) => {
      const text = prepared.texts?.get(file.id) ?? prepared.ocrTexts?.get(file.id) ?? ''
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 200)
      return snippet ? `${file.name}：${snippet}` : file.name
    })
    .join('\n')

/**
 * 搜索结果按 URL 去重：来源面板按 URL 首次出现登记角标编号，
 * 重复项会让注入文本里的 [N] 与角标错位。
 */
const dedupeSearchResults = (results: SearchApiResult[]): SearchApiResult[] => {
  const seen = new Set<string>()
  return results.filter((item) => {
    if (seen.has(item.url)) {
      return false
    }
    seen.add(item.url)
    return true
  })
}

/**
 * 把旁路搜索结果格式化为注入提问的文本。
 * 编号与伪工具块里结果的顺序一致，模型输出 [citation:N] 后由渲染层解析成角标。
 */
const buildSearchContext = (results: SearchApiResult[], locale: Locale): string => {
  const isZh = locale === 'zh-CN'
  const items = results.map((item, index) => {
    const site = [item.site_name, item.date?.slice(0, 10)].filter(Boolean).join(isZh ? '，' : ', ')
    return [
      `[${index + 1}] ${item.title}${site ? (isZh ? `（${site}）` : ` (${site})`) : ''}`,
      item.summary || item.snippet,
      isZh ? `链接：${item.url}` : `Link: ${item.url}`,
    ]
      .filter((part) => part !== '')
      .join('\n')
  })
  return [
    isZh ? '【联网搜索结果】' : '[Web search results]',
    ...items,
    isZh
      ? '请结合以上搜索结果回答；引用某条结果时在句末使用 [citation:N]（N 为对应编号）标注。若结果与问题无关，请忽略并直接回答。'
      : 'Answer using the search results above. When citing a result, append [citation:N] (N is its number) at the end of the sentence. Ignore the results and answer directly if they are irrelevant.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * 自动朗读：回复正常完成且会话为当前活跃会话时触发。
 * 只读最终正文（与手动朗读按钮一致），续写时截掉前缀已读部分；拒绝回复不读，失败静默。
 */
const autoReadReply = (sessionId: string, reply: AssistantMessage, prefix?: AssistantMessage) => {
  if (sessionId !== useChatStore.getState().activeId || reply.stopReason === 'refusal') {
    return
  }
  const text = buildReplyView(reply, false).answer?.text ?? ''
  const readText = prefix
    ? text.slice((buildReplyView(prefix, false).answer?.text ?? '').length)
    : text
  autoStartReadAloud(reply.id, readText, () => {})
}

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入，包含主动清空标题的情况。 */
const titleRequests = new Set<AbortController>()

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
  /**
   * 正在流式输出的回复，按会话 id 存放，暂不写回 session.messages：
   * 每帧增量只改这一份数据，整段消息数组与列表组件不再跟着重建。
   */
  draftReplies: Record<string, AssistantMessage>
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  streaming: {},
  draftReplies: {},
}))

const { getState: get, setState: set } = useChatStore

const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()

export const loadSessionAttachment = async (sessionId: string, id: string) =>
  pendingFiles.get(sessionId)?.find((file) => file.id === id)?.blob ?? (await db.loadFile(id))
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

/** 丢弃某会话的流式草稿；没有草稿时不触发订阅者。 */
const dropDraft = (sessionId: string) =>
  set((state) =>
    Object.hasOwn(state.draftReplies, sessionId)
      ? {
          draftReplies: Object.fromEntries(
            Object.entries(state.draftReplies).filter(([id]) => id !== sessionId)
          ),
        }
      : state
  )

/** 把回复并入会话消息；消息已不在会话里时保持不变。 */
const commitReply = (sessionId: string, reply: AssistantMessage) => {
  updateSession(sessionId, (session) => {
    let changed = false
    const messages = session.messages.map((item) => {
      if (item.id !== reply.id || item.role !== 'assistant') {
        return item
      }
      changed = true
      return { ...reply, parentId: item.parentId, selectedChildId: item.selectedChildId }
    })
    return changed ? { ...session, messages } : session
  })
  dropDraft(sessionId)
}

/**
 * 流式期间只更新草稿槽：每帧一次调用的路径上不再复制整段消息数组。
 * 收尾、续写前缀等非流式场景直接落到会话消息里。
 */
const updateReply = (sessionId: string, reply: AssistantMessage) => {
  if (getStreamController(sessionId)) {
    set((state) => ({ draftReplies: { ...state.draftReplies, [sessionId]: reply } }))
    return
  }
  commitReply(sessionId, reply)
}

/** 把仍在流式的草稿并入会话（页面隐藏、导出前）；不传 id 时处理全部会话。 */
export const commitDraftReplies = (sessionId?: string) => {
  for (const [id, reply] of Object.entries(get().draftReplies)) {
    if (sessionId === undefined || id === sessionId) {
      commitReply(id, reply)
    }
  }
}

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    const epoch = historyEpoch
    const files = pendingFiles.get(sessionId)
    void db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (pendingFiles.get(sessionId) === files) {
          pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
  }
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      // 增量还在草稿槽里，先并入会话再落盘，页面隐藏时不会丢已收到的内容。
      commitDraftReplies(id)
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/** 按当前模式与开关创建回复：RP 模式固定关闭搜索，模型按模式及 RP 模型设置确定。 */
const createReply = (mode: ChatMode, model: ChatModel): AssistantMessage => {
  const { thinking, search } = useSettings.getState()
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model,
    thinking,
    search: mode === 'rp' ? false : search,
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      const summaries = await db.loadSessionSummaries()
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries) })
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

/**
 * 替换历史对话：先写入暂存，成功后原子替换旧记录；写入为空即删除全部会话与附件。
 * 期间停止生成并禁止修改会话；失败时清除暂存，保留原有记录。
 */
export const replaceHistory = async (write: () => Promise<void>): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    // 已开始的单条删除先同步到内存，避免本次替换失败后列表残留已被删除的记录。
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()
    let summaries: SessionSummary[]
    try {
      await write()
      summaries = await db.commitStaging()
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history replacement'))
      throw error
    }
    sessionAccess.clear()
    unsavedSessions.clear()
    pendingFiles.clear()
    clearAllDrafts()
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
      draftReplies: {},
    })
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    // 替换失败时恢复被取消的详情读取，原有记录继续可用。
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

export const newChat = () => {
  if (!get().importingHistory) {
    set({ activeId: null })
    trimSessionCache()
  }
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    touchSession(id)
    set({ activeId: id })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/**
 * 删除会话；本地原件仅在没有其他会话引用时清理。远端文件不删：导入、编辑、重新生成都会复用同一个附件，
 * 同一服务端文件可能被多个会话引用，不维护引用计数。
 */
export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      draftReplies: Object.fromEntries(
        Object.entries(state.draftReplies).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const stopReply = (sessionId: string) => getStreamController(sessionId)?.abort()

/** 切换已有会话的对话模式（如在标准/专家模式遇单条 32K 限制时一键切至 RP 模式） */
export const setSessionMode = (sessionId: string, mode: ChatMode) => {
  if (get().importingHistory || deletingSessions.has(sessionId) || getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => (session.mode === mode ? session : { ...session, mode }))
  persist(sessionId)
}

const insertSession = (session: Session, activate: boolean) => {
  touchSession(session.id)
  set((state) => ({
    sessions: [toSessionSummary(session), ...state.sessions],
    sessionCache: { ...state.sessionCache, [session.id]: session },
    activeId: activate ? session.id : state.activeId,
  }))
}

/** 为通话复制可用的纯文本轮次，首轮发送后再保存独立会话。 */
export const createLiveSession = (sourceId: string | null): Session | null => {
  const { ready, importingHistory, activeId } = get()
  if (!ready || importingHistory || activeId !== sourceId) {
    return null
  }
  const source = sourceId === null ? undefined : getSession(sourceId)
  if ((sourceId === null ? useSettings.getState().chatMode : (source?.mode ?? 'fast')) !== 'fast') {
    return null
  }
  if (sourceId !== null && !source) {
    return null
  }
  const messages: Message[] = []
  const history = source ? getVisibleMessages(source) : []
  for (const [user, assistant] of getContextRounds(history)) {
    const text = getReplyText(assistant).trim()
    if (user.content.trim() && text) {
      messages.push(
        {
          id: createId(),
          role: 'user',
          content: user.content,
          files: [],
          createdAt: user.createdAt,
        },
        {
          id: createId(),
          role: 'assistant',
          model: assistant.model,
          createdAt: assistant.createdAt,
          status: 'done',
          prefix: false,
          blocks: [{ type: 'text', text }],
        }
      )
    }
  }
  const now = Date.now()
  return {
    id: createId(),
    title: 'DeepSeek Live',
    mode: 'fast',
    createdAt: now,
    updatedAt: now,
    messages,
  }
}

/** 通话首轮建立自己的会话，挂断前由通话页接管展示与朗读。 */
export const sendLiveMessage = async (
  initialSession: Session,
  content: string,
  controller: AbortController
): Promise<AssistantMessage | null> => {
  const sessionId = initialSession.id
  if (getStreamController(sessionId)) {
    await waitForIdle(sessionId)
  }
  if (
    !get().ready ||
    get().importingHistory ||
    deletingSessions.has(sessionId) ||
    controller.signal.aborted ||
    !content.trim()
  ) {
    return null
  }
  const now = Date.now()
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: content.trim(),
    files: [],
    createdAt: now,
  }
  const reply = createReply('fast', 'deepseek-flash')
  const current = getSession(sessionId)
  const session = current ?? initialSession
  const history = getVisibleMessages(session)
  const next = {
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    updatedAt: now,
  }
  if (current) {
    updateSession(sessionId, () => next)
  } else {
    insertSession({ ...next, title: session.title + ' · ' + buildLocalTitle(question) }, true)
  }
  persist(sessionId)
  return streamReply(sessionId, reply, { history, question, live: true }, controller)
}

const prepareQuestionDraft = (
  draftKey: string | null,
  mode: ChatMode,
  model: ChatModel,
  videoTranscript?: DraftVideoTranscript,
  existingFiles: FileAttachment[] = []
) => {
  const settings = useSettings.getState()
  const prepared = prepareDraftMessage(
    getDraft(draftKey),
    useUploads.getState().tasks,
    model === 'deepseek-v4-pro',
    canUploadVideo(mode, settings),
    existingFiles.length > 0
  )
  if (
    !prepared ||
    (videoTranscript &&
      (prepared.video?.id !== videoTranscript.videoId || !canTranscribeVideo(mode, settings)))
  ) {
    return null
  }
  const { text, video } = prepared
  const files = [...existingFiles]
  const blobs: db.StoredFile[] = []
  for (const { blob, ...file } of prepared.files) {
    files.push(file)
    blobs.push({ id: file.id, blob })
  }
  if (video) {
    blobs.push({ id: video.id, blob: video.file })
  }
  const videoMetadata = video && {
    id: video.id,
    name: video.name,
    size: video.size,
    mimeType: video.mimeType,
    frameIds: video.frameIds,
    ...(videoTranscript?.text && { transcript: videoTranscript.text }),
  }
  return { text, files, video: videoMetadata, blobs }
}

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 同步接收成功才清空草稿，附件原件由会话接管；保存失败仍通过保存入口重试。
 */
export const sendMessage = (
  targetSessionId: string | null,
  videoTranscript?: DraftVideoTranscript
) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const settings = useSettings.getState()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return false
  }
  const mode: ChatMode =
    sessionId === null ? settings.chatMode : (getSession(sessionId)?.mode ?? 'fast')
  const model = resolveModeModel(mode, settings.rpModel)
  const prepared = prepareQuestionDraft(targetSessionId, mode, model, videoTranscript)
  if (!prepared) {
    return false
  }
  const { text, files, video, blobs } = prepared
  const now = Date.now()
  if (sessionId === null) {
    const session: Session = {
      id: createId(),
      title: '',
      mode,
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
    }
    sessionId = session.id
    insertSession(session, true)
  }
  const current = getSession(sessionId)
  if (!current) {
    return false
  }
  const history = getVisibleMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files,
    ...(video && { video }),
    createdAt: now,
  }
  const reply = createReply(mode, model)
  if (blobs.length > 0) {
    pendingFiles.set(sessionId, [...(pendingFiles.get(sessionId) ?? []), ...blobs])
  }
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    updatedAt: now,
  }))
  persist(sessionId)
  clearSentDraft(targetSessionId)
  void streamReply(sessionId, reply, { history, question })
  return true
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  if (question?.role !== 'user' || path[index]?.role !== 'assistant') {
    return
  }
  const history = path.slice(0, index - 1)
  const mode = session.mode ?? 'fast'
  const model = resolveModeModel(mode, useSettings.getState().rpModel)
  const reply = createReply(mode, model)
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history, question })
}

/** 编辑提问：将保留的附件和新草稿合入一个分支，原消息及其附件仍可切换查看。 */
export const editMessage = (
  sessionId: string,
  messageId: string,
  existingFiles: FileAttachment[],
  videoTranscript?: DraftVideoTranscript
): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  if (previous?.role !== 'user') {
    return false
  }
  const previousVideo = previous.video
  const keepVideo = previousVideo?.frameIds.every((id) =>
    existingFiles.some((file) => file.id === id)
  )
  const retainedFiles =
    previousVideo && !keepVideo
      ? existingFiles.filter((file) => !previousVideo.frameIds.includes(file.id))
      : existingFiles
  const mode = session.mode ?? 'fast'
  const model = resolveModeModel(mode, useSettings.getState().rpModel)
  const draftKey = getEditDraftKey(sessionId, messageId)
  const prepared = prepareQuestionDraft(draftKey, mode, model, videoTranscript, retainedFiles)
  if (!prepared || (keepVideo && prepared.video)) {
    return false
  }
  const { text, files, blobs } = prepared
  const video = keepVideo ? previousVideo : prepared.video
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files,
    ...(video && { video }),
    createdAt: Date.now(),
  }
  const reply = createReply(mode, model)
  if (blobs.length > 0) {
    pendingFiles.set(sessionId, [...(pendingFiles.get(sessionId) ?? []), ...blobs])
  }
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  clearSentDraft(draftKey)
  void streamReply(sessionId, reply, { history: path.slice(0, index), question })
  return true
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous)
  ) {
    return
  }
  const { thinking, search, rpModel } = useSettings.getState()
  const mode = session.mode ?? 'fast'
  const fallbackModel = resolveModeModel(mode, rpModel)
  const reply: AssistantMessage = {
    ...previous,
    // 未记录请求配置的回复，续写时使用当前会话模式对应的模型和开关。
    model: previous.model ?? fallbackModel,
    thinking: previous.thinking ?? thinking,
    search: mode === 'rp' ? false : (previous.search ?? search),
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
}

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
export const retryUpload = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.error?.kind !== 'upload'
  ) {
    return
  }
  const reply: AssistantMessage = { ...previous, status: 'pending', error: undefined }
  updateReply(sessionId, reply)
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index - 1), question })
}

type Request = {
  history: Message[]
  question: UserMessage
  prefix?: AssistantMessage
  live?: boolean
}
type PreparedRequest = Request & {
  texts?: Map<string, string>
  ocrTexts?: Map<string, string>
}

/** 把补传得到的 serverId 写回会话里所有引用同一附件的消息（编辑、重新生成会共用附件） */
const saveServerIds = (sessionId: string, serverIds: Map<string, string>) => {
  if (serverIds.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => serverIds.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) =>
              serverIds.has(file.id) ? { ...file, serverId: serverIds.get(file.id) ?? null } : file
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/** 把 Pro 模型经 DeepSeek OCR 提取的文字缓存写回会话附件，避免多轮对话与重启后重复识别 */
const saveOcrTexts = (sessionId: string, ocrTexts: Map<string, string>) => {
  if (ocrTexts.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => ocrTexts.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) =>
              ocrTexts.has(file.id) ? { ...file, ocrText: ocrTexts.get(file.id) } : file
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
const ensureServerId = async (
  apiKey: string,
  file: FileAttachment,
  pendingBlobs?: Map<string, Blob>
): Promise<string | null> => {
  if (file.serverId) {
    return file.serverId
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return task.serverId
  }
  const blob = pendingBlobs?.get(file.id) ?? (await db.loadFile(file.id))
  if (!blob) {
    return null
  }
  return uploadAttachment(apiKey, file.id, blob, file.name, file.isImage)
}

/** 用会话里的最新消息替换请求快照：重传前会重置附件的 serverId，快照必须跟着更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
  }
}

/**
 * 发送前就绪全部附件：
 * - 纯文本附件：本地按编码读出正文并入提问，不再上传为 document 块；
 * - deepseek-v4-pro（无原生识图）：图片与 PDF/Word/PPT 自动调用 DeepSeek OCR 接口提取文字并缓存；
 * - deepseek-flash：图片与非纯文本附件按 Files API 补齐 serverId。
 */
const prepareFiles = async (
  sessionId: string,
  request: Request,
  model: ChatModel,
  signal: AbortSignal
): Promise<PreparedRequest> => {
  const epoch = historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照里仍是旧 id，补传会直接复用它。
  request = refreshRequest(sessionId, request)
  const pendingBlobs = new Map(
    (pendingFiles.get(sessionId) ?? []).map((file) => [file.id, file.blob])
  )
  /** 纯文本附件的正文在本地读出后直接并入提问，不再上传为 document */
  const texts = await loadInlineTexts([...request.history, request.question], pendingBlobs)
  const apiKey = useSettings.getState().apiKey ?? ''
  const useOcr = model === 'deepseek-v4-pro'
  const serverIds = new Map<string, string>()
  const ocrTexts = new Map<string, string>()
  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })

  if (useOcr) {
    // 收集本轮提问与历史中已缓存的 OCR 文本
    for (const message of [...request.history, request.question]) {
      if (message.role !== 'user') {
        continue
      }
      for (const file of message.files) {
        if (file.ocrText !== undefined) {
          ocrTexts.set(file.id, file.ocrText)
        }
      }
    }
    const ocrTargets = request.question.files.filter(
      (file) => isOcrSupportedAttachment(file) && !ocrTexts.has(file.id)
    )
    const uploadTargets = request.question.files.filter(
      (file) => !texts.has(file.id) && !isTextAttachment(file) && !isOcrSupportedAttachment(file)
    )
    const questionTasks = Promise.allSettled([
      ...ocrTargets.map(async (file) => {
        const blob = pendingBlobs.get(file.id) ?? (await db.loadFile(file.id))
        if (!blob) {
          return
        }
        const text = await recognizeFileText(apiKey, blob, file.name, signal)
        ocrTexts.set(file.id, text)
      }),
      ...uploadTargets.map(async (file) => {
        const serverId = await ensureServerId(apiKey, file, pendingBlobs)
        if (serverId) {
          serverIds.set(file.id, serverId)
        }
      }),
    ])
    void questionTasks.then(() => {
      if (epoch === historyEpoch) {
        saveOcrTexts(sessionId, ocrTexts)
        saveServerIds(sessionId, serverIds)
      }
    })
    const results = await Promise.race([questionTasks, aborted])
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) {
      throw failed.reason
    }

    // 历史轮次中缺失 OCR 文本的图片/文档从新到旧逐个补齐，单条失败静默跳过不阻塞本轮
    const pendingHistoryOcr = new Map<string, FileAttachment>()
    const pendingHistoryUpload = new Map<string, FileAttachment>()
    for (const [user] of [...getContextRounds(request.history)].reverse()) {
      for (const file of user.files) {
        if (texts.has(file.id) || isTextAttachment(file)) {
          continue
        }
        if (isOcrSupportedAttachment(file)) {
          if (!ocrTexts.has(file.id) && !pendingHistoryOcr.has(file.id)) {
            pendingHistoryOcr.set(file.id, file)
          }
        } else if (
          !file.serverId &&
          !serverIds.has(file.id) &&
          !pendingHistoryUpload.has(file.id)
        ) {
          pendingHistoryUpload.set(file.id, file)
        }
      }
    }
    for (const file of pendingHistoryOcr.values()) {
      signal.throwIfAborted()
      try {
        const blob = pendingBlobs.get(file.id) ?? (await db.loadFile(file.id))
        if (!blob) {
          continue
        }
        const text = await Promise.race([
          recognizeFileText(apiKey, blob, file.name, signal),
          aborted,
        ])
        ocrTexts.set(file.id, text)
        saveOcrTexts(sessionId, new Map([[file.id, text]]))
      } catch {
        signal.throwIfAborted()
      }
    }
    for (const file of pendingHistoryUpload.values()) {
      signal.throwIfAborted()
      try {
        const serverId = await Promise.race([ensureServerId(apiKey, file, pendingBlobs), aborted])
        if (serverId) {
          serverIds.set(file.id, serverId)
          saveServerIds(sessionId, new Map([[file.id, serverId]]))
        }
      } catch {
        signal.throwIfAborted()
      }
    }
  } else {
    const uploads = Promise.allSettled(
      request.question.files
        .filter((file) => !texts.has(file.id) && !isTextAttachment(file))
        .map(async (file) => {
          const serverId = await ensureServerId(apiKey, file, pendingBlobs)
          if (serverId) {
            serverIds.set(file.id, serverId)
          }
        })
    )
    void uploads.then(() => {
      if (epoch === historyEpoch) {
        saveServerIds(sessionId, serverIds)
      }
    })
    const results = await Promise.race([uploads, aborted])
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) {
      throw failed.reason
    }

    const pending = new Map<string, FileAttachment>()
    for (const [user] of [...getContextRounds(request.history)].reverse()) {
      for (const file of user.files) {
        if (
          !file.serverId &&
          !serverIds.has(file.id) &&
          !pending.has(file.id) &&
          !texts.has(file.id) &&
          !isTextAttachment(file)
        ) {
          pending.set(file.id, file)
        }
      }
    }
    for (const file of pending.values()) {
      signal.throwIfAborted()
      try {
        const serverId = await Promise.race([ensureServerId(apiKey, file, pendingBlobs), aborted])
        if (serverId) {
          serverIds.set(file.id, serverId)
          saveServerIds(sessionId, new Map([[file.id, serverId]]))
        }
      } catch {
        signal.throwIfAborted()
      }
    }
  }

  // 用补齐后的会话重新取历史与提问，保证请求里都是最新 serverId / ocrText
  const session = getSession(sessionId)
  const resolve = <T extends Message>(message: T): T =>
    (session?.messages.find((m) => m.id === message.id) as T | undefined) ?? message
  return {
    history: request.history.map(resolve),
    question: resolve(request.question),
    prefix: request.prefix,
    texts,
    ocrTexts,
  }
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  for (const [user] of getContextRounds(request.history)) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效时，清掉对应附件的 serverId 并丢弃旧的上传任务，
 * 下一次补齐会重新读取本地原件上传。报错里点名了 file_id 就只重置这些，
 * 没点名（如 invalid file_id）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError) || !getFileErrorCode(error)) {
    return false
  }
  const mentioned = extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务里可能还留着同一个失效的 serverId，清掉后 ensureServerId 才会重新上传
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

const executeClientTool = async (
  block: ClientToolUseBlock,
  signal: AbortSignal
): Promise<ClientToolResultBlock> => {
  if (block.name !== 'get_location') {
    return {
      type: 'client_tool_result',
      tool_use_id: block.id,
      name: block.name,
      status: 'failed',
      is_error: true,
      content: JSON.stringify({
        error: 'unsupported_tool',
        message: `Unknown tool: ${block.name}`,
      }),
    }
  }
  try {
    const location = await getCurrentPosition(signal)
    const normalizedTs = location.timestamp >= 1_500_000_000_000 ? location.timestamp : Date.now()
    const accuracyMeters =
      location.accuracy !== undefined && location.accuracy > 0
        ? Math.max(1, Math.round(location.accuracy))
        : undefined
    return {
      type: 'client_tool_result',
      tool_use_id: block.id,
      name: block.name,
      status: 'done',
      summary: location.summary,
      content: JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        ...(accuracyMeters !== undefined ? { accuracy_meters: accuracyMeters } : {}),
        ...(location.approximate ? { approximate: true } : {}),
        ...(location.country ? { country: location.country } : {}),
        ...(location.province ? { province: location.province } : {}),
        ...(location.city ? { city: location.city } : {}),
        ...(location.district ? { district: location.district } : {}),
        ...(location.address ? { address: location.address } : {}),
        timestamp: normalizedTs,
        fetched_at: new Date(normalizedTs).toISOString(),
      }),
    }
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    const code = error instanceof GeolocationError ? error.code : 'unavailable'
    const message = error instanceof Error ? error.message : String(error)
    return {
      type: 'client_tool_result',
      tool_use_id: block.id,
      name: block.name,
      status: 'failed',
      is_error: true,
      errorCode: code,
      content: JSON.stringify({ error: code, message }),
    }
  }
}

const getPendingClientToolUses = (reply: AssistantMessage): ClientToolUseBlock[] => {
  const completedIds = new Set(
    reply.blocks.flatMap((block) =>
      block.type === 'client_tool_result' ? [block.tool_use_id] : []
    )
  )
  return reply.blocks.filter(
    (block): block is ClientToolUseBlock => block.type === 'tool_use' && !completedIds.has(block.id)
  )
}

/**
 * 请求并消费流：先补齐附件的 serverId，再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端判定 file_id 失效时重新补传后重发，退避重试且次数有上限，超过则按原始报错收尾。
 * 服务端返回客户端 tool_use（如请求真实位置）时执行本地工具，并将 tool_result 回传继续流式生成。
 */
const streamReply = async (
  sessionId: string,
  initial: AssistantMessage,
  request: Request,
  controller = new AbortController()
) => {
  if (!getSession(sessionId)?.title) {
    titleRequests.add(controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  const settingsSnapshot = useSettings.getState()
  const allowAiLocation = settingsSnapshot.allowAiLocation
  const sessionMode = getSession(sessionId)?.mode ?? 'fast'
  const isRpMode = sessionMode === 'rp'
  const model = initial.model ?? resolveModeModel(sessionMode, settingsSnapshot.rpModel)
  // v4-pro 无原生识图，且服务端不支持 server-side 工具、title 与 latest_reminder 等扩展能力
  const isV4Pro = model === 'deepseek-v4-pro'
  const useOcrForVisual = isV4Pro
  /** 旁路搜索：v4-pro 不支持服务端搜索工具，改为发送前客户端先搜、结果注入提问 */
  const bypassSearch = !isRpMode && isV4Pro && (initial.search ?? false)
  let reply = initial
  let prepared: PreparedRequest = request
  let frame = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  streamFlushes.set(sessionId, flush)

  try {
    let toolRound = 0
    /** 旁路搜索注入文本；附件重传重试时沿用首轮结果，不重复搜索 */
    let searchContext: string | undefined
    let searchPlanned = false
    for (let attempt = 0; ; attempt += 1) {
      /** 附件补齐或 OCR 前出错属于预处理失败，主对话请求还没有发出 */
      let preparing = toolRound === 0
      let receivedContent = false
      try {
        if (toolRound === 0) {
          if (!request.live) {
            prepared = await prepareFiles(sessionId, request, model, controller.signal)
          }
          preparing = false
          // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
          const latestReminder = prepared.prefix
            ? prepared.prefix.latestReminder
            : isV4Pro
              ? undefined
              : createLatestReminder({
                  locale: settingsSnapshot.locale,
                  location: settingsSnapshot.locationEnabled ? settingsSnapshot.location : null,
                })
          reply = { ...reply, latestReminder }
          // 只进草稿槽，收尾时随整段回复一起落盘；这里再写一次是整段会话的重复克隆。
          updateReply(sessionId, reply)
          // 仅在确认需要联网后搜索，沿用现有引用展示与上下文注入。
          if (
            bypassSearch &&
            !searchPlanned &&
            reply.blocks.length === 0 &&
            prepared.question.content.trim()
          ) {
            searchPlanned = true
            const questionText = prepared.question.content
            const attachmentContext = buildSearchAttachmentContext(prepared)
            const searchApiKey = useSettings.getState().apiKey ?? ''
            const query = await planSearchQuery(
              searchApiKey,
              questionText,
              attachmentContext,
              controller.signal
            ).catch((error: unknown) => {
              if (controller.signal.aborted) {
                throw error
              }
              return null
            })
            if (query !== null) {
              const toolUseId = `bypass-search-${createId()}`
              reply = {
                ...reply,
                blocks: [
                  ...reply.blocks,
                  {
                    type: 'server_tool_use',
                    id: toolUseId,
                    name: 'deepseek_web_search',
                    input: { action: 'search', queries: [query] },
                    caller: { type: 'direct' },
                    kind: 'search',
                  },
                ],
              }
              updateReply(sessionId, reply)
              let results: SearchApiResult[] | null = null
              try {
                results = dedupeSearchResults(
                  await searchWeb(
                    searchApiKey,
                    { query, oriQuestion: truncateSearchQuery(questionText) },
                    controller.signal
                  )
                )
              } catch (error) {
                if (controller.signal.aborted) {
                  throw error
                }
                // 搜索失败：结果块记错误项展示「暂不可用」，请求继续（无搜索上下文）
              }
              reply = {
                ...reply,
                blocks: [
                  ...reply.blocks,
                  {
                    type: 'web_search_tool_result',
                    tool_use_id: toolUseId,
                    content: results
                      ? results.map((item) => ({
                          type: 'web_search_result' as const,
                          title: item.title,
                          url: item.url,
                          snippet: item.snippet,
                          site_icon: item.site_icon,
                          site_name: item.site_name,
                          encrypted_content: '',
                          page_age: item.date,
                        }))
                      : [
                          {
                            type: 'web_search_tool_result_error' as const,
                            error_code: 'unavailable' as const,
                          },
                        ],
                    kind: 'search' as const,
                  },
                ],
              }
              updateReply(sessionId, reply)
              if (results && results.length > 0) {
                searchContext = buildSearchContext(results, settingsSnapshot.locale)
              }
            }
          }
        }
        const { messages, hasVideoContext } = toRequestMessages(
          prepared.history,
          prepared.question,
          prepared.prefix,
          initial.thinking ?? false,
          reply.latestReminder,
          toolRound > 0 ? reply : undefined,
          {
            texts: prepared.texts,
            ocrTexts: prepared.ocrTexts,
            omitServerTools: isRpMode,
            omitLatestReminder: isV4Pro,
            useOcrForVisual,
            includeVideo: sessionMode === 'fast' && !request.live,
            searchContext,
          }
        )
        const currentSettings = useSettings.getState()
        const { apiKey } = currentSettings
        const modePrompts = getModePrompts(sessionMode, currentSettings, hasVideoContext)
        const livePrompt = request.live ? currentSettings.fastLivePrompt.trim() : ''
        const systemPrompt = [modePrompts.systemPrompt.trim(), livePrompt]
          .filter(Boolean)
          .join('\n\n')
        // 服务端约束：v4-pro 不支持 server-side 工具（web_search/read_url）与 title 生成，
        // 请求携带任一项即整体报错，因此连同依赖 search 的定位工具一并停用，标题走本地兜底
        const serverToolsAllowed = !isRpMode && !isV4Pro
        const hasLink = serverToolsAllowed && LINK_PATTERN.test(prepared.question.content)
        const searchEnabled = serverToolsAllowed && (initial.search ?? false)
        const safety = safetyCheck(isRpMode)
        const tools = requestTools(
          isRpMode,
          isV4Pro,
          searchEnabled,
          hasLink,
          allowAiLocation,
          initial.thinking ?? false,
          modePrompts.locationToolPrompt
        )
        // RP 模式省略服务端 title（避免触发单条 32K 限制），v4-pro 不支持服务端 title，
        // 两者首轮结束后均写本地兜底标题
        const askTitle = titleRequests.has(controller) && serverToolsAllowed
        const events = streamMessage(
          apiKey ?? '',
          {
            model,
            system: buildRequestSystem(systemPrompt, {
              isRpMode,
              search: searchEnabled,
              hasLink,
              searchToolPrompt: modePrompts.searchToolPrompt,
              readLinkToolPrompt: modePrompts.readLinkToolPrompt,
            }),
            messages,
            thinking: { type: initial.thinking ? 'enabled' : 'disabled' },
            ...(safety ? { safety_check: safety } : {}),
            ...(tools.length > 0 ? { tools } : {}),
            ...(askTitle ? { title: { enabled: true } } : {}),
          },
          controller.signal
        )
        const blockIndexes = new Map<number, number>()
        for await (const event of events) {
          receivedContent ||= event.type === 'content_block_start'
          if (
            event.type === 'message_delta' &&
            (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'max_tokens') &&
            event.delta.title?.trim() &&
            titleRequests.has(controller) &&
            !controller.signal.aborted &&
            !get().importingHistory
          ) {
            const title = event.delta.title.trim()
            updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
            titleRequests.delete(controller)
          }
          reply = applyEvent(reply, event, Date.now(), blockIndexes)
          if (document.visibilityState === 'hidden') {
            flush()
          } else {
            frame ||= requestAnimationFrame(flush)
          }
        }
        flush()
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now())
          break
        }
        const pendingToolUses = getPendingClientToolUses(reply)
        if (pendingToolUses.length > 0 && toolRound < MAX_TOOL_ROUNDS) {
          for (const toolUse of pendingToolUses) {
            const resultBlock = await executeClientTool(toolUse, controller.signal)
            reply = { ...reply, blocks: [...reply.blocks, resultBlock] }
            flush()
          }
          toolRound += 1
          attempt = -1
          continue
        }
        if (
          !askTitle &&
          titleRequests.has(controller) &&
          !controller.signal.aborted &&
          !get().importingHistory
        ) {
          const title = buildLocalTitle(prepared.question)
          if (title) {
            updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
          }
          titleRequests.delete(controller)
        }
        reply = settleReply(reply, 'done', Date.now())
        if (!request.live) {
          autoReadReply(sessionId, reply, prepared.prefix)
        }
        break
      } catch (error) {
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now())
          break
        }
        if (preparing) {
          const statusClass = error instanceof ApiError ? classifyStatus(error.status) : 'other'
          if (
            error instanceof ApiError &&
            (statusClass === 'unauthorized' ||
              statusClass === 'insufficientBalance' ||
              statusClass === 'rateLimited')
          ) {
            reply = settleReply(reply, 'error', Date.now(), {
              kind: error.kind,
              message: error.message,
              status: error.status,
              localMessage: error.localMessage,
            })
            break
          }
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'upload',
            message: '',
            localMessage: describeUploadError(error),
            retryable: isRetryableApiError(error),
          })
          break
        }
        // 附件失效：重新补传后重发。收到过内容块或已进入工具轮次后不自动重发。
        if (
          toolRound === 0 &&
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          reuploadInvalidatedFiles(sessionId, request, error)
        ) {
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleReply(reply, 'done', Date.now())
          if (!request.live) {
            autoReadReply(sessionId, reply, prepared.prefix)
          }
        } else if (error instanceof ApiError) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: error.kind,
            message: error.message,
            status: error.status,
            localMessage: error.localMessage,
          })
        } else {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'protocol',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        break
      }
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    // 收尾时把草稿一次性并入会话：整段落盘只有这一次。
    commitReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
  }
  return reply
}
