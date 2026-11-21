import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  addDraftVideoFrames,
  getDraft,
  useDrafts,
  type DraftVideoTranscript,
} from '../../services/chat/drafts.js'
import { useChatStore } from '../../services/chat/store.js'
import { canTranscribeVideo, canUploadVideo, useSettings } from '../../services/settings.js'
import {
  hasVideoAudioSupport,
  prepareVideoAudioPicker,
  releaseVideoAudioSelection,
  transcribeVideoAudio,
  type VideoAudioPhase,
} from '../../services/video/audio.js'
import { extractVideoSheets, VideoTooLongError } from '../../services/video/frames.js'
import { showToast } from '../base/toastState.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'

const getModeForVideo = (sessionId: string | null) =>
  sessionId === null
    ? useSettings.getState().chatMode
    : (useChatStore.getState().sessionCache[sessionId]?.mode ?? 'fast')

type Work =
  | { kind: 'frames'; controller: AbortController }
  | {
      kind: 'audio'
      controller: AbortController
      draft: ReturnType<typeof getDraft>
      apiKey: string
    }

type Status = { phase: 'frames'; progress: number } | { phase: VideoAudioPhase }

export const useVideoInput = (draftKey: string | null, sessionId: string | null) => {
  const current = useRef<Work | null>(null)
  const pendingSelection = useRef<string>()
  const [status, setStatus] = useState<Status | null>(null)
  const [audioFailureId, setAudioFailureId] = useState<string>()

  const cancel = useCallback(() => {
    current.current?.controller.abort()
    current.current = null
    setStatus(null)
  }, [])

  useLayoutEffect(() => {
    const unsubscribeSettings = useSettings.subscribe((settings) => {
      const work = current.current
      const mode = getModeForVideo(sessionId)
      if (
        work &&
        (!canUploadVideo(mode, settings) ||
          (work.kind === 'audio' &&
            (!canTranscribeVideo(mode, settings) || work.apiKey !== settings.apiKey)))
      ) {
        cancel()
      }
    })
    const unsubscribeChat = useChatStore.subscribe((state, previous) => {
      if (
        current.current &&
        (state.importingHistory ||
          state.activeId !== previous.activeId ||
          !canUploadVideo(getModeForVideo(sessionId)))
      ) {
        cancel()
      }
    })
    const unsubscribeDrafts = useDrafts.subscribe(() => {
      const work = current.current
      const draft = getDraft(draftKey)
      if (work?.kind === 'audio' && draft !== work.draft) {
        cancel()
        if (draft.video === work.draft.video) {
          showToast({ key: 'videoDraftChanged' })
        }
      }
    })
    return () => {
      unsubscribeSettings()
      unsubscribeChat()
      unsubscribeDrafts()
      current.current?.controller.abort()
      current.current = null
      releaseVideoAudioSelection(pendingSelection.current)
      pendingSelection.current = undefined
    }
  }, [cancel, draftKey, sessionId])

  const canSelect = () => {
    if (!canUploadVideo(getModeForVideo(sessionId)) || useChatStore.getState().importingHistory) {
      return false
    }
    if (current.current || getDraft(draftKey).video) {
      showToast({ key: 'videoLimitOne' })
      return false
    }
    return true
  }

  const preparePicker = () => {
    releaseVideoAudioSelection(pendingSelection.current)
    pendingSelection.current = prepareVideoAudioPicker()
    return pendingSelection.current !== undefined
  }

  const finish = (work: Work) => {
    if (current.current === work) {
      current.current = null
      setStatus(null)
    }
  }

  const add = async (files: File[]) => {
    const selectionId = pendingSelection.current
    pendingSelection.current = undefined
    if (files.length === 0 || !canSelect() || !ensureApiKey()) {
      releaseVideoAudioSelection(selectionId)
      return
    }
    if (files.length > 1) {
      releaseVideoAudioSelection(selectionId)
      showToast({ key: 'videoLimitOne' })
      return
    }
    const controller = new AbortController()
    const work: Work = { kind: 'frames', controller }
    current.current = work
    setStatus({ phase: 'frames', progress: 0 })
    setAudioFailureId(undefined)
    let keptSelection = false
    try {
      const sheets = await extractVideoSheets(files[0], controller.signal, (progress) =>
        setStatus({ phase: 'frames', progress })
      )
      if (controller.signal.aborted || !ensureApiKey()) {
        return
      }
      const error = addDraftVideoFrames(
        draftKey,
        files[0],
        sheets,
        useSettings.getState().apiKey ?? '',
        getModeForVideo(sessionId),
        selectionId
      )
      if (error) {
        showToast(error)
      } else {
        keptSelection = true
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        showToast({ key: error instanceof VideoTooLongError ? 'videoTooLong' : 'videoReadFailed' })
      }
    } finally {
      if (!keptSelection) {
        releaseVideoAudioSelection(selectionId)
      }
      finish(work)
    }
  }

  const send = async (
    submit: (transcript?: DraftVideoTranscript) => boolean,
    visualsOnly = false
  ) => {
    if (current.current) {
      return
    }
    // 音频准备完成后只提交点击发送时的草稿，后续修改需要重新确认发送。
    const draft = getDraft(draftKey)
    const video = draft.video
    const settings = useSettings.getState()
    if (
      !video ||
      visualsOnly ||
      !canTranscribeVideo(getModeForVideo(sessionId), settings) ||
      !hasVideoAudioSupport()
    ) {
      submit()
      return
    }
    const apiKey = settings.apiKey
    if (!apiKey) {
      return
    }
    const controller = new AbortController()
    const work: Work = { kind: 'audio', controller, draft, apiKey }
    current.current = work
    setAudioFailureId(undefined)
    let text: string
    try {
      text = await transcribeVideoAudio(
        video.audioSelectionId,
        apiKey,
        controller.signal,
        (phase) => setStatus({ phase })
      )
    } catch {
      if (!controller.signal.aborted) {
        setAudioFailureId(video.id)
      }
      return
    } finally {
      finish(work)
    }
    if (!controller.signal.aborted && getDraft(draftKey) === draft) {
      if (submit({ videoId: video.id, text }) && !text) {
        showToast({ key: 'videoAudioNoSpeech' })
      }
    }
  }

  return {
    add,
    cancel,
    canSelect,
    preparePicker,
    status,
    audioFailureId,
    send,
    isProcessing: () => current.current !== null,
  }
}
