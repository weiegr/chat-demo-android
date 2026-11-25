import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import {
  addCustomChatBackground,
  initChatBackgrounds,
  removeCustomChatBackground,
  selectChatBackground,
  useChatBackground,
  type ChatBackgroundItem,
} from '../../services/chatBackground.js'
import { IconCheckOutline16, IconChevronRightOutline14, IconTrashOutline16 } from '../base/icons.js'
import { Menu } from '../base/Menu.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import { setChatParallaxEnabled, useSettings } from '../../services/settings.js'
import settingsStyles from './Settings.module.css'
import styles from './ChatBackgroundSettings.module.css'

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

/** 「应用背景」子页面：包含「聊天背景」入口 */
export const AppBackgroundPage = ({
  onOpenChatBackground,
}: {
  onOpenChatBackground: () => void
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <div className={clsx(settingsStyles.content, settingsStyles.mobileLocationContent)}>
        <div className={settingsStyles.mobileCard}>
          <button
            type="button"
            className={settingsStyles.mobileNavRow}
            onClick={onOpenChatBackground}
          >
            <span className={settingsStyles.label}>{t('settingsChatBackground')}</span>
            <span className={settingsStyles.mobileNavRight}>
              <IconChevronRightOutline14 />
            </span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={settingsStyles.desktopSubScroll}>
      <button type="button" className={styles.desktopEntryRow} onClick={onOpenChatBackground}>
        <span className={settingsStyles.label}>{t('settingsChatBackground')}</span>
        <span className={styles.desktopEntryArrow} aria-hidden="true">
          <IconChevronRightOutline14 />
        </span>
      </button>
    </div>
  )
}

/** 自定义背景缩略图：点击选中，长按（或右键）弹出删除菜单 */
const CustomBackgroundTile = ({
  item,
  index,
  selected,
  menuActive,
  onSelect,
  onOpenMenu,
}: {
  item: ChatBackgroundItem
  index: number
  selected: boolean
  menuActive: boolean
  onSelect: (id: string) => void
  onOpenMenu: (id: string, anchor: HTMLElement) => void
}) => {
  const t = useTranslate()
  const tileRef = useRef<HTMLButtonElement>(null)
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

  return (
    <button
      ref={tileRef}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={t('settingsChatBackgroundCustomItem', { index: index + 1 })}
      className={clsx(
        styles.tile,
        selected && styles.tileSelected,
        (pressing || menuActive) && styles.tilePressing
      )}
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
          if (tileRef.current) {
            onOpenMenu(item.id, tileRef.current)
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
        if (tileRef.current) {
          onOpenMenu(item.id, tileRef.current)
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
      <img src={item.thumbUrl} alt="" draggable={false} className={styles.thumbImage} />
      {selected ? (
        <span className={styles.checkBadge} aria-hidden="true">
          <IconCheckOutline16 />
        </span>
      ) : null}
    </button>
  )
}

/** 「聊天背景」设置页：顶部「从相册选择」，下方依次为「默认背景」与「自定义背景」 */
export const ChatBackgroundPage = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const selectedId = useChatBackground((state) => state.selectedId)
  const customs = useChatBackground((state) => state.customs)
  const chatParallaxEnabled = useSettings((state) => state.chatParallaxEnabled)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuAnchorRef = useRef<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [menuTargetId, setMenuTargetId] = useState<string | null>(null)

  useEffect(() => {
    void initChatBackgrounds()
  }, [])

  const handleFileChange = async (file: File | undefined) => {
    if (!file || busy) {
      return
    }
    setBusy(true)
    try {
      await addCustomChatBackground(file)
      showToast({ key: 'settingsChatBackgroundUpdated' }, { placement: 'center' })
    } catch {
      showToast({ key: 'settingsChatBackgroundSaveFailed', type: 'error' }, { placement: 'center' })
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await removeCustomChatBackground(id)
      showToast({ key: 'settingsChatBackgroundDeleted' }, { placement: 'center' })
    } catch {
      showToast(
        { key: 'settingsChatBackgroundDeleteFailed', type: 'error' },
        { placement: 'center' }
      )
    }
  }

  const handleOpenMenu = (id: string, anchor: HTMLElement) => {
    menuAnchorRef.current = anchor
    setMenuTargetId(id)
  }

  const body = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void handleFileChange(file)
        }}
      />

      {isMobile ? (
        <div className={styles.mobileSwitchGroup}>
          <div className={settingsStyles.mobileCard}>
            <button
              type="button"
              className={settingsStyles.mobileNavRow}
              disabled={busy}
              onClick={() => triggerGalleryInput(inputRef.current)}
            >
              <span className={settingsStyles.label}>{t('settingsChatBackgroundChooseAlbum')}</span>
              <span className={settingsStyles.mobileNavRight}>
                <IconChevronRightOutline14 />
              </span>
            </button>
            <div className={styles.mobileSwitchRow}>
              <span className={settingsStyles.label}>{t('settingsChatBackgroundParallax')}</span>
              <Switch
                checked={chatParallaxEnabled}
                ariaLabel={t('settingsChatBackgroundParallax')}
                onChange={setChatParallaxEnabled}
              />
            </div>
          </div>
          <p className={settingsStyles.mobileCardHint}>{t('settingsChatBackgroundParallaxDesc')}</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            className={styles.desktopEntryRow}
            disabled={busy}
            onClick={() => triggerGalleryInput(inputRef.current)}
          >
            <span className={settingsStyles.label}>{t('settingsChatBackgroundChooseAlbum')}</span>
            <span className={styles.desktopEntryArrow} aria-hidden="true">
              <IconChevronRightOutline14 />
            </span>
          </button>
          <div className={styles.desktopSwitchRow}>
            <span className={settingsStyles.label}>{t('settingsChatBackgroundParallax')}</span>
            <Switch
              checked={chatParallaxEnabled}
              ariaLabel={t('settingsChatBackgroundParallax')}
              onChange={setChatParallaxEnabled}
            />
          </div>
          <p className={styles.desktopSwitchHint}>{t('settingsChatBackgroundParallaxDesc')}</p>
        </>
      )}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('settingsChatBackgroundDefault')}</div>
        <div
          role="radiogroup"
          aria-label={t('settingsChatBackgroundDefault')}
          className={styles.grid}
        >
          <button
            type="button"
            role="radio"
            aria-checked={selectedId === null}
            aria-label={t('settingsChatBackgroundDefault')}
            className={clsx(
              styles.tile,
              styles.defaultTile,
              selectedId === null && styles.tileSelected
            )}
            onClick={() => selectChatBackground(null)}
          >
            <span className={styles.defaultPreview} aria-hidden="true">
              <span className={styles.previewUserBubble} />
              <span className={styles.previewAssistantLine} />
              <span className={styles.previewAssistantLineShort} />
              <span className={styles.previewInputBar} />
            </span>
            {selectedId === null ? (
              <span className={styles.checkBadge} aria-hidden="true">
                <IconCheckOutline16 />
              </span>
            ) : null}
          </button>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('settingsChatBackgroundCustom')}</div>
        {customs.length > 0 ? (
          <div
            role="radiogroup"
            aria-label={t('settingsChatBackgroundCustom')}
            className={styles.grid}
          >
            {customs.map((item, index) => (
              <CustomBackgroundTile
                key={item.id}
                item={item}
                index={index}
                selected={selectedId === item.id}
                menuActive={menuTargetId === item.id}
                onSelect={(id) => selectChatBackground(id)}
                onOpenMenu={handleOpenMenu}
              />
            ))}
          </div>
        ) : (
          <div className={styles.emptyHint}>{t('settingsChatBackgroundCustomEmpty')}</div>
        )}
      </div>

      <Menu
        open={menuTargetId !== null}
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
          menuTargetId !== null
            ? [
                {
                  key: 'delete',
                  label: t('delete'),
                  icon: <IconTrashOutline16 />,
                  danger: true,
                  onSelect: () => {
                    const id = menuTargetId
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
