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
import { loadInlineTexts } from '../../services/chat/inlineFiles.js'
import { getReplyText } from '../../services/chat/reply.js'
import {
  buildRpPrompt,
  currentRpContext,
  estimateRpText,
  getRpHistoryForFiles,
  measureRpInput,
} from '../../services/chat/rpContext.js'
import { useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'

const Progress = createContext<number | undefined>(undefined)
export const useRpContextPercent = () => useContext(Progress)

export const RpContextProgress = ({ children }: { children: ReactNode }) =>
  __BETA__ ? <ActiveRpContextProgress>{children}</ActiveRpContextProgress> : <>{children}</>

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
  const [loaded, setLoaded] = useState<{ history: typeof history; texts: Map<string, string> }>()
  const texts = loaded?.history === history ? loaded.texts : undefined
  useEffect(() => {
    if (!enabled) {
      return
    }
    const candidates = getRpHistoryForFiles(history)
    if (question) {
      candidates.push(question)
    }
    if (!candidates.some((message) => message.role === 'user' && message.files.length > 0)) {
      return
    }
    let disposed = false
    void loadInlineTexts(candidates).then((texts) => {
      if (!disposed) {
        setLoaded({ history, texts })
      }
    })
    return () => {
      disposed = true
    }
  }, [enabled, history, question])

  const preview = useMemo(() => {
    if (!enabled) {
      return 0
    }
    const prompt = buildRpPrompt({ history, question, model, thinking: false, texts })
    const context = currentRpContext(prompt, system.trim())
    return measureRpInput(context.system, context.messages, prompt.files, model, prompt.rounds)
      .projected
  }, [enabled, history, model, question, system, texts])
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
  const ratio = Math.min(100, Math.floor((1000 * used) / (sample?.window ?? window)) / 10)
  return <Progress.Provider value={enabled ? ratio : undefined}>{children}</Progress.Provider>
}
