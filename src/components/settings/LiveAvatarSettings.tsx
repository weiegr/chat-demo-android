import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  LIVE_AVATAR_STATES,
  MAX_LIVE_AVATAR_NAME_LENGTH,
  addCustomLiveAvatarSet,
  initLiveAvatars,
  removeCustomLiveAvatarSet,
  selectLiveAvatar,
  updateCustomLiveAvatarSet,
  useLiveAvatar,
  type LiveAvatarSet,
  type LiveAvatarState,
} from '../../services/liveAvatar.js'
import { Button } from '../base/Button.js'
import {
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconCloseFill14,
  IconEditOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { Menu } from '../base/Menu.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { usePresence } from '../base/usePresence.js'
import settingsStyles from './Settings.module.css'
import styles from './LiveAvatarSettings.module.css'

const LONG_PRESS_MS = 420
const LONG_PRESS_MOVE_LIMIT = 8

interface AndroidPickerBridge {
  setNextPickerMode?: (mode: 'camera' | 'gallery' | 'file' | 'video') => void
}

const triggerGalleryInput = (input: HTMLInputElement | null) => {
  if (!input) {
    return
  }
  const host = (window as Window & { AndroidHost?: AndroidPickerBridge }).AndroidHost
  host?.setNextPickerMode?.('gallery')
  input.value = ''
  input.click()
}

const STATE_LABEL_KEY: Record<LiveAvatarState, TranslationKey> = {
  idle: 'settingsLiveAvatarStateIdle',
  listening: 'settingsLiveAvatarStateListening',
  speaking: 'settingsLiveAvatarStateSpeaking',
  thinking: 'settingsLiveAvatarStateThinking',
}

type DraftFiles = Partial<Record<LiveAvatarState, File>>
type DraftPreviewUrls = Partial<Record<LiveAvatarState, string>>
type RemovedStates = Partial<Record<LiveAvatarState, boolean>>

type EditorSession = { mode: 'create' } | { mode: 'edit'; item: LiveAvatarSet; index: number }

const resolveGroupDisplayName = (
  item: LiveAvatarSet,
  index: number,
  t: ReturnType<typeof useTranslate>
) => item.name?.trim() || t('settingsLiveAvatarCustomGroup', { index: index + 1 })

/** 自定义形象分组行：点击切换启用，长按（或右键）弹出编辑/删除菜单，右侧以蓝色对勾标示选中态 */
const CustomAvatarGroupRow = ({
  item,
  index,
  selected,
  menuActive,
  onSelect,
  onOpenMenu,
}: {
  item: LiveAvatarSet
  index: number
  selected: boolean
  menuActive: boolean
  onSelect: (id: string) => void
  onOpenMenu: (id: string, anchor: HTMLElement) => void
}) => {
  const t = useTranslate()
  const rowRef = useRef<HTMLButtonElement>(null)
  const [pressing, setPressing] = useState(false)
  const longPressTimerRef = useRef(0)
  const longPressResetTimerRef = useRef(0)
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const longPressTriggeredRef = useRef(false)

  const cancelLongPress = () => {
    window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = 0
    longPressOriginRef.current = null
    setPressing(false)
  }

  useEffect(
    () => () => {
      window.clearTimeout(longPressTimerRef.current)
      window.clearTimeout(longPressResetTimerRef.current)
    },
    []
  )

  const groupTitle = resolveGroupDisplayName(item, index, t)

  return (
    <button
      ref={rowRef}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={groupTitle}
      className={clsx(styles.groupRow, (pressing || menuActive) && styles.groupRowPressing)}
      onTouchStart={(event) => {
        if (event.touches.length !== 1) {
          cancelLongPress()
          return
        }
        const touch = event.touches[0]
        if (!touch) {
          return
        }
        window.clearTimeout(longPressResetTimerRef.current)
        longPressTriggeredRef.current = false
        longPressOriginRef.current = { x: touch.clientX, y: touch.clientY }
        setPressing(true)
        window.clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = window.setTimeout(() => {
          longPressTimerRef.current = 0
          longPressTriggeredRef.current = true
          setPressing(false)
          if (rowRef.current) {
            onOpenMenu(item.id, rowRef.current)
          }
        }, LONG_PRESS_MS)
      }}
      onTouchMove={(event) => {
        const origin = longPressOriginRef.current
        const touch = event.touches[0]
        if (!origin || !touch) {
          return
        }
        if (
          Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > LONG_PRESS_MOVE_LIMIT
        ) {
          cancelLongPress()
        }
      }}
      onTouchEnd={(event) => {
        cancelLongPress()
        if (longPressTriggeredRef.current) {
          if (event.cancelable) {
            event.preventDefault()
          }
          window.clearTimeout(longPressResetTimerRef.current)
          longPressResetTimerRef.current = window.setTimeout(() => {
            longPressTriggeredRef.current = false
            longPressResetTimerRef.current = 0
          }, 350)
        }
      }}
      onTouchCancel={cancelLongPress}
      onContextMenu={(event) => {
        event.preventDefault()
        if (rowRef.current) {
          onOpenMenu(item.id, rowRef.current)
        }
      }}
      onClick={() => {
        if (longPressTriggeredRef.current) {
          window.clearTimeout(longPressResetTimerRef.current)
          longPressResetTimerRef.current = 0
          longPressTriggeredRef.current = false
          return
        }
        onSelect(item.id)
      }}
    >
      <span className={styles.groupRowTitle}>{groupTitle}</span>
      {selected ? (
        <span className={styles.groupCheckIcon} aria-hidden="true">
          <IconCheckOutline16 />
        </span>
      ) : null}
    </button>
  )
}

/** 创建/编辑自定义 Live 形象组弹窗：分组名称输入框 + 模仿设置页的四态滑动预览 + 单个「上传」窗口 */
const LiveAvatarEditorModal = ({
  session,
  onClose,
}: {
  session: EditorSession | null
  onClose: () => void
}) => {
  const t = useTranslate()
  const presence = usePresence(session !== null, 220)
  const lastSessionRef = useRef<EditorSession | null>(null)
  if (session) {
    lastSessionRef.current = session
  }
  const activeSession = session ?? lastSessionRef.current

  const [groupName, setGroupName] = useState('')
  const [draftFiles, setDraftFiles] = useState<DraftFiles>({})
  const [draftUrls, setDraftUrls] = useState<DraftPreviewUrls>({})
  const [removedStates, setRemovedStates] = useState<RemovedStates>({})
  const [activeSlide, setActiveSlide] = useState(0)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef(0)
  const autoAdvanceTimerRef = useRef(0)
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null)
  const pickingStateRef = useRef<LiveAvatarState | null>(null)
  const draftUrlsRef = useRef<DraftPreviewUrls>({})
  draftUrlsRef.current = draftUrls

  const clearDrafts = useCallback(() => {
    window.clearTimeout(autoAdvanceTimerRef.current)
    autoAdvanceTimerRef.current = 0
    for (const url of Object.values(draftUrlsRef.current)) {
      if (url) {
        URL.revokeObjectURL(url)
      }
    }
    draftUrlsRef.current = {}
    setDraftFiles({})
    setDraftUrls({})
    setRemovedStates({})
  }, [])

  const scrollToSlide = useCallback((index: number, instant = false) => {
    setActiveSlide(index)
    const track = trackRef.current
    if (!track || track.clientWidth <= 0) {
      return
    }
    const reduced =
      instant ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    track.scrollTo({
      left: index * track.clientWidth,
      behavior: reduced ? 'auto' : 'smooth',
    })
  }, [])

  const sessionKey = session ? (session.mode === 'edit' ? `edit:${session.item.id}` : 'create') : ''
  const initialEditName = session?.mode === 'edit' ? (session.item.name ?? '') : ''

  useEffect(() => {
    if (!sessionKey) {
      return
    }
    clearDrafts()
    setGroupName(initialEditName)
    setSaving(false)
    scrollToSlide(0, true)
  }, [clearDrafts, initialEditName, scrollToSlide, sessionKey])

  useEffect(() => {
    if (!presence.mounted) {
      clearDrafts()
    }
  }, [clearDrafts, presence.mounted])

  useEffect(
    () => () => {
      cancelAnimationFrame(scrollRafRef.current)
      window.clearTimeout(autoAdvanceTimerRef.current)
      for (const url of Object.values(draftUrlsRef.current)) {
        if (url) {
          URL.revokeObjectURL(url)
        }
      }
    },
    []
  )

  if (!presence.mounted || !activeSession) {
    return null
  }

  const baseImages = activeSession.mode === 'edit' ? activeSession.item.images : null
  const resolveUrl = (state: LiveAvatarState): string | null => {
    if (draftUrls[state]) {
      return draftUrls[state] ?? null
    }
    if (removedStates[state]) {
      return null
    }
    return baseImages?.[state] ?? null
  }

  const currentState: LiveAvatarState = LIVE_AVATAR_STATES[activeSlide] ?? 'idle'
  const filledCount = LIVE_AVATAR_STATES.filter((state) => Boolean(resolveUrl(state))).length
  const changedImagesCount = LIVE_AVATAR_STATES.filter((state) => Boolean(draftFiles[state])).length
  const nameChanged =
    activeSession.mode === 'edit' && groupName.trim() !== (activeSession.item.name?.trim() ?? '')
  const canSave =
    !saving &&
    filledCount === LIVE_AVATAR_STATES.length &&
    (activeSession.mode === 'create' || changedImagesCount > 0 || nameChanged)

  const handleTrackScroll = () => {
    if (scrollRafRef.current) {
      return
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      const track = trackRef.current
      if (!track || track.clientWidth <= 0) {
        return
      }
      const next = Math.max(
        0,
        Math.min(LIVE_AVATAR_STATES.length - 1, Math.round(track.scrollLeft / track.clientWidth))
      )
      setActiveSlide(next)
    })
  }

  const handlePickState = (state: LiveAvatarState) => {
    if (saving) {
      return
    }
    pickingStateRef.current = state
    triggerGalleryInput(fileInputRef.current)
  }

  const handleRemoveState = (state: LiveAvatarState) => {
    if (saving) {
      return
    }
    window.clearTimeout(autoAdvanceTimerRef.current)
    autoAdvanceTimerRef.current = 0
    setDraftFiles((prev) => (prev[state] ? { ...prev, [state]: undefined } : prev))
    setDraftUrls((prev) => {
      const oldUrl = prev[state]
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl)
      }
      return prev[state] ? { ...prev, [state]: undefined } : prev
    })
    if (baseImages?.[state]) {
      setRemovedStates((prev) => ({ ...prev, [state]: true }))
    }
  }

  const handleFileChange = (file: File | undefined) => {
    const targetState = pickingStateRef.current
    pickingStateRef.current = null
    if (!file || !targetState) {
      return
    }
    const nextUrl = URL.createObjectURL(file)
    setDraftFiles((prev) => ({ ...prev, [targetState]: file }))
    setDraftUrls((prev) => {
      const oldUrl = prev[targetState]
      if (oldUrl) {
        URL.revokeObjectURL(oldUrl)
      }
      return { ...prev, [targetState]: nextUrl }
    })
    setRemovedStates((prev) => (prev[targetState] ? { ...prev, [targetState]: undefined } : prev))

    // 上传完成后自动切换到下一个尚未上传的状态
    const targetIndex = LIVE_AVATAR_STATES.indexOf(targetState)
    const isStateFilledAfter = (state: LiveAvatarState) => {
      if (state === targetState) {
        return true
      }
      if (draftUrlsRef.current[state]) {
        return true
      }
      if (removedStates[state]) {
        return false
      }
      return Boolean(baseImages?.[state])
    }
    let nextEmptyIndex = -1
    for (let offset = 1; offset < LIVE_AVATAR_STATES.length; offset += 1) {
      const candidateIndex = (targetIndex + offset) % LIVE_AVATAR_STATES.length
      const candidateState = LIVE_AVATAR_STATES[candidateIndex]
      if (candidateState && !isStateFilledAfter(candidateState)) {
        nextEmptyIndex = candidateIndex
        break
      }
    }
    if (nextEmptyIndex >= 0) {
      window.clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = 0
        scrollToSlide(nextEmptyIndex)
      }, 220)
    }
  }

  const handleSave = async () => {
    if (!canSave || !session) {
      return
    }
    setSaving(true)
    try {
      if (session.mode === 'create') {
        const { idle, listening, speaking, thinking } = draftFiles
        if (!idle || !listening || !speaking || !thinking) {
          return
        }
        await addCustomLiveAvatarSet({ idle, listening, speaking, thinking }, groupName)
        showToast({ key: 'settingsLiveAvatarCreated' }, { placement: 'center' })
      } else {
        await updateCustomLiveAvatarSet(session.item.id, draftFiles, groupName)
        showToast({ key: 'settingsLiveAvatarUpdated' }, { placement: 'center' })
      }
      onClose()
    } catch {
      showToast({ key: 'settingsLiveAvatarSaveFailed', type: 'error' }, { placement: 'center' })
    } finally {
      setSaving(false)
    }
  }

  const modalTitle =
    activeSession.mode === 'edit'
      ? t('settingsLiveAvatarEditTitle', { index: activeSession.index + 1 })
      : t('settingsLiveAvatarCreateTitle')

  return (
    <Modal
      title={modalTitle}
      visible={presence.visible}
      closable={!saving}
      className={styles.editorModal}
      headerClassName={styles.editorHeader}
      closeClassName={styles.editorClose}
      mainClassName={styles.editorMain}
      footerClassName={styles.editorFooter}
      onClose={() => {
        if (!saving) {
          onClose()
        }
      }}
      footer={
        <>
          <Button
            variant="outlined"
            size="l"
            className={styles.editorFooterButton}
            disabled={saving}
            onClick={onClose}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            size="l"
            className={styles.editorFooterButton}
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {t(saving ? 'settingsLiveAvatarSaving' : 'settingsLiveAvatarSave')}
          </Button>
        </>
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          handleFileChange(file)
        }}
      />

      {/* 分组名称输入框 */}
      <input
        type="text"
        className={styles.groupNameInput}
        value={groupName}
        maxLength={MAX_LIVE_AVATAR_NAME_LENGTH}
        placeholder={t('settingsLiveAvatarGroupNamePlaceholder')}
        aria-label={t('settingsLiveAvatarGroupNamePlaceholder')}
        disabled={saving}
        onChange={(event) => setGroupName(event.target.value)}
      />

      {/* 四态滑动预览圆球：轻点圆球直接上传/替换，已上传图片右上角带附件同款删除叉号 */}
      <div className={styles.editorShowcase} data-sider-swipe-ignore="true">
        <div
          ref={trackRef}
          className={styles.defaultCarousel}
          aria-label={t('settingsLiveAvatarPreviewLabel')}
          onScroll={handleTrackScroll}
        >
          {LIVE_AVATAR_STATES.map((state) => {
            const url = resolveUrl(state)
            return (
              <div key={state} className={styles.editorSlide}>
                <div className={styles.editorOrbWrap}>
                  <button
                    type="button"
                    className={clsx(styles.editorOrbCircle, url && styles.editorOrbCircleFilled)}
                    aria-label={`${t(STATE_LABEL_KEY[state])} - ${t('settingsLiveAvatarUpload')}`}
                    disabled={saving}
                    onPointerDown={(event) => {
                      pointerOriginRef.current = { x: event.clientX, y: event.clientY }
                    }}
                    onPointerCancel={() => {
                      pointerOriginRef.current = null
                    }}
                    onClick={(event) => {
                      const origin = pointerOriginRef.current
                      pointerOriginRef.current = null
                      if (
                        origin &&
                        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >= 8
                      ) {
                        return
                      }
                      handlePickState(state)
                    }}
                  >
                    {url ? (
                      <img src={url} alt="" draggable={false} className={styles.previewOrbImage} />
                    ) : (
                      <span className={styles.editorOrbText}>{t('settingsLiveAvatarUpload')}</span>
                    )}
                  </button>
                  {url ? (
                    <button
                      type="button"
                      className={styles.uploadRemoveButton}
                      aria-label={t('removeAttachment')}
                      disabled={saving}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleRemoveState(state)
                      }}
                    >
                      <IconCloseFill14 />
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        <div className={styles.editorStatusLabel} aria-live="polite">
          {t(STATE_LABEL_KEY[currentState])}
        </div>

        <div
          className={styles.editorDots}
          role="tablist"
          aria-label={t('settingsLiveAvatarPreviewLabel')}
        >
          {LIVE_AVATAR_STATES.map((state, index) => (
            <button
              key={state}
              type="button"
              role="tab"
              aria-selected={activeSlide === index}
              aria-label={t(STATE_LABEL_KEY[state])}
              className={clsx(styles.defaultDot, activeSlide === index && styles.defaultDotActive)}
              onClick={() => scrollToSlide(index)}
            />
          ))}
        </div>
      </div>
    </Modal>
  )
}

type DefaultPreviewSlide = 'idle' | 'thinking' | 'speaking'

const DEFAULT_PREVIEW_SLIDES: readonly {
  key: DefaultPreviewSlide
  labelKey: TranslationKey
}[] = [
  { key: 'idle', labelKey: 'settingsLiveAvatarStateIdle' },
  { key: 'thinking', labelKey: 'settingsLiveAvatarStateThinking' },
  { key: 'speaking', labelKey: 'settingsLiveAvatarStateSpeaking' },
]

/** 默认形象无卡片滑动预览：直接呈现通话模式中央圆球，依次滑动预览「待机 / 思考 / 说话」，下方仅显示当前状态文字与三个点 */
const DefaultAvatarShowcase = ({
  selected,
  onSelect,
}: {
  selected: boolean
  onSelect: () => void
}) => {
  const t = useTranslate()
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef(0)
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null)
  const [activeSlide, setActiveSlide] = useState(0)

  useEffect(
    () => () => {
      cancelAnimationFrame(scrollRafRef.current)
    },
    []
  )

  const handleTrackScroll = () => {
    if (scrollRafRef.current) {
      return
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      const track = trackRef.current
      if (!track || track.clientWidth <= 0) {
        return
      }
      const next = Math.max(
        0,
        Math.min(
          DEFAULT_PREVIEW_SLIDES.length - 1,
          Math.round(track.scrollLeft / track.clientWidth)
        )
      )
      setActiveSlide(next)
    })
  }

  const scrollToSlide = (index: number) => {
    const track = trackRef.current
    setActiveSlide(index)
    if (!track || track.clientWidth <= 0) {
      return
    }
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    track.scrollTo({
      left: index * track.clientWidth,
      behavior: reduced ? 'auto' : 'smooth',
    })
  }

  const currentSlide = DEFAULT_PREVIEW_SLIDES[activeSlide] ?? DEFAULT_PREVIEW_SLIDES[0]

  return (
    <div className={styles.defaultShowcase} data-sider-swipe-ignore="true">
      <div
        ref={trackRef}
        className={styles.defaultCarousel}
        aria-label={t('settingsLiveAvatarPreviewLabel')}
        onScroll={handleTrackScroll}
        onPointerDown={(event) => {
          pointerOriginRef.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={(event) => {
          const origin = pointerOriginRef.current
          pointerOriginRef.current = null
          if (!origin) {
            return
          }
          if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 8 && !selected) {
            onSelect()
          }
        }}
        onPointerCancel={() => {
          pointerOriginRef.current = null
        }}
      >
        {/* 1. 待机：通话模式原版中央蓝色圆球 */}
        <div className={styles.defaultSlide}>
          <span className={styles.liveOrbBox} aria-hidden="true">
            <span className={styles.liveOrb} />
          </span>
        </div>

        {/* 2. 思考：通话模式原版旋转加载环 */}
        <div className={styles.defaultSlide}>
          <span className={styles.liveOrbBox} aria-hidden="true">
            <span className={styles.liveLoadingRing} />
          </span>
        </div>

        {/* 3. 说话：通话模式原版 5 根胶囊声波柱 */}
        <div className={styles.defaultSlide}>
          <span className={styles.liveOrbBox} aria-hidden="true">
            <span className={styles.liveWave}>
              <span className={styles.liveWaveBar} />
              <span className={styles.liveWaveBar} />
              <span className={styles.liveWaveBar} />
              <span className={styles.liveWaveBar} />
              <span className={styles.liveWaveBar} />
            </span>
          </span>
        </div>
      </div>

      <div className={styles.defaultStatusLabel} aria-live="polite">
        {currentSlide ? t(currentSlide.labelKey) : ''}
      </div>

      <div
        className={styles.defaultDots}
        role="tablist"
        aria-label={t('settingsLiveAvatarPreviewLabel')}
      >
        {DEFAULT_PREVIEW_SLIDES.map((slide, index) => (
          <button
            key={slide.key}
            type="button"
            role="tab"
            aria-selected={activeSlide === index}
            aria-label={t(slide.labelKey)}
            className={clsx(styles.defaultDot, activeSlide === index && styles.defaultDotActive)}
            onClick={() => scrollToSlide(index)}
          />
        ))}
      </div>
    </div>
  )
}

/** 自定义形象滑动预览：与默认形象保持一致的圆形滑动舞台 + 状态文字 + 四圆点 */
const CustomAvatarShowcase = ({ item }: { item: LiveAvatarSet }) => {
  const t = useTranslate()
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef(0)
  const [activeSlide, setActiveSlide] = useState(0)

  useEffect(
    () => () => {
      cancelAnimationFrame(scrollRafRef.current)
    },
    []
  )

  const handleTrackScroll = () => {
    if (scrollRafRef.current) {
      return
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      const track = trackRef.current
      if (!track || track.clientWidth <= 0) {
        return
      }
      const next = Math.max(
        0,
        Math.min(LIVE_AVATAR_STATES.length - 1, Math.round(track.scrollLeft / track.clientWidth))
      )
      setActiveSlide(next)
    })
  }

  const scrollToSlide = (index: number) => {
    const track = trackRef.current
    setActiveSlide(index)
    if (!track || track.clientWidth <= 0) {
      return
    }
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    track.scrollTo({
      left: index * track.clientWidth,
      behavior: reduced ? 'auto' : 'smooth',
    })
  }

  const currentState: LiveAvatarState = LIVE_AVATAR_STATES[activeSlide] ?? 'idle'

  return (
    <div className={styles.defaultShowcase} data-sider-swipe-ignore="true">
      <div
        ref={trackRef}
        className={styles.defaultCarousel}
        aria-label={t('settingsLiveAvatarPreviewLabel')}
        onScroll={handleTrackScroll}
      >
        {LIVE_AVATAR_STATES.map((state) => (
          <div key={state} className={styles.defaultSlide}>
            <span className={styles.customOrbCircle} aria-hidden="true">
              <img
                src={item.images[state]}
                alt=""
                draggable={false}
                className={styles.previewOrbImage}
              />
            </span>
          </div>
        ))}
      </div>

      <div className={styles.defaultStatusLabel} aria-live="polite">
        {t(STATE_LABEL_KEY[currentState])}
      </div>

      <div
        className={styles.defaultDots}
        role="tablist"
        aria-label={t('settingsLiveAvatarPreviewLabel')}
      >
        {LIVE_AVATAR_STATES.map((state, index) => (
          <button
            key={state}
            type="button"
            role="tab"
            aria-selected={activeSlide === index}
            aria-label={t(STATE_LABEL_KEY[state])}
            className={clsx(styles.defaultDot, activeSlide === index && styles.defaultDotActive)}
            onClick={() => scrollToSlide(index)}
          />
        ))}
      </div>
    </div>
  )
}

/** 「Live形象」设置页：顶部「从相册选择并创建」，下方依次为「默认形象」与「自定义形象」 */
export const LiveAvatarPage = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const selectedId = useLiveAvatar((state) => state.selectedId)
  const customs = useLiveAvatar((state) => state.customs)
  const menuAnchorRef = useRef<HTMLElement | null>(null)
  const [menuTargetId, setMenuTargetId] = useState<string | null>(null)
  const [editorSession, setEditorSession] = useState<EditorSession | null>(null)

  useEffect(() => {
    void initLiveAvatars()
  }, [])

  const handleDelete = async (id: string) => {
    try {
      await removeCustomLiveAvatarSet(id)
      showToast({ key: 'settingsLiveAvatarDeleted' }, { placement: 'center' })
    } catch {
      showToast({ key: 'settingsLiveAvatarDeleteFailed', type: 'error' }, { placement: 'center' })
    }
  }

  const handleOpenMenu = (id: string, anchor: HTMLElement) => {
    menuAnchorRef.current = anchor
    setMenuTargetId(id)
  }

  const menuTargetIndex =
    menuTargetId !== null ? customs.findIndex((item) => item.id === menuTargetId) : -1
  const menuTargetItem = menuTargetIndex >= 0 ? customs[menuTargetIndex] : null
  const previewCustomItem =
    (selectedId !== null ? customs.find((item) => item.id === selectedId) : undefined) ??
    customs[0] ??
    null

  const body = (
    <>
      {isMobile ? (
        <div className={settingsStyles.mobileCard}>
          <button
            type="button"
            className={settingsStyles.mobileNavRow}
            onClick={() => setEditorSession({ mode: 'create' })}
          >
            <span className={settingsStyles.label}>{t('settingsLiveAvatarChooseAndCreate')}</span>
            <span className={settingsStyles.mobileNavRight}>
              <IconChevronRightOutline14 />
            </span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.desktopEntryRow}
          onClick={() => setEditorSession({ mode: 'create' })}
        >
          <span className={settingsStyles.label}>{t('settingsLiveAvatarChooseAndCreate')}</span>
          <span className={styles.desktopEntryArrow} aria-hidden="true">
            <IconChevronRightOutline14 />
          </span>
        </button>
      )}

      <div className={styles.section}>
        <button
          type="button"
          role="radio"
          aria-checked={selectedId === null}
          aria-label={t('settingsLiveAvatarDefault')}
          className={clsx(
            styles.defaultHeaderButton,
            selectedId === null && styles.defaultHeaderButtonActive
          )}
          onClick={() => selectLiveAvatar(null)}
        >
          <span className={styles.sectionTitle}>{t('settingsLiveAvatarDefault')}</span>
          {selectedId === null ? (
            <span className={styles.groupCheckIcon} aria-hidden="true">
              <IconCheckOutline16 />
            </span>
          ) : null}
        </button>
        <DefaultAvatarShowcase
          selected={selectedId === null}
          onSelect={() => selectLiveAvatar(null)}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('settingsLiveAvatarCustom')}</div>
        {previewCustomItem ? (
          <>
            <CustomAvatarShowcase item={previewCustomItem} />
            <div
              role="radiogroup"
              aria-label={t('settingsLiveAvatarCustom')}
              className={isMobile ? settingsStyles.mobileCard : styles.desktopGroupList}
            >
              {customs.map((item, index) => (
                <CustomAvatarGroupRow
                  key={item.id}
                  item={item}
                  index={index}
                  selected={selectedId === item.id}
                  menuActive={menuTargetId === item.id}
                  onSelect={(id) => selectLiveAvatar(id)}
                  onOpenMenu={handleOpenMenu}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      <Menu
        open={menuTargetItem !== null}
        anchorRef={menuAnchorRef}
        align="center"
        alignOffset={0}
        offset={6}
        variant="context"
        withBackdrop
        zIndex={1100}
        captureEscape
        onOpenChange={(next) => {
          if (!next) {
            setMenuTargetId(null)
          }
        }}
        options={
          menuTargetItem
            ? [
                {
                  key: 'edit',
                  label: t('settingsLiveAvatarEdit'),
                  icon: <IconEditOutline16 />,
                  onSelect: () => {
                    const target = menuTargetItem
                    const targetIndex = menuTargetIndex
                    setMenuTargetId(null)
                    setEditorSession({ mode: 'edit', item: target, index: targetIndex })
                  },
                },
                {
                  key: 'delete',
                  label: t('delete'),
                  icon: <IconTrashOutline16 />,
                  danger: true,
                  onSelect: () => {
                    const id = menuTargetItem.id
                    setMenuTargetId(null)
                    void handleDelete(id)
                  },
                },
              ]
            : []
        }
      >
        {() => null}
      </Menu>

      <LiveAvatarEditorModal session={editorSession} onClose={() => setEditorSession(null)} />
    </>
  )

  if (isMobile) {
    return (
      <div className={clsx(settingsStyles.content, settingsStyles.mobileLocationContent)}>
        {body}
      </div>
    )
  }

  return <div className={clsx(settingsStyles.desktopSubScroll, styles.desktopPage)}>{body}</div>
}
