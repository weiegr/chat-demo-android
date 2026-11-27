import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { DEFAULT_MODEL_LIMITS, getModelLimits } from '../../services/api/modelLimits.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import { isTextAttachment, loadInlineTexts } from '../../services/chat/inlineFiles.js'
import { getReplyText } from '../../services/chat/reply.js'
import {
  buildRpPrompt,
  buildRpSystem,
  currentRpContext,
  estimateRpText,
  getRpHistoryForFiles,
  measureRpInput,
} from '../../services/chat/rpContext.js'
import { getPendingSessionBlobs, useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'

const Progress = createContext<number | undefined>(undefined)
export const useRpContextPercent = () => useContext(Progress)

export const RpContextProgress = ({ children }: { children: ReactNode }) =>
  __BETA__ ? <ActiveRpContextProgress>{children}</ActiveRpContextProgress> : <>{children}</>

type LoadedTextsState = {
  sessionId: string | null
  texts: Map<string, string>
  settled: Set<string>
}

const EMPTY_LOADED_TEXTS: LoadedTextsState = {
  sessionId: null,
  texts: new Map(),
  settled: new Set(),
}

const ActiveRpContextProgress = ({ children }: { children: ReactNode }) => {
  const activeId = useChatStore((state) => state.activeId)
  const ready = useChatStore((state) => state.ready)
  const session = useChatStore((state) =>
    activeId === null ? undefined : state.sessionCache[activeId]
  )
  const welcomeMode = useSettings((state) => state.chatMode)
  const enabled = ready && (activeId === null ? welcomeMode === 'rp' : session?.mode === 'rp')
  const streaming = useChatStore(
    (state) => enabled && activeId !== null && Object.hasOwn(state.streaming, activeId)
  )
  const draft = useChatStore((state) =>
    enabled && activeId !== null ? state.draftReplies[activeId] : undefined
  )
  const rpModel = useSettings((state) => state.rpModel)
  const apiKey = useSettings((state) => state.apiKey)
  const system = useSettings((state) => state.rpSystemPrompt)
  const model = (streaming && draft?.model) || rpModel
  const [limits, setLimits] = useState<{
    key: string | null
    model: typeof model
    context: number
  }>()
  const window =
    limits?.key === apiKey && limits.model === model ? limits.context : DEFAULT_MODEL_LIMITS.context
  useEffect(() => {
    if (!enabled) {
      return
    }
    let disposed = false
    void getModelLimits(apiKey, model).then(({ context }) => {
      if (!disposed) {
        setLimits({ key: apiKey, model, context })
      }
    })
    return () => {
      disposed = true
    }
  }, [enabled, apiKey, model])

  const { history, question } = useMemo(() => {
    const path = enabled && session ? getVisibleMessages(session) : []
    const pending = path.at(-2)
    return streaming && pending?.role === 'user'
      ? { history: path.slice(0, -2), question: pending }
      : { history: path, question: undefined }
  }, [enabled, session, streaming])

  const sessionId = session?.id ?? null
  const { candidates, textFileIds, textFileKey } = useMemo(() => {
    if (!enabled) {
      return { candidates: [], textFileIds: [] as string[], textFileKey: '' }
    }
    const list = getRpHistoryForFiles(history)
    if (question) {
      list.push(question)
    }
    const seen = new Set<string>()
    const ids: string[] = []
    for (const message of list) {
      if (message.role !== 'user') {
        continue
      }
      for (const file of message.files) {
        if (isTextAttachment(file) && !seen.has(file.id)) {
          seen.add(file.id)
          ids.push(file.id)
        }
      }
    }
    return { candidates: list, textFileIds: ids, textFileKey: ids.join(',') }
  }, [enabled, history, question])

  const [loaded, setLoaded] = useState<LoadedTextsState>(EMPTY_LOADED_TEXTS)
  const currentLoaded = loaded.sessionId === sessionId ? loaded : EMPTY_LOADED_TEXTS
  const texts = currentLoaded.texts
  const pendingTextIds = useMemo(() => {
    const pending = new Set<string>()
    for (const id of textFileIds) {
      if (!currentLoaded.settled.has(id)) {
        pending.add(id)
      }
    }
    return pending
  }, [currentLoaded.settled, textFileIds])

  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates

  useEffect(() => {
    if (!enabled || !textFileKey) {
      return
    }
    const ids = textFileKey.split(',')
    let disposed = false
    const pendingBlobs = sessionId ? getPendingSessionBlobs(sessionId) : undefined
    void loadInlineTexts(candidatesRef.current, pendingBlobs).then((fetched) => {
      if (disposed) {
        return
      }
      setLoaded((previous) => {
        const baseTexts =
          previous.sessionId === sessionId ? previous.texts : new Map<string, string>()
        const baseSettled = previous.sessionId === sessionId ? previous.settled : new Set<string>()
        const nextTexts = new Map(baseTexts)
        for (const [id, content] of fetched) {
          nextTexts.set(id, content)
        }
        const nextSettled = new Set(baseSettled)
        for (const id of ids) {
          nextSettled.add(id)
        }
        return { sessionId, texts: nextTexts, settled: nextSettled }
      })
    })
    return () => {
      disposed = true
    }
  }, [enabled, sessionId, textFileKey])

  const preview = useMemo(() => {
    if (!enabled) {
      return 0
    }
    const prompt = buildRpPrompt({
      history,
      question,
      model,
      thinking: false,
      texts,
      preview: true,
      pendingTextIds,
    })
    const context = currentRpContext(prompt, buildRpSystem(system))
    return measureRpInput(context.system, context.messages, prompt.files, model, prompt.rounds)
      .projected
  }, [enabled, history, model, pendingTextIds, question, system, texts])

  const sample = streaming ? draft?.rpContext : undefined
  const streamed = useRef<{ id: string; prefill: number; length: number; tokens: number }>()
  let used = preview
  if (sample && draft) {
    const text = getReplyText(draft)
    const previous = streamed.current
    const from =
      previous?.id === draft.id &&
      previous.prefill === sample.prefillLength &&
      previous.length <= text.length
        ? previous
        : { id: draft.id, prefill: sample.prefillLength, length: sample.prefillLength, tokens: 0 }
    const tokens = from.tokens + estimateRpText(text.slice(from.length))
    streamed.current = { ...from, length: text.length, tokens }
    used = (sample.inputTokens ?? sample.projected) + tokens
  } else {
    streamed.current = undefined
  }
  const limit = Math.max(1, sample?.window ?? window)
  const safeUsed = Number.isFinite(used) ? Math.max(0, used) : 0
  const ratio = Math.min(100, Math.floor((1000 * safeUsed) / limit) / 10)
  return <Progress.Provider value={enabled ? ratio : undefined}>{children}</Progress.Provider>
}
