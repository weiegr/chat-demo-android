import clsx from 'clsx'
import { memo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { retryUpload } from '../../services/chat/store.js'
import type { UserMessage as UserMessageType } from '../../services/chat/types.js'
import { IconCloseFill14 } from '../base/icons.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import { MessageFile } from './MessageFile.js'
import { removeUserEditExistingFile, startUserEdit, useUserEdit } from './userEditState.js'
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
  const t = useTranslate()
  const activeEdit = useUserEdit((state) =>
    state.active?.sessionId === sessionId && state.active.messageId === message.id
      ? state.active
      : null
  )
  const isEditing = activeEdit !== null
  const files = activeEdit ? activeEdit.files : message.files

  return (
    <div
      className={clsx(
        styles.container,
        isFirst && styles.isFirst,
        isEditing && styles.editingTarget
      )}
    >
      {files.length > 0 ? (
        <div
          className={clsx(
            styles.files,
            files.some((file) => !file.isImage) && styles.filesWithDocuments
          )}
        >
          {files.map((file) => (
            <div key={file.id} className={styles.fileSlot}>
              <MessageFile
                file={file}
                onRetry={retryUploadId ? () => retryUpload(sessionId, retryUploadId) : null}
              />
              {isEditing ? (
                <button
                  type="button"
                  className={styles.fileRemove}
                  aria-label={t('removeAttachment')}
                  onClick={() => removeUserEditExistingFile(file.id)}
                >
                  <IconCloseFill14 />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {message.content ? (
        <div
          className={clsx(styles.bubble, !busy && styles.clickableBubble)}
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
