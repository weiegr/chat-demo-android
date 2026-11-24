import { create } from 'zustand'
import { clearDraft, getEditDraftKey, setDraftText } from '../../services/chat/drafts.js'
import type { FileAttachment, UserMessage, VideoAttachment } from '../../services/chat/types.js'

export type ActiveUserEdit = {
  sessionId: string
  messageId: string
  files: FileAttachment[]
  video?: VideoAttachment
}

export const useUserEdit = create<{ active: ActiveUserEdit | null }>(() => ({
  active: null,
}))

export const startUserEdit = (sessionId: string, message: UserMessage) => {
  const previous = useUserEdit.getState().active
  if (previous) {
    clearDraft(getEditDraftKey(previous.sessionId, previous.messageId))
  }
  const draftKey = getEditDraftKey(sessionId, message.id)
  clearDraft(draftKey)
  setDraftText(draftKey, message.content)
  useUserEdit.setState({
    active: {
      sessionId,
      messageId: message.id,
      files: message.files,
      video: message.video,
    },
  })
}

export const removeUserEditExistingFile = (fileId: string) => {
  useUserEdit.setState((state) => {
    const active = state.active
    if (!active) {
      return state
    }
    const video = active.video?.id === fileId ? active.video : undefined
    const audio = active.files.find((file) => file.id === fileId)?.audio
    const ids = video?.frameIds ?? (audio ? [fileId, audio.spectrogramId] : [fileId])
    return {
      active: {
        ...active,
        video: video ? undefined : active.video,
        files: active.files.filter((file) => !ids.includes(file.id)),
      },
    }
  })
}

export const cancelUserEdit = () => {
  const current = useUserEdit.getState().active
  if (!current) {
    return
  }
  clearDraft(getEditDraftKey(current.sessionId, current.messageId))
  useUserEdit.setState({ active: null })
}
