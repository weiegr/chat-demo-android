import clsx from 'clsx'
import { memo } from 'react'
import { retryUpload } from '../../services/chat/store.js'
import type { UserMessage as UserMessageType } from '../../services/chat/types.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import { MessageFile } from './MessageFile.js'
import { startUserEdit, useUserEdit } from './userEditState.js'
import styles from './UserMessage.module.css'

export const UserMessage = memo(function UserMessage({
  sessionId,
  message,
  retryUploadId,
  isFirst,
  busy,
  versions,
  onSelectVersion,
}: {
  sessionId: string
  message: UserMessageType
  /** 回答因补传附件失败可重试时为该回答 id */
  retryUploadId: string | null
  isFirst: boolean
  isLast?: boolean
  busy: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  const isEditing = useUserEdit(
    (state) => state.active?.sessionId === sessionId && state.active.messageId === message.id
  )
  const files = message.files

  return (
    <div
      data-editing={isEditing ? 'true' : undefined}
      className={clsx(styles.container, isFirst && styles.isFirst)}
    >
      {files.length > 0 ? (
        <div
          className={clsx(
            styles.files,
            files.some((file) => !file.isImage) && styles.filesWithDocuments,
            isEditing && !message.content && styles.editingTarget
          )}
        >
          {files.map((file) => (
            <MessageFile
              key={file.id}
              file={file}
              onRetry={retryUploadId ? () => retryUpload(sessionId, retryUploadId) : null}
            />
          ))}
        </div>
      ) : null}
      {message.content ? (
        <div
          className={clsx(
            styles.bubble,
            !busy && styles.clickableBubble,
            isEditing && styles.editingTarget
          )}
          onClick={() => {
            if (!busy && !isEditing) {
              startUserEdit(sessionId, message)
            }
          }}
        >
          {message.content}
        </div>
      ) : null}
      {versions.ids.length > 1 ? (
        <div className={styles.bottom}>
          <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
        </div>
      ) : null}
    </div>
  )
})
