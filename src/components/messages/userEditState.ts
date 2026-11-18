import { create } from 'zustand'
import { clearDraft, setDraftText } from '../../services/chat/drafts.js'
import type { FileAttachment, UserMessage } from '../../services/chat/types.js'

export type ActiveUserEdit = {
  sessionId: string
  messageId: string
  files: FileAttachment[]
}

export const getEditDraftKey = (sessionId: string, messageId: string) =>
  `edit:${sessionId}:${messageId}`

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
    },
  })
}

export const removeUserEditExistingFile = (fileId: string) => {
  useUserEdit.setState((state) =>
    state.active
      ? {
          active: {
            ...state.active,
            files: state.active.files.filter((file) => file.id !== fileId),
          },
        }
      : state
  )
}

export const cancelUserEdit = () => {
  const current = useUserEdit.getState().active
  if (!current) {
    return
  }
  clearDraft(getEditDraftKey(current.sessionId, current.messageId))
  useUserEdit.setState({ active: null })
}
