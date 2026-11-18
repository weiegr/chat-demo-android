import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  IconCameraOutline20,
  IconCheckOutline16,
  IconCloseOutline16,
  IconFolderOutline20,
  IconGlobeLanguageOutline14,
  IconImageOutline20,
  IconPaperclipOutline16,
  IconPlusCircleOutline24,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { saveFiles } from '../../services/chat/db.js'
import { editMessage, sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  addDraftFilesWithIds,
  clearSentDraft,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, resolveMimeType, useUploads } from '../../services/attachments.js'
import {
  cancelUserEdit,
  getEditDraftKey,
  useUserEdit,
  type ActiveUserEdit,
} from '../messages/userEditState.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

interface RecentPhotoItem {
  id: string
  name: string
  mimeType: string
  url: string
  thumb: string
}

interface AndroidMediaBridge {
  setNextPickerMode?: (mode: 'camera' | 'gallery' | 'file') => void
  hasGalleryPermission?: () => boolean
  requestGalleryPermission?: () => void
  requestRecentPhotos?: (limit: number) => void
}

const getAndroidHost = (): AndroidMediaBridge | undefined =>
  (window as Window & { AndroidHost?: AndroidMediaBridge }).AndroidHost

const RECENT_PHOTOS_LIMIT = 10

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  const activeEdit = useUserEdit((state) =>
    sessionId !== null && state.active?.sessionId === sessionId ? state.active : null
  )
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  const key = activeEdit
    ? getEditDraftKey(activeEdit.sessionId, activeEdit.messageId)
    : sessionId === null
      ? 'new'
      : `session:${sessionId}`
  return <Input key={key} sessionId={sessionId} activeEdit={activeEdit} />
})

const Input = ({
  sessionId,
  activeEdit,
}: {
  sessionId: string | null
  activeEdit: ActiveUserEdit | null
}) => {
  const t = useTranslate()
  const draftKey = activeEdit
    ? getEditDraftKey(activeEdit.sessionId, activeEdit.messageId)
    : sessionId
  const draft = useDrafts((state) => state.drafts.get(draftKey) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(draftKey, value)
  const draftReady = useUploads((state) => {
    if (!activeEdit) {
      return prepareDraftMessage(draft, state.tasks) !== null
    }
    const allUploaded = draft.attachments.every((item) => {
      const task = state.tasks[item.id]
      return task?.status === 'done' && Boolean(task.serverId)
    })
    return (
      allUploaded &&
      (draft.text.trim() !== '' || activeEdit.files.length > 0 || draft.attachments.length > 0)
    )
  })
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const albumInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [galleryGranted, setGalleryGranted] = useState(
    () => getAndroidHost()?.hasGalleryPermission?.() ?? false
  )
  const [recentPhotos, setRecentPhotos] = useState<RecentPhotoItem[]>([])
  const [pendingPhotoId, setPendingPhotoId] = useState<string | null>(null)
  const [mediaAttachmentMap, setMediaAttachmentMap] = useState<Record<string, string>>({})

  const editingId = activeEdit?.messageId
  useEffect(() => {
    if (!editingId) {
      return
    }
    setAttachMenuOpen(false)
    const textarea = textareaRef.current
    if (textarea) {
      textarea.focus({ preventScroll: true })
      const len = textarea.value.length
      textarea.setSelectionRange(len, len)
    }
  }, [editingId])

  useEffect(() => {
    const handlePermission = (event: Event) => {
      const granted = Boolean((event as CustomEvent<{ granted?: boolean }>).detail?.granted)
      setGalleryGranted(granted)
      if (granted) {
        getAndroidHost()?.requestRecentPhotos?.(RECENT_PHOTOS_LIMIT)
      }
    }
    const handleRecentPhotos = (event: Event) => {
      const photos = (event as CustomEvent<RecentPhotoItem[] | undefined>).detail
      if (Array.isArray(photos)) {
        setRecentPhotos(photos)
      }
    }
    window.addEventListener('android-gallery-permission', handlePermission)
    window.addEventListener('android-recent-photos', handleRecentPhotos)
    return () => {
      window.removeEventListener('android-gallery-permission', handlePermission)
      window.removeEventListener('android-recent-photos', handleRecentPhotos)
    }
  }, [])

  useEffect(() => {
    if (!isMobile || !attachMenuOpen) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAttachMenuOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMobile, attachMenuOpen])

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(draftKey, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
    setAttachMenuOpen(false)
  }
  const openPicker = (mode: 'camera' | 'gallery' | 'file', input: HTMLInputElement | null) => {
    if (useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    getAndroidHost()?.setNextPickerMode?.(mode)
    input?.click()
    setAttachMenuOpen(false)
  }
  const toggleAttachMenu = () => {
    setAttachMenuOpen((prev) => {
      const next = !prev
      if (next) {
        textareaRef.current?.blur()
        const host = getAndroidHost()
        const granted = host?.hasGalleryPermission?.() ?? false
        setGalleryGranted(granted)
        if (granted) {
          host?.requestRecentPhotos?.(RECENT_PHOTOS_LIMIT)
        }
      }
      return next
    })
  }
  const toggleRecentPhoto = async (photo: RecentPhotoItem) => {
    if (useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const existingId = mediaAttachmentMap[photo.id]
    if (existingId && attachments.some((item) => item.id === existingId)) {
      removeFile(existingId)
      setMediaAttachmentMap((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([key]) => key !== photo.id))
      )
      return
    }
    if (pendingPhotoId === photo.id) {
      return
    }
    setPendingPhotoId(photo.id)
    try {
      const response = await fetch(photo.url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const blob = await response.blob()
      const file = new File([blob], photo.name || `photo_${photo.id}.jpg`, {
        type: photo.mimeType || blob.type || 'image/jpeg',
      })
      const { error, ids } = addDraftFilesWithIds(
        draftKey,
        [file],
        useSettings.getState().apiKey ?? ''
      )
      if (error) {
        showToast(error)
        return
      }
      const createdId = ids[0]
      if (createdId) {
        setMediaAttachmentMap((prev) => ({ ...prev, [photo.id]: createdId }))
      }
    } catch {
      // 若原图已从系统相册删除，刷新最近列表保持缩略图一致
      getAndroidHost()?.requestRecentPhotos?.(RECENT_PHOTOS_LIMIT)
    } finally {
      setPendingPhotoId((current) => (current === photo.id ? null : current))
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(draftKey, id, useSettings.getState().apiKey ?? '')
      }
    },
    [draftKey]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(draftKey, id)
      }
    },
    [draftKey]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    const textarea = textareaRef.current
    const current = getDraft(draftKey).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = voice.status === 'recording'

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (useChatStore.getState().importingHistory || voice.status !== 'idle') {
      return
    }
    const currentEdit = useUserEdit.getState().active
    if (currentEdit && sessionId !== null && currentEdit.sessionId === sessionId) {
      const currentDraft = getDraft(draftKey)
      const tasks = useUploads.getState().tasks
      const addedFiles = []
      const blobsToSave = []
      for (const attachment of currentDraft.attachments) {
        const task = tasks[attachment.id]
        if (task?.status !== 'done' || !task.serverId) {
          return
        }
        addedFiles.push({
          id: attachment.id,
          serverId: task.serverId,
          name: attachment.file.name,
          size: attachment.file.size,
          isImage: attachment.isImage,
          mimeType: resolveMimeType(attachment.file),
        })
        blobsToSave.push({ id: attachment.id, blob: attachment.file })
      }
      const nextFiles = [...currentEdit.files, ...addedFiles]
      const nextText = currentDraft.text.trim()
      if ((!nextText && nextFiles.length === 0) || !ensureApiKey()) {
        return
      }
      if (blobsToSave.length > 0) {
        void saveFiles(blobsToSave).catch(() => undefined)
      }
      if (!editMessage(sessionId, currentEdit.messageId, nextText, nextFiles)) {
        return
      }
      clearSentDraft(draftKey)
      cancelUserEdit()
      stopReadAloud()
      setAttachMenuOpen(false)
      textareaRef.current?.blur()
      return
    }

    if (!prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    setAttachMenuOpen(false)
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  const hasNativeGallery = Boolean(getAndroidHost())
  const attachActions = [
    {
      key: 'camera',
      icon: <IconCameraOutline20 />,
      label: t('attachCamera'),
      onClick: () => openPicker('camera', cameraInputRef.current),
    },
    {
      key: 'gallery',
      icon: <IconImageOutline20 />,
      label: t('attachAlbum'),
      onClick: () => openPicker('gallery', albumInputRef.current),
    },
    {
      key: 'file',
      icon: <IconFolderOutline20 />,
      label: t('attachFile'),
      onClick: () => openPicker('file', fileInputRef.current),
    },
  ]

  return (
    <div className={styles.root}>
      <div
        className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            textareaRef.current?.focus({ preventScroll: true })
          }
        }}
      >
        {activeEdit ? (
          <div className={styles.editBanner}>
            <span className={styles.editBannerTitle}>{t('editInputTitle')}</span>
            <button
              type="button"
              className={styles.editBannerClose}
              aria-label={t('close')}
              onClick={cancelUserEdit}
            >
              <IconCloseOutline16 />
            </button>
          </div>
        ) : null}
        <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
        <div className={styles.textareaWrapper}>
          <textarea
            ref={textareaRef}
            className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
            placeholder={t('chatInputPlaceholderChat')}
            rows={isMobile ? 1 : 2}
            // 移动端不自动聚焦，避免一打开就弹出键盘
            autoFocus={!isMobile}
            disabled={importingHistory}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => {
              if (isMobile) {
                setAttachMenuOpen(false)
              }
            }}
            onMouseDown={(event) => {
              // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
              if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
                event.preventDefault()
                event.currentTarget.focus({ preventScroll: true })
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send()
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files)
              if (files.length > 0) {
                event.preventDefault()
                acceptFiles(files)
              }
            }}
          />
          {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
          <div className={styles.mirror} aria-hidden>
            {isMobile ? (text.endsWith('\n') ? `${text} ` : text || ' ') : `${text}\n`}
          </div>
        </div>
        <div className={styles.functionRow}>
          {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
          <div ref={togglesRef} className={styles.toggles}>
            <Tooltip content={t('deactivatedThinkTooltip')}>
              <button
                type="button"
                className={clsx(styles.toggle, thinking && styles.selected)}
                aria-label={t('thinkingSwitch')}
                aria-pressed={thinking}
                onClick={() => setThinking(!thinking)}
              >
                <IconThinkOutline14 active={thinking} />
                <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
              </button>
            </Tooltip>
            <Tooltip content={t('deactivatedSearchTooltip')}>
              <button
                type="button"
                className={clsx(styles.toggle, search && styles.selected)}
                aria-label={t('search')}
                aria-pressed={search}
                onClick={() => setSearch(!search)}
              >
                <IconGlobeLanguageOutline14 active={search} />
                <span className={styles.toggleLabel}>{t('search')}</span>
              </button>
            </Tooltip>
          </div>
          <div className={styles.right}>
            {isMobile ? (
              <button
                type="button"
                className={styles.plusButton}
                aria-label={attachMenuOpen ? t('collapseAttachments') : t('expandAttachments')}
                aria-expanded={attachMenuOpen}
                disabled={importingHistory}
                onClick={toggleAttachMenu}
              >
                <IconPlusCircleOutline24 open={attachMenuOpen} />
              </button>
            ) : (
              <IconButton
                size="m"
                tone="primary"
                icon={<IconPaperclipOutline16 />}
                tooltip={t('uploadFile')}
                disabled={importingHistory}
                onClick={() => ensureApiKey() && fileInputRef.current?.click()}
              />
            )}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={handleFilesSelected}
            />
            <input
              ref={albumInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={handleFilesSelected}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept={ACCEPT}
              onChange={handleFilesSelected}
            />
            {streaming && sessionId ? (
              <button
                type="button"
                className={styles.sendButton}
                aria-label={t('chatInputStopButtonTooltip')}
                onClick={() => {
                  stopReadAloud()
                  stopReply(sessionId)
                }}
              >
                <IconStopFill16 />
              </button>
            ) : voice.status === 'idle' && canSend ? (
              <button
                type="button"
                className={styles.sendButton}
                aria-label={t('send')}
                onClick={send}
              >
                <IconSendOutline16 />
              </button>
            ) : (
              <VoiceButton
                status={voice.status}
                disabled={!voice.available}
                seconds={voice.seconds}
                onClick={() => {
                  if (
                    voice.status !== 'idle' ||
                    (!useChatStore.getState().importingHistory && ensureApiKey())
                  ) {
                    setAttachMenuOpen(false)
                    void voice.toggle()
                  }
                }}
              />
            )}
          </div>
        </div>
        {dragging ? <DragMask /> : null}
      </div>
      {isMobile ? (
        <div
          className={clsx(styles.attachPanel, attachMenuOpen && styles.attachPanelOpen)}
          data-open={attachMenuOpen ? 'true' : undefined}
          aria-hidden={!attachMenuOpen}
        >
          <div className={styles.attachPanelClip}>
            <div className={styles.attachPanelInner}>
              {hasNativeGallery ? (
                !galleryGranted ? (
                  <div className={styles.permissionBanner}>
                    <span className={styles.permissionText}>{t('recentPhotosGrant')}</span>
                    <button
                      type="button"
                      className={styles.permissionButton}
                      onClick={() => getAndroidHost()?.requestGalleryPermission?.()}
                    >
                      {t('grantAccess')}
                    </button>
                  </div>
                ) : recentPhotos.length > 0 ? (
                  <div className={styles.recentSection}>
                    <div className={styles.recentTitle}>{t('recentPhotosTitle')}</div>
                    <div className={styles.recentPhotosBar}>
                      {recentPhotos.map((photo) => {
                        const mappedId = mediaAttachmentMap[photo.id]
                        const selected = Boolean(
                          mappedId && attachments.some((item) => item.id === mappedId)
                        )
                        const loading = pendingPhotoId === photo.id
                        return (
                          <button
                            key={photo.id}
                            type="button"
                            className={clsx(
                              styles.recentPhoto,
                              selected && styles.recentPhotoSelected
                            )}
                            aria-pressed={selected}
                            aria-label={photo.name}
                            disabled={loading}
                            onClick={() => void toggleRecentPhoto(photo)}
                          >
                            <img src={photo.thumb || photo.url} alt={photo.name} loading="lazy" />
                            <span
                              className={clsx(
                                styles.recentPhotoCheck,
                                selected && styles.recentPhotoCheckActive
                              )}
                            >
                              {selected ? <IconCheckOutline16 /> : null}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null
              ) : null}
              <div className={styles.attachGrid}>
                {attachActions.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={styles.attachCard}
                    disabled={importingHistory}
                    onClick={item.onClick}
                  >
                    <span className={styles.attachCardIcon}>{item.icon}</span>
                    <span className={styles.attachCardLabel}>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
