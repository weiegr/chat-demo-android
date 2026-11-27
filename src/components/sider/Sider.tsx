import clsx from 'clsx'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconPanelLeftOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { getAccountDisplayLabel, useMockAccount } from '../../services/account.js'
import { setSiderCollapsed, useSettings } from '../../services/settings.js'
import { loadSession } from '../../services/chat/db.js'
import { isMemorySession } from '../../services/chat/memoryModel.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { usePresence } from '../base/usePresence.js'
import { openChatSearch, useChatSearch } from '../search/chatSearchState.js'
import { AccountAvatar } from '../settings/AccountAvatar.js'
import { openSettings } from '../settings/settingsDialogState.js'
import {
  applySiderDrawerProgress,
  bindSiderDrawerMotion,
  cancelClearSiderMainInline,
  clearSiderMainInline,
  closeMobileSider,
  dismissKeyboard,
  getSiderMain,
  isKeyboardOpen,
  openMobileSider,
  scheduleClearSiderMainInline,
  useMobileSider,
} from './mobileSiderState.js'
import { SessionList } from './SessionList.js'
import { RpContextRing } from '../session/RpContextRing.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = memo(function Sider({
  mobile = false,
  showRpContext = false,
}: {
  mobile?: boolean
  showRpContext?: boolean
}) {
  const t = useTranslate()
  const personalCenterEnabled = useSettings((state) => state.personalCenterEnabled)
  const showPersonalCenter = __BETA__ && personalCenterEnabled
  const account = useMockAccount()
  const accountLabel = getAccountDisplayLabel(account)
  const floatingAvatarOnly = showPersonalCenter && !accountLabel
  const chatSearchOpen = useChatSearch((state) => mobile && state.open)
  const chatSearchPresenting = useChatSearch((state) => mobile && state.presenting)
  const chatSearchClosingToSession = useChatSearch((state) => mobile && state.closingToSession)
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const lastDeletingRef = useRef<SessionSummary | null>(null)
  if (deleting) {
    lastDeletingRef.current = deleting
  }
  const deleteTarget = deleting ?? lastDeletingRef.current
  const cachedDeleteTarget = useChatStore((state) =>
    deleteTarget && Object.hasOwn(state.sessionCache, deleteTarget.id)
      ? state.sessionCache[deleteTarget.id]
      : undefined
  )
  const deletePresence = usePresence(deleting !== null, 220)
  const requestDelete = useCallback((session: SessionSummary) => {
    if (
      !__BETA__ ||
      session.mode !== undefined ||
      Object.hasOwn(useChatStore.getState().sessionCache, session.id)
    ) {
      setDeleting(session)
      return
    }
    void loadSession(session.id)
      .then((loaded) =>
        setDeleting(
          loaded
            ? { ...session, mode: loaded.mode, origin: loaded.origin ?? session.origin }
            : session
        )
      )
      .catch(() => setDeleting(session))
  }, [])
  const resolvedDeleteTarget = cachedDeleteTarget ?? deleteTarget
  const showDeleteMemoryHint = Boolean(
    __BETA__ && resolvedDeleteTarget && isMemorySession(resolvedDeleteTarget)
  )

  return (
    <div
      className={clsx(
        styles.sider,
        mobile && styles.mobile,
        floatingAvatarOnly && styles.siderAvatarOnly,
        mobile && (chatSearchOpen || chatSearchClosingToSession) && styles.searchOpen,
        mobile && chatSearchPresenting && styles.searchPresenting
      )}
    >
      <div className={styles.top}>
        <button
          type="button"
          className={styles.searchEntry}
          data-mobile-search-entry={mobile ? 'true' : undefined}
          aria-label={t('searchChats')}
          onClick={openChatSearch}
        >
          <span className={styles.searchEntryIcon} aria-hidden="true">
            <IconSearchOutline16 />
          </span>
          <span className={styles.searchEntryLabel}>
            {mobile ? t('searchChatsPlaceholder') : t('searchChats')}
          </span>
          {mobile ? null : (
            <span className={styles.searchEntryHint} aria-hidden="true">
              Ctrl+K
            </span>
          )}
        </button>
        {/* 移动端由对话界面顶栏的菜单按钮负责收起，抽屉里不再重复放一个 */}
        {mobile ? null : (
          <IconButton
            size="m"
            icon={<IconPanelLeftOutline16 />}
            tooltip={t('collapseSiderbarButton')}
            tooltipPlacement="bottom"
            onClick={() => setSiderCollapsed(true)}
          />
        )}
      </div>
      {mobile ? null : (
        <div className={styles.newChatRow}>
          <button
            type="button"
            className={styles.newChat}
            onClick={() => {
              newChat()
              closeMobileSider()
            }}
          >
            <span className={styles.newChatIcon}>
              <NewChatIcon />
            </span>
            {t('newChat')}
            <span className={styles.newChatHint} aria-hidden="true">
              Ctrl+J
            </span>
          </button>
          {showRpContext ? <RpContextRing /> : null}
        </div>
      )}
      <SessionList mobile={mobile} floatingBottom={floatingAvatarOnly} onDelete={requestDelete} />
      <div className={clsx(styles.bottom, floatingAvatarOnly && styles.bottomFloating)}>
        {showPersonalCenter ? (
          <button
            type="button"
            className={clsx(
              styles.settings,
              styles.accountEntry,
              floatingAvatarOnly && styles.accountEntryAvatarOnly
            )}
            aria-label={t('settings')}
            onClick={() => openSettings(mobile ? 'general' : 'data')}
          >
            <AccountAvatar
              src={account.avatarDataUrl}
              className={styles.accountAvatar}
              iconClassName={styles.accountAvatarIcon}
            />
            {accountLabel ? <span className={styles.accountLabel}>{accountLabel}</span> : null}
          </button>
        ) : (
          <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
            <span className={styles.settingsIcon}>
              <IconSettingsOutline16 />
            </span>
            <span className={styles.settingsLabel}>{t('settings')}</span>
          </button>
        )}
      </div>
      {deletePresence.mounted && lastDeletingRef.current ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          visible={deletePresence.visible}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                autoFocus={!mobile}
                disabled={deletePending}
                onClick={() => setDeleting(null)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending || !deleting}
                onClick={async () => {
                  if (!deleting || deletePending) {
                    return
                  }
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t(
            showDeleteMemoryHint
              ? 'deleteSessionWithMemoryDescription'
              : 'deleteSessionWithFilesDescription'
          )}
        </Modal>
      ) : null}
    </div>
  )
})

const canScrollHorizontally = (target: EventTarget | null, dx: number) => {
  for (
    let el = target instanceof Element ? target : null;
    el && el !== document.body;
    el = el.parentElement
  ) {
    const style = getComputedStyle(el)
    if (/auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      if (dx > 0 && el.scrollLeft > 0) {
        return true
      }
      if (dx < 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) {
        return true
      }
    }
  }
  return false
}

/**
 * 移动端推开式抽屉：从屏幕左侧滑入，紧贴着把对话界面整体往右推，
 * 两者 1:1 同步位移，支持按键与左右滑动手势跟手开合。
 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  const chatSearchOpen = useChatSearch((state) => state.open)
  const drawerRef = useRef<HTMLDivElement>(null)
  const drawerMotionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bindSiderDrawerMotion(drawerMotionRef.current)
    return () => {
      clearSiderMainInline()
      bindSiderDrawerMotion(null)
    }
  }, [])

  // 抽屉常驻在对话界面下方，关闭或进入全屏搜索态时用 inert 移出焦点与读屏范围
  useEffect(() => {
    if (drawerRef.current) {
      drawerRef.current.inert = !open || chatSearchOpen
    }
  }, [open, chatSearchOpen])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        closeMobileSider()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    let startX = 0
    let startY = 0
    let startTime = 0
    let drawerWidth = 0
    let wasOpen = false
    let didDismissKeyboard = false
    let mode: 'idle' | 'pending' | 'dragging' | 'ignored' = 'idle'
    let lastDx = 0

    const onTouchStart = (event: TouchEvent) => {
      if (
        event.touches.length !== 1 ||
        (event.target instanceof Element && event.target.closest('[data-sider-swipe-ignore]')) ||
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
        document.querySelector('[role="menu"]') ||
        document.querySelector('aside[class*="panel"]')
      ) {
        mode = 'ignored'
        return
      }
      const touch = event.touches[0]
      if (!touch) {
        mode = 'ignored'
        return
      }
      startX = touch.clientX
      startY = touch.clientY
      startTime = Date.now()
      wasOpen = useMobileSider.getState().open
      didDismissKeyboard = false
      drawerWidth = drawerRef.current?.offsetWidth || Math.min(window.innerWidth * 0.8, 320)
      lastDx = 0
      mode = 'pending'
    }

    const onTouchMove = (event: TouchEvent) => {
      if (mode === 'idle' || mode === 'ignored' || event.touches.length !== 1) {
        return
      }
      const touch = event.touches[0]
      if (!touch) {
        return
      }
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (mode === 'pending') {
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
          mode = 'ignored'
          return
        }
        if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.2) {
          return
        }
        if ((!wasOpen && dx <= 0) || (wasOpen && dx >= 0)) {
          mode = 'ignored'
          return
        }
        if (canScrollHorizontally(event.target, dx)) {
          mode = 'ignored'
          return
        }
        if (!wasOpen && !didDismissKeyboard && isKeyboardOpen()) {
          didDismissKeyboard = true
          dismissKeyboard()
        }
        mode = 'dragging'
      }

      if (mode === 'dragging') {
        cancelClearSiderMainInline()
        lastDx = dx
        const width = Math.max(1, drawerWidth)
        const offset = wasOpen
          ? Math.max(0, Math.min(width, width + dx))
          : Math.max(0, Math.min(width, dx))
        const main = getSiderMain()
        const drawerMotion = drawerMotionRef.current
        // 侧边栏从左侧滑入，右边缘紧贴对话界面左边缘，同步将其往右推
        if (main) {
          main.dataset.siderDragging = 'true'
          main.style.transition = 'none'
          main.style.transform = `translate3d(${offset.toFixed(2)}px, 0, 0)`
          main.style.setProperty('--sider-shadow-opacity', (offset / width).toFixed(3))
        }
        if (drawerMotion) {
          drawerMotion.dataset.siderDragging = 'true'
          drawerMotion.style.transition = 'none'
          applySiderDrawerProgress(drawerMotion, offset, width)
        }
      }
    }

    const onTouchEnd = () => {
      if (mode !== 'dragging') {
        mode = 'idle'
        return
      }
      mode = 'idle'
      const elapsed = Math.max(1, Date.now() - startTime)
      const vx = lastDx / elapsed
      const shouldOpen = !wasOpen
        ? lastDx > drawerWidth * 0.25 || (vx > 0.35 && lastDx > 24)
        : !(lastDx < -drawerWidth * 0.2 || (vx < -0.35 && lastDx < -24))
      const main = getSiderMain()
      const drawerMotion = drawerMotionRef.current
      if (main) {
        delete main.dataset.siderDragging
        main.style.removeProperty('transition')
        main.style.transform = `translate3d(${shouldOpen ? drawerWidth : 0}px, 0, 0)`
        main.style.setProperty('--sider-shadow-opacity', shouldOpen ? '1' : '0')
      }
      if (drawerMotion) {
        delete drawerMotion.dataset.siderDragging
        drawerMotion.style.removeProperty('transition')
        applySiderDrawerProgress(drawerMotion, shouldOpen ? drawerWidth : 0, drawerWidth)
      }
      scheduleClearSiderMainInline(350)
      if (shouldOpen) {
        openMobileSider()
      } else {
        closeMobileSider()
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  return (
    <div
      ref={drawerRef}
      data-mobile-sider-drawer="true"
      data-open={open ? 'true' : undefined}
      className={styles.drawer}
    >
      <div ref={drawerMotionRef} className={styles.drawerMotion}>
        <Sider mobile />
      </div>
    </div>
  )
}
