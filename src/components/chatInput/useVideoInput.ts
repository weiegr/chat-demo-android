import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { addDraftVideoFrames, getDraft } from '../../services/chat/drafts.js'
import { useChatStore } from '../../services/chat/store.js'
import { canUploadVideo, useSettings } from '../../services/settings.js'
import { extractVideoSheets, VideoTooLongError } from '../../services/video/frames.js'
import { showToast } from '../base/toastState.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'

const getModeForVideo = (sessionId: string | null) =>
  sessionId === null
    ? useSettings.getState().chatMode
    : (useChatStore.getState().sessionCache[sessionId]?.mode ?? 'fast')

export const useVideoInput = (draftKey: string | null, sessionId: string | null) => {
  const current = useRef<AbortController | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const cancel = useCallback(() => {
    current.current?.abort()
    current.current = null
    setProgress(null)
  }, [])

  useLayoutEffect(() => {
    if (!__BETA__) {
      return
    }
    const unsubscribeSettings = useSettings.subscribe((settings) => {
      if (current.current && !canUploadVideo(getModeForVideo(sessionId), settings)) {
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
    return () => {
      unsubscribeSettings()
      unsubscribeChat()
      current.current?.abort()
      current.current = null
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

  const add = async (files: File[]) => {
    if (files.length === 0 || !canSelect() || !ensureApiKey()) {
      return
    }
    if (files.length > 1) {
      showToast({ key: 'videoLimitOne' })
      return
    }
    const controller = new AbortController()
    current.current = controller
    setProgress(0)
    try {
      const sheets = await extractVideoSheets(files[0], controller.signal, setProgress)
      if (controller.signal.aborted || !ensureApiKey()) {
        return
      }
      const error = addDraftVideoFrames(
        draftKey,
        files[0],
        sheets,
        useSettings.getState().apiKey ?? '',
        getModeForVideo(sessionId)
      )
      if (error) {
        showToast(error)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        showToast({ key: error instanceof VideoTooLongError ? 'videoTooLong' : 'videoReadFailed' })
      }
    } finally {
      if (current.current === controller) {
        current.current = null
        setProgress(null)
      }
    }
  }

  return { add, cancel, canSelect, progress, isProcessing: () => current.current !== null }
}
