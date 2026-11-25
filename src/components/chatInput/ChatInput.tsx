import clsx from 'clsx'
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type MutableRefObject,
  type Ref,
} from 'react'
import {
  IconCameraOutline20,
  IconCheckOutline16,
  IconCloseOutline16,
  IconFolderOutline20,
  IconImageOutline20,
  IconPaperclipOutline16,
  IconPhoneOutline20,
  IconPlusCircleOutline24,
  IconSendOutline16,
  IconStopFill16,
  IconVideoOutline20,
} from '../base/icons.js'
import {
  canTranscribeVideo,
  canUploadVideo,
  resolveModeModel,
  useSettings,
} from '../../services/settings.js'
import { computeImeShift, subscribeImeMotion } from '../../app/imeMotion.js'
import { useIsMobile } from '../../app/viewport.js'
import { editMessage, sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  addDraftFilesWithIds,
  EMPTY_DRAFT,
  ensureDraftUploads,
  getDraft,
  getEditDraftKey,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
  type DraftVideoTranscript,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { dismissKeyboard } from '../sider/mobileSiderState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { AUDIO_ACCEPT, canAttachAudio, MAX_AUDIO_SECONDS } from '../../services/audio/format.js'
import {
  cancelUserEdit,
  removeUserEditExistingFile,
  useUserEdit,
  type ActiveUserEdit,
} from '../messages/userEditState.js'
import { ChatModeToggles } from './ChatModeToggles.js'
import { ChatTextarea } from './ChatTextarea.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useAudioInput } from './useAudioInput.js'
import { useVoiceInput } from './useVoiceInput.js'
import { useVideoInput } from './useVideoInput.js'
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

type PickerMode = 'camera' | 'gallery' | 'file' | 'video'

interface AndroidMediaBridge {
  setNextPickerMode?: (mode: PickerMode) => void
  hasGalleryPermission?: () => boolean
  requestGalleryPermission?: () => void
  requestRecentPhotos?: (limit: number) => void
  getKeyboardHeightCss?: () => number
}

const getAndroidHost = (): AndroidMediaBridge | undefined =>
  (window as Window & { AndroidHost?: AndroidMediaBridge }).AndroidHost

const RECENT_PHOTOS_LIMIT = 10

/** 输入框：自适应高度的文本框 + 文件 + 深度思考与智能搜索开关 + 语音输入 + 发送 / 停止 */
type ChatInputProps = {
  sessionId: string | null
  onStartCall?: (sessionId: string | null) => void
  cameraShortcutRef?: Ref<() => void>
  controlsParallaxRef?: MutableRefObject<HTMLDivElement | null>
  onParallaxPauseChange?: (paused: boolean) => void
}

export const ChatInput = memo(function ChatInput({
  sessionId,
  onStartCall,
  cameraShortcutRef,
  controlsParallaxRef,
  onParallaxPauseChange,
}: ChatInputProps) {
  const activeEdit = useUserEdit((state) =>
    sessionId !== null && state.active?.sessionId === sessionId ? state.active : null
  )
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  const key = activeEdit
    ? getEditDraftKey(activeEdit.sessionId, activeEdit.messageId)
    : sessionId === null
      ? 'new'
      : `session:${sessionId}`
  return (
    <Input
      key={key}
      sessionId={sessionId}
      activeEdit={activeEdit}
      onStartCall={onStartCall}
      cameraShortcutRef={cameraShortcutRef}
      controlsParallaxRef={controlsParallaxRef}
      onParallaxPauseChange={onParallaxPauseChange}
    />
  )
})

const Input = ({
  sessionId,
  onStartCall,
  cameraShortcutRef,
  controlsParallaxRef,
  onParallaxPauseChange,
  activeEdit,
}: ChatInputProps & { activeEdit: ActiveUserEdit | null }) => {
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
  const videoAllowed = useSettings((settings) => canUploadVideo(activeMode, settings))
  const videoAudioEnabled = useSettings((settings) => canTranscribeVideo(activeMode, settings))
  const video = useVideoInput(draftKey, sessionId)
  const audioAllowed = canAttachAudio(activeMode)
  const audio = useAudioInput(draftKey, sessionId)
  const audioBlocked =
    !audioAllowed &&
    (attachments.some((file) => file.audio) || activeEdit?.files.some((file) => file.audio))
  const audioInputFailure =
    audio.failure && attachments.some((item) => item.id === audio.failure?.id)
      ? audio.failure
      : null
  const videoBlocked = !videoAllowed && Boolean(draft.video)
  const videoAudioFailed =
    videoAudioEnabled && draft.video && video.audioFailureId === draft.video.id
  const draftOptions = { useOcrModel, videoAllowed, audioAllowed, existingFiles: activeEdit?.files }

  useEffect(() => {
    if (!useOcrModel && attachments.length > 0) {
      ensureDraftUploads(draftKey, useSettings.getState().apiKey ?? '', false)
    }
  }, [useOcrModel, attachments.length, draftKey])

  const draftReady = useUploads(
    (state) => prepareDraftMessage(draft, state.tasks, draftOptions) !== null
  )
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const albumInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachPanelRef = useRef<HTMLDivElement>(null)
  const attachDismissCleanupRef = useRef<(() => void) | null>(null)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [attachDismissMode, setAttachDismissMode] = useState<'idle' | 'to-ime'>('idle')
  const [inputFocused, setInputFocused] = useState(false)
  const [desktopAttachMenuOpen, setDesktopAttachMenuOpen] = useState(false)
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
    const knownShiftCss = computeImeShift(knownImeCss)
    const expectedRaise =
      knownShiftCss > panelHeight
        ? knownShiftCss
        : Math.max(panelHeight + 48, Math.round(startHeight * 0.36))
    let ratio = Math.min(0.95, panelHeight / expectedRaise)

    if (hasNativeHost) {
      panel.style.height = `${panelHeight.toFixed(2)}px`
    } else {
      panel.style.setProperty('--attach-start-h', `${panelHeight}px`)
      panel.style.setProperty('--attach-start-vh', `${startHeight}px`)
      panel.style.setProperty('--attach-ime-ratio', ratio.toFixed(4))
    }
    setAttachDismissMode('to-ime')
    setAttachMenuOpen(false)

    let finished = false
    let fallingBack = false
    let noImeTimer = 0
    let settleTimer = 0
    let collapseTimer = 0
    let unsubscribeIme: (() => void) | null = null

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
      unsubscribeIme?.()
      unsubscribeIme = null
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

    const onViewportChange = () => {
      const raised = startHeight - getCurrentHeight()
      if (raised > 4) {
        window.clearTimeout(noImeTimer)
        window.clearTimeout(settleTimer)
        settleTimer = window.setTimeout(() => collapseRemaining(100), 180)
      }
    }

    if (hasNativeHost) {
      let seenNativeShift = false
      unsubscribeIme = subscribeImeMotion((phase, ime) => {
        if (finished || fallingBack) {
          return
        }
        if (phase === 'start' && ime.opening) {
          window.clearTimeout(noImeTimer)
          const targetShift = computeImeShift(ime.targetRaise)
          if (!seenNativeShift && targetShift > panelHeight) {
            ratio = Math.min(0.98, panelHeight / targetShift)
          }
          window.clearTimeout(settleTimer)
          settleTimer = window.setTimeout(() => collapseRemaining(100), ime.durationMs + 160)
          return
        }
        if (phase === 'progress') {
          if (ime.shift > 1) {
            seenNativeShift = true
            window.clearTimeout(noImeTimer)
          }
          const nextH = Math.max(0, panelHeight - ime.shift * ratio)
          panel.style.height = `${nextH.toFixed(2)}px`
          return
        }
        if (phase === 'end') {
          const nextH = Math.max(0, panelHeight - ime.shift * ratio)
          panel.style.height = `${nextH.toFixed(2)}px`
          if (nextH <= 2) {
            finish()
          } else {
            collapseRemaining(100)
          }
        }
      })
    } else {
      window.visualViewport?.addEventListener('resize', onViewportChange)
      window.addEventListener('resize', onViewportChange)
    }

    // 若长时间无软键盘弹起（如外接硬件键盘或桌面模拟器），温和收拢占位高度
    noImeTimer = window.setTimeout(
      () => {
        if (!finished && !fallingBack) {
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

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(
      draftKey,
      files,
      useSettings.getState().apiKey ?? '',
      useOcrModel,
      audioAllowed
    )
    if (error) {
      showToast(error)
    }
  }
  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
    closeAttachMenu()
  }
  const openPicker = (mode: PickerMode, input: HTMLInputElement | null) => {
    if (!input || (mode === 'video' && !video.canSelect())) {
      return
    }
    if (useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    if (mode === 'camera') {
      dismissKeyboard()
    }
    if (mode !== 'video' || !video.preparePicker()) {
      getAndroidHost()?.setNextPickerMode?.(mode)
    }
    input.click()
    closeAttachMenu()
  }
  const openCamera = () => openPicker('camera', cameraInputRef.current)
  useImperativeHandle(cameraShortcutRef, () => () => {
    if (activeMode === 'fast') {
      openCamera()
    }
  })

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
        retryDraftAttachment(draftKey, id, useSettings.getState().apiKey ?? '', videoAllowed)
      }
    },
    [draftKey, videoAllowed]
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
  const processingAudio =
    audio.status !== null || (video.status !== null && video.status.phase !== 'frames')

  const parallaxPaused =
    inputFocused ||
    attachMenuOpen ||
    attachDismissMode !== 'idle' ||
    desktopAttachMenuOpen ||
    voice.status !== 'idle'

  useEffect(() => {
    onParallaxPauseChange?.(parallaxPaused)
  }, [onParallaxPauseChange, parallaxPaused])

  useEffect(() => () => onParallaxPauseChange?.(false), [onParallaxPauseChange])

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend =
    !importingHistory &&
    !streaming &&
    voice.status === 'idle' &&
    audio.status === null &&
    video.status === null &&
    draftReady

  const submitDraft = (transcript?: DraftVideoTranscript) => {
    const edit = useUserEdit.getState().active
    const currentEdit = edit?.sessionId === sessionId ? edit : null
    if (currentEdit !== activeEdit || !ensureApiKey()) {
      return false
    }
    if (currentEdit) {
      if (
        !editMessage(currentEdit.sessionId, currentEdit.messageId, currentEdit.files, transcript)
      ) {
        return false
      }
      cancelUserEdit()
    } else if (!sendMessage(sessionId, transcript)) {
      return false
    }
    stopReadAloud()
    closeAttachMenu()
    if (isMobile || currentEdit) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
    return true
  }

  const sendWithMedia = async (skipVideoDialogue = false) => {
    if (
      useChatStore.getState().importingHistory ||
      (sessionId !== null && Boolean(useChatStore.getState().streaming[sessionId])) ||
      voice.status !== 'idle' ||
      audio.isProcessing() ||
      video.isProcessing()
    ) {
      return
    }
    if (!prepareDraftMessage(getDraft(draftKey), useUploads.getState().tasks, draftOptions)) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (ensureApiKey() && (await audio.prepare())) {
      await video.send(submitDraft, skipVideoDialogue)
    }
  }
  const send = () => void sendWithMedia()

  const hasNativeGallery = Boolean(getAndroidHost())
  const fileAction = {
    key: 'file',
    icon: <IconFolderOutline20 />,
    label: t('attachFile'),
    onClick: () => openPicker('file', fileInputRef.current),
  }
  const videoAction = videoAllowed
    ? {
        key: 'video',
        icon: <IconVideoOutline20 />,
        label: t('attachVideo'),
        onClick: () => openPicker('video', videoInputRef.current),
      }
    : null
  const callAction =
    activeMode === 'fast' && activeEdit === null && onStartCall
      ? {
          key: 'call',
          icon: <IconPhoneOutline20 />,
          label: t('liveCall'),
          onClick: () => {
            setAttachMenuOpen(false)
            dismissKeyboard()
            onStartCall(sessionId)
          },
        }
      : null
  const cameraAction = {
    key: 'camera',
    icon: <IconCameraOutline20 />,
    label: t('attachCamera'),
    onClick: openCamera,
  }
  const attachActions = [
    activeEdit ? cameraAction : (videoAction ?? cameraAction),
    {
      key: 'gallery',
      icon: <IconImageOutline20 />,
      label: t('attachAlbum'),
      onClick: () => openPicker('gallery', albumInputRef.current),
    },
    fileAction,
    ...(activeEdit && videoAction ? [videoAction] : []),
    ...(callAction ? [callAction] : []),
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
          sessionId={sessionId}
          existingFiles={activeEdit?.files}
          existingVideo={activeEdit?.video}
          video={draft.video}
          useOcrModel={useOcrModel}
          videoAllowed={videoAllowed}
          onRetry={retryFile}
          onRemove={removeFile}
          onRemoveExisting={removeUserEditExistingFile}
        />
        {audio.status ? (
          <div className={styles.videoStatus}>
            <span role="status">
              {audio.status.phase === 'analyzing'
                ? t('audioAnalyzing', { name: audio.status.name })
                : t('audioTranscribing', {
                    name: audio.status.name,
                    current: audio.status.completed + 1,
                    count: audio.status.total,
                  })}
            </span>
            <button type="button" className={styles.videoAction} onClick={audio.cancel}>
              {t('cancel')}
            </button>
          </div>
        ) : audioInputFailure ? (
          <div className={styles.videoStatus} role="status">
            {t(audioInputFailure.code, {
              name: audioInputFailure.name,
              seconds: MAX_AUDIO_SECONDS,
            })}
          </div>
        ) : null}
        {audioBlocked ? <div className={styles.videoStatus}>{t('audioEnableToSend')}</div> : null}
        {video.status ? (
          <div className={styles.videoStatus}>
            <span role="status">
              {video.status.phase === 'frames'
                ? t('videoProcessing', { progress: video.status.progress })
                : t(
                    video.status.phase === 'extracting'
                      ? 'videoAudioExtracting'
                      : 'videoAudioTranscribing'
                  )}
            </span>
            <button type="button" className={styles.videoAction} onClick={video.cancel}>
              {t('cancel')}
            </button>
          </div>
        ) : videoAudioFailed ? (
          <div className={styles.videoStatus}>
            <span role="status">{t('videoAudioFailed')}</span>
            <div className={styles.videoActions}>
              <button
                type="button"
                className={styles.videoAction}
                disabled={!canSend}
                onClick={send}
              >
                {t('videoAudioRetry')}
              </button>
              <button
                type="button"
                className={styles.videoAction}
                disabled={!canSend}
                onClick={() => void sendWithMedia(true)}
              >
                {t('videoAudioSendVisuals')}
              </button>
            </div>
          </div>
        ) : null}
        {videoBlocked ? <div className={styles.videoStatus}>{t('videoEnableToSend')}</div> : null}
        <ChatTextarea
          inputRef={textareaRef}
          value={text}
          autoFocus={!isMobile}
          disabled={importingHistory}
          onTextChange={setText}
          onSend={send}
          onFocus={() => {
            setInputFocused(true)
            if (isMobile && attachMenuOpen) {
              dismissAttachToKeyboard()
            }
          }}
          onBlur={() => setInputFocused(false)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
            }
          }}
        >
          {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
        </ChatTextarea>
        <div ref={controlsParallaxRef} className={styles.functionRow}>
          <ChatModeToggles mode={activeMode} />
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
            ) : callAction || videoAction ? (
              <Menu
                align="end"
                onOpenChange={setDesktopAttachMenuOpen}
                options={[fileAction, videoAction, callAction]
                  .filter((item) => item !== null)
                  .map(({ onClick, ...item }) => ({ ...item, onSelect: onClick }))}
              >
                {({ open, toggle }) => (
                  <IconButton
                    size="m"
                    tone="primary"
                    icon={<IconPaperclipOutline16 />}
                    tooltip={t('expandAttachments')}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    disabled={importingHistory}
                    onClick={toggle}
                  />
                )}
              </Menu>
            ) : (
              <IconButton
                size="m"
                tone="primary"
                icon={<IconPaperclipOutline16 />}
                tooltip={t('uploadFile')}
                disabled={importingHistory}
                onClick={fileAction.onClick}
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
            {videoAllowed ? (
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                hidden
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  void video.add(files)
                }}
              />
            ) : null}
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
              accept={audioAllowed ? `${ACCEPT},${AUDIO_ACCEPT}` : ACCEPT}
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
            ) : processingAudio ? null : (
              <VoiceButton
                status={voice.status}
                mobile={isMobile}
                disabled={!voice.available}
                seconds={voice.seconds}
                onClick={() => {
                  if (
                    voice.status !== 'idle' ||
                    (!useChatStore.getState().importingHistory &&
                      !audio.isProcessing() &&
                      !video.isProcessing() &&
                      ensureApiKey())
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
              <div
                className={clsx(
                  styles.attachGrid,
                  attachActions.length === 4 && styles.attachGridFourColumns
                )}
              >
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
