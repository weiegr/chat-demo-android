import clsx from 'clsx'
import { memo } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getAudioSpectrogramIds } from '../../services/audio/metadata.js'
import { retryUpload } from '../../services/chat/store.js'
import type { UserMessage as UserMessageType } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { IconEditOutline16 } from '../base/icons.js'
import { AudioFileCard } from '../files/AudioFileCard.js'
import { StoredVideoTile } from '../files/VideoTile.js'
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
  readOnly,
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
  readOnly: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  const t = useTranslate()
  const isEditing = useUserEdit(
    (state) =>
      !readOnly && state.active?.sessionId === sessionId && state.active.messageId === message.id
  )
  const editable = !readOnly && !busy
  const video = message.video
  const spectrogramIds = getAudioSpectrogramIds(message.files)
  const files = message.files.filter(
    (file) => !video?.frameIds.includes(file.id) && !spectrogramIds.has(file.id)
  )
  const attachmentOnly = !message.content && (files.length > 0 || video !== undefined)

  return (
    <div
      data-message-id={message.id}
      data-editing={isEditing ? 'true' : undefined}
      className={clsx(styles.container, isFirst && styles.isFirst)}
    >
      {files.length > 0 || video ? (
        <div
          className={clsx(
            styles.files,
            files.some((file) => !file.isImage) && styles.filesWithDocuments,
            isEditing && !message.content && styles.editingTarget
          )}
        >
          {video ? <StoredVideoTile video={video} sessionId={sessionId} /> : null}
          {files.map((file) =>
            file.audio ? (
              <AudioFileCard
                key={file.id}
                name={file.name}
                size={file.size}
                source={{ id: file.id, sessionId }}
              />
            ) : (
              <MessageFile
                key={file.id}
                file={file}
                onRetry={retryUploadId ? () => retryUpload(sessionId, retryUploadId) : null}
              />
            )
          )}
        </div>
      ) : null}
      {message.content ? (
        <div
          className={clsx(
            styles.bubble,
            editable && styles.clickableBubble,
            isEditing && styles.editingTarget
          )}
          onClick={editable && !isEditing ? () => startUserEdit(sessionId, message) : undefined}
        >
          {message.content}
        </div>
      ) : null}
      {!readOnly && (attachmentOnly || versions.ids.length > 1) ? (
        <div className={styles.bottom}>
          <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
          {attachmentOnly ? (
            <IconButton
              icon={<IconEditOutline16 />}
              tooltip={t('editMessage')}
              disabled={!editable || isEditing}
              onClick={() => startUserEdit(sessionId, message)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
