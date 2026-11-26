import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  analyzeAudio,
  AudioInputError,
  type AudioInputErrorCode,
  type AudioProgress,
  type PreparedAudio,
} from '../../services/audio/analyze.js'
import { canAttachAudio } from '../../services/audio/format.js'
import { getDraft, saveDraftAudio, useDrafts } from '../../services/chat/drafts.js'
import { useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import { useUserEdit } from '../messages/userEditState.js'

type Status = AudioProgress & { name: string }
type Failure = { id: string; name: string; code: AudioInputErrorCode }
type Work = { controller: AbortController; draft: ReturnType<typeof getDraft>; apiKey: string }
type AudioCache = { transcripts: Map<number, string>; result?: PreparedAudio }

export const useAudioInput = (draftKey: string | null, sessionId: string | null) => {
  const current = useRef<Work | null>(null)
  const cache = useRef(new WeakMap<File, AudioCache>())
  const [status, setStatus] = useState<Status | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)

  const cancel = useCallback(() => {
    current.current?.controller.abort()
    current.current = null
    setStatus(null)
  }, [])

  useLayoutEffect(() => {
    const unsubscribeSettings = useSettings.subscribe(({ apiKey, chatMode }) => {
      const work = current.current
      if (work && (apiKey !== work.apiKey || (sessionId === null && !canAttachAudio(chatMode)))) {
        cancel()
      }
    })
    const unsubscribeChat = useChatStore.subscribe((state, previous) => {
      if (
        current.current &&
        (state.importingHistory ||
          state.activeId !== previous.activeId ||
          (sessionId !== null && !canAttachAudio(state.sessionCache[sessionId]?.mode ?? 'fast')))
      ) {
        cancel()
      }
    })
    const cancelChangedDraft = () => {
      if (current.current) {
        cancel()
        showToast({ key: 'audioDraftChanged' })
      }
    }
    const unsubscribeDrafts = useDrafts.subscribe(() => {
      if (current.current?.draft !== getDraft(draftKey)) {
        cancelChangedDraft()
      }
    })
    const unsubscribeEdit = useUserEdit.subscribe(({ active }, previous) => {
      if (active !== previous.active) {
        cancelChangedDraft()
      }
    })
    return () => {
      unsubscribeSettings()
      unsubscribeChat()
      unsubscribeDrafts()
      unsubscribeEdit()
      current.current?.controller.abort()
      current.current = null
    }
  }, [cancel, draftKey, sessionId])

  const prepare = async (): Promise<boolean> => {
    if (current.current) {
      return false
    }
    const draft = getDraft(draftKey)
    const pending = draft.attachments.filter((item) => item.audio && !item.audio.result)
    if (pending.length === 0) {
      return true
    }
    const settings = useSettings.getState()
    const chat = useChatStore.getState()
    const mode =
      sessionId === null ? settings.chatMode : (chat.sessionCache[sessionId]?.mode ?? 'fast')
    if (!settings.apiKey || chat.importingHistory || !canAttachAudio(mode)) {
      return false
    }
    const controller = new AbortController()
    const work: Work = { controller, draft, apiKey: settings.apiKey }
    current.current = work
    setFailure(null)
    const results = new Map<string, PreparedAudio>()
    try {
      for (const { id, file } of pending) {
        try {
          const name = file.name
          const entry: AudioCache = cache.current.get(file) ?? { transcripts: new Map() }
          cache.current.set(file, entry)
          const result =
            entry.result ??
            (await analyzeAudio(
              file,
              work.apiKey,
              controller.signal,
              (progress) => setStatus({ ...progress, name }),
              entry.transcripts
            ))
          controller.signal.throwIfAborted()
          entry.result = result
          results.set(id, result)
        } catch (error) {
          if (!controller.signal.aborted) {
            const code = error instanceof AudioInputError ? error.code : 'audioDecodeFailed'
            setFailure({ id, name: file.name, code })
          }
          return false
        }
      }
    } finally {
      if (current.current === work) {
        current.current = null
        setStatus(null)
      }
    }
    if (controller.signal.aborted || getDraft(draftKey) !== draft) {
      return false
    }
    saveDraftAudio(draftKey, results)
    return true
  }

  return { prepare, cancel, status, failure, isProcessing: () => current.current !== null }
}
