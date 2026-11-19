import clsx from 'clsx'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
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
import { resolveModeModel, setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { editMessage, sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  addDraftFilesWithIds,
  clearSentDraft,
  EMPTY_DRAFT,
  ensureDraftUploads,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  shouldSkipDraftUpload,
  useDrafts,
} from '../../services/chat/drafts.js'
import { canInlineTextAttachment } from '../../services/chat/inlineFiles.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { dismissKeyboard } from '../sider/mobileSiderState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, resolveMimeType, useUploads } from '../../services/attachments.js'
import {
  cancelUserEdit,
  getEditDraftKey,
  removeUserEditExistingFile,
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
  getKeyboardHeightCss?: () => number
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
  const globalMode = useSettings((state) => state.chatMode)
  const rpModel = useSettings((state) => state.rpModel)
  const sessionMode = useChatStore((state) =>
    sessionId !== null ? (state.sessionCache[sessionId]?.mode ?? 'fast') : null
  )
  const activeMode = sessionMode ?? globalMode
  const activeModel = resolveModeModel(activeMode, rpModel)
  const useOcrModel = activeModel === 'deepseek-v4-pro'
  const isRpMode = activeMode === 'rp'

  useEffect(() => {
    if (!useOcrModel && attachments.length > 0) {
      ensureDraftUploads(draftKey, useSettings.getState().apiKey ?? '', false)
    }
  }, [useOcrModel, attachments.length, draftKey])

  const draftReady = useUploads((state) => {
    if (!activeEdit) {
      return prepareDraftMessage(draft, state.tasks, useOcrModel) !== null
    }
    const allUploaded = draft.attachments.every((item) => {
      if (
        shouldSkipDraftUpload(
          { name: item.file.name, size: item.file.size, isImage: item.isImage },
          useOcrModel
        )
      ) {
        return true
      }
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
  const attachPanelRef = useRef<HTMLDivElement>(null)
  const attachDismissCleanupRef = useRef<(() => void) | null>(null)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [attachDismissMode, setAttachDismissMode] = useState<'idle' | 'to-ime'>('idle')
  const [galleryGranted, setGalleryGranted] = useState(
    () => getAndroidHost()?.hasGalleryPermission?.() ?? false
  )
  const [recentPhotos, setRecentPhotos] = useState<RecentPhotoItem[]>([])
  const [pendingPhotoId, setPendingPhotoId] = useState<string | null>(null)
  const [mediaAttachmentMap, setMediaAttachmentMap] = useState<Record<string, string>>({})

  const clearAttachToImeStyles = (panel: HTMLDivElement | null) => {
    if (!panel) {
      return
    }
    panel.style.removeProperty('--attach-start-h')
    panel.style.removeProperty('--attach-start-vh')
    panel.style.removeProperty('--attach-ime-ratio')
    panel.style.removeProperty('height')
    panel.style.removeProperty('transition')
  }

  const cancelAttachToIme = useCallback(() => {
    attachDismissCleanupRef.current?.()
    attachDismissCleanupRef.current = null
    clearAttachToImeStyles(attachPanelRef.current)
    setAttachDismissMode('idle')
  }, [])

  const closeAttachMenu = useCallback(() => {
    cancelAttachToIme()
    setAttachMenuOpen(false)
  }, [cancelAttachToIme])

  /**
   * 附件菜单打开时点击文本框切输入法：
   * 内层原地渐隐，外层高度直接由 CSS calc() 与 100dvh / --app-viewport-height 在同一 Layout Pass
   * 内按比例耦合收拢，彻底消除跨线程动画时差导致的先冲过头/先下坠整屏闪动。
   */
  const dismissAttachToKeyboard = useCallback(() => {
    cancelAttachToIme()
    const panel = attachPanelRef.current
    const panelHeight = panel?.getBoundingClientRect().height ?? 0
    if (!panel || panelHeight <= 0) {
      setAttachMenuOpen(false)
      return
    }
    const androidHost = getAndroidHost()
    const hasNativeHost = Boolean(androidHost)
    const getCurrentHeight = () =>
      hasNativeHost ? window.innerHeight : (window.visualViewport?.height ?? window.innerHeight)
    const startHeight = getCurrentHeight()
    const knownImeCss = androidHost?.getKeyboardHeightCss?.() ?? 0
    const expectedRaise =
      knownImeCss > panelHeight
        ? knownImeCss
        : Math.max(panelHeight + 48, Math.round(startHeight * 0.36))
    const initialRatio = Math.min(0.95, panelHeight / expectedRaise)

    panel.style.setProperty('--attach-start-h', `${panelHeight}px`)
    panel.style.setProperty('--attach-start-vh', `${startHeight}px`)
    panel.style.setProperty('--attach-ime-ratio', initialRatio.toFixed(4))
    setAttachDismissMode('to-ime')
    setAttachMenuOpen(false)

    let finished = false
    let fallingBack = false
    let noImeTimer = 0
    let settleTimer = 0
    let collapseTimer = 0

    const finish = () => {
      if (finished) {
        return
      }
      finished = true
      cleanupAll()
      clearAttachToImeStyles(panel)
      // 交还 idle 时先钉住过渡：此刻面板高度已是 0，但 grid-template-rows 还是
      // minmax(0,1fr)，允许过渡的话 0fr 会以内容高度为起点补一段动画，
      // 面板先弹回满高再塌下去，把输入区顶起一次（观感上整屏闪一下）。
      // 过渡在下次展开时恢复。
      panel.style.transition = 'none'
      setAttachDismissMode('idle')
      attachDismissCleanupRef.current = null
    }

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === 'height') {
        finish()
      }
    }

    const cleanupListeners = () => {
      window.clearTimeout(noImeTimer)
      window.clearTimeout(settleTimer)
      window.removeEventListener('android-ime-start', onNativeImeStart)
      window.removeEventListener('android-ime-shown', onNativeImeShown)
      window.visualViewport?.removeEventListener('resize', onViewportChange)
      window.removeEventListener('resize', onViewportChange)
    }

    const cleanupAll = () => {
      cleanupListeners()
      window.clearTimeout(collapseTimer)
      panel.removeEventListener('transitionend', onTransitionEnd)
    }

    // 兜底收尾：当无软键盘弹起（如物理键盘）或键盘过矮留有残余高度时平滑收至 0
    const collapseRemaining = (durationMs: number) => {
      if (finished || fallingBack) {
        return
      }
      const remaining = panel.getBoundingClientRect().height
      if (remaining <= 2) {
        finish()
        return
      }
      fallingBack = true
      cleanupListeners()
      panel.style.height = `${remaining}px`
      void panel.getBoundingClientRect()
      panel.style.transition = `height ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`
      panel.style.height = '0px'
      panel.addEventListener('transitionend', onTransitionEnd)
      collapseTimer = window.setTimeout(finish, durationMs + 40)
    }

    const onNativeImeStart = (event: Event) => {
      window.clearTimeout(noImeTimer)
      const detail = (event as CustomEvent<{ durationMs?: number; targetRaiseCss?: number }>).detail
      const targetRaiseCss = detail?.targetRaiseCss ?? 0
      // 动画尚未开始首帧时用系统上报的精确目标键盘高度校准比例，使最后一帧恰好归零
      if (
        !fallingBack &&
        targetRaiseCss > panelHeight &&
        Math.abs(getCurrentHeight() - startHeight) <= 2
      ) {
        const exactRatio = Math.min(0.98, panelHeight / targetRaiseCss)
        panel.style.setProperty('--attach-ime-ratio', exactRatio.toFixed(4))
      }
      const durationMs =
        typeof detail?.durationMs === 'number' && detail.durationMs > 0 ? detail.durationMs : 260
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => collapseRemaining(100), durationMs + 160)
    }

    const onNativeImeShown = () => {
      collapseRemaining(100)
    }

    const onViewportChange = () => {
      const raised = startHeight - getCurrentHeight()
      if (raised > 4) {
        window.clearTimeout(noImeTimer)
        window.clearTimeout(settleTimer)
        settleTimer = window.setTimeout(() => collapseRemaining(100), 180)
      }
    }

    window.addEventListener('android-ime-start', onNativeImeStart, { once: true })
    window.addEventListener('android-ime-shown', onNativeImeShown, { once: true })
    window.visualViewport?.addEventListener('resize', onViewportChange)
    window.addEventListener('resize', onViewportChange)

    // 若长时间无软键盘弹起（如外接硬件键盘或桌面模拟器），温和收拢占位高度
    noImeTimer = window.setTimeout(
      () => {
        if (startHeight - getCurrentHeight() <= 4) {
          collapseRemaining(160)
        }
      },
      hasNativeHost ? 360 : 180
    )

    attachDismissCleanupRef.current = () => {
      finished = true
      cleanupAll()
    }
  }, [cancelAttachToIme])

  useEffect(() => () => cancelAttachToIme(), [cancelAttachToIme])

  const editingId = activeEdit?.messageId
  useEffect(() => {
    if (!editingId) {
      return
    }
    closeAttachMenu()
    const textarea = textareaRef.current
    if (textarea) {
      textarea.focus({ preventScroll: true })
      const len = textarea.value.length
      textarea.setSelectionRange(len, len)
    }
  }, [editingId, closeAttachMenu])

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
        closeAttachMenu()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMobile, attachMenuOpen, closeAttachMenu])

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
  }, [t, isRpMode])

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(draftKey, files, useSettings.getState().apiKey ?? '', useOcrModel)
    if (error) {
      showToast(error)
    }
  }
  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
    closeAttachMenu()
  }
  const openPicker = (mode: 'camera' | 'gallery' | 'file', input: HTMLInputElement | null) => {
    if (useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    getAndroidHost()?.setNextPickerMode?.(mode)
    input?.click()
    closeAttachMenu()
  }
  const toggleAttachMenu = () => {
    cancelAttachToIme()
    const next = !attachMenuOpen
    if (next) {
      // 恢复 finish() 钉住的过渡，让展开动画生效；此刻面板高度为 0，恢复不会补出多余动画
      attachPanelRef.current?.style.removeProperty('transition')
      dismissKeyboard()
      const host = getAndroidHost()
      const granted = host?.hasGalleryPermission?.() ?? false
      setGalleryGranted(granted)
      if (granted) {
        host?.requestRecentPhotos?.(RECENT_PHOTOS_LIMIT)
      }
    }
    setAttachMenuOpen(next)
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
        useSettings.getState().apiKey ?? '',
        useOcrModel
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
        const meta = {
          name: attachment.file.name,
          size: attachment.file.size,
          isImage: attachment.isImage,
        }
        const inlineText = canInlineTextAttachment(meta)
        const skipUpload = shouldSkipDraftUpload(meta, useOcrModel)
        const task = tasks[attachment.id]
        if (!skipUpload && (task?.status !== 'done' || !task.serverId)) {
          return
        }
        addedFiles.push({
          id: attachment.id,
          serverId: inlineText ? null : task?.status === 'done' ? task.serverId : null,
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
      if (!editMessage(sessionId, currentEdit.messageId, nextText, nextFiles, blobsToSave)) {
        return
      }
      clearSentDraft(draftKey)
      cancelUserEdit()
      stopReadAloud()
      closeAttachMenu()
      textareaRef.current?.blur()
      return
    }

    if (!prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks, useOcrModel)) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    closeAttachMenu()
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
    <div className={clsx(styles.root, activeEdit && styles.rootEditing)}>
      <div
        className={clsx(
          styles.wrapper,
          sessionId === null ? styles.home : styles.session,
          activeEdit && styles.editing
        )}
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
        <DraftAttachments
          items={attachments}
          existingFiles={activeEdit?.files}
          useOcrModel={useOcrModel}
          onRetry={retryFile}
          onRemove={removeFile}
          onRemoveExisting={removeUserEditExistingFile}
        />
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
              if (isMobile && attachMenuOpen) {
                dismissAttachToKeyboard()
              }
            }}
            onMouseDown={(event) => {
              // 仅在移动浏览器（如 Safari）首次点击时手动聚焦，避免整页滚动；
              // Android 原生 WebView 容器已裁剪溢流，保留原生轻触聚焦与光标落点。
              if (
                isMobile &&
                !getAndroidHost() &&
                event.button === 0 &&
                document.activeElement !== event.currentTarget
              ) {
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
                // 保持当前输入焦点不丢失，避免切换开关时系统收起输入法
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setThinking(!thinking)}
              >
                <IconThinkOutline14 active={thinking} />
                <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
              </button>
            </Tooltip>
            {/* v4-pro 不支持服务端搜索工具，专家模式开关走客户端旁路搜索 */}
            {isRpMode ? null : (
              <Tooltip
                content={t(useOcrModel ? 'bypassSearchTooltip' : 'deactivatedSearchTooltip')}
              >
                <button
                  type="button"
                  className={clsx(styles.toggle, search && styles.selected)}
                  aria-label={t(useOcrModel ? 'bypassSearch' : 'search')}
                  aria-pressed={search}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setSearch(!search)}
                >
                  <IconGlobeLanguageOutline14 active={search} />
                  <span className={styles.toggleLabel}>
                    {t(useOcrModel ? 'bypassSearch' : 'search')}
                  </span>
                </button>
              </Tooltip>
            )}
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
                    cancelAttachToIme()
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
          ref={attachPanelRef}
          className={clsx(
            styles.attachPanel,
            attachMenuOpen && styles.attachPanelOpen,
            attachDismissMode === 'to-ime' && styles.attachPanelToIme
          )}
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
