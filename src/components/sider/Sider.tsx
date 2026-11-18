import clsx from 'clsx'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconPanelLeftOutline16, IconSettingsOutline16, NewChatIcon } from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, openMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = memo(function Sider({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  /** 保持引用稳定，否则每个条目都会因为新闭包而重渲 */
  const requestDelete = useCallback((session: SessionSummary) => setDeleting(session), [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      {mobile ? null : (
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
      )}
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onDelete={requestDelete}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
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
          {t('deleteSessionWithFilesDescription')}
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

/** 移动端抽屉：浮在页面上方，支持点击遮罩、按键及左右滑动手势开合。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  const drawerRef = useRef<HTMLDivElement>(null)
  const maskRef = useRef<HTMLDivElement>(null)

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
    let mode: 'idle' | 'pending' | 'dragging' | 'ignored' = 'idle'
    let lastDx = 0

    const resetStyles = () => {
      const drawer = drawerRef.current
      const mask = maskRef.current
      if (drawer) {
        drawer.style.removeProperty('transition')
        drawer.style.removeProperty('transform')
        drawer.style.removeProperty('visibility')
      }
      if (mask) {
        mask.style.removeProperty('transition')
        mask.style.removeProperty('opacity')
        mask.style.removeProperty('pointer-events')
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      if (
        event.touches.length !== 1 ||
        document.querySelector('[role="dialog"][aria-modal="true"]') ||
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
        mode = 'dragging'
      }

      if (mode === 'dragging') {
        lastDx = dx
        const offset = wasOpen
          ? Math.max(-drawerWidth, Math.min(0, dx))
          : Math.min(0, -drawerWidth + Math.max(0, dx))
        const progress = Math.max(0, Math.min(1, 1 + offset / drawerWidth))
        const drawer = drawerRef.current
        const mask = maskRef.current
        if (drawer) {
          drawer.style.transition = 'none'
          drawer.style.visibility = 'visible'
          drawer.style.transform = `translate3d(${offset}px, 0, 0)`
        }
        if (mask) {
          mask.style.transition = 'none'
          mask.style.opacity = String(progress)
          mask.style.pointerEvents = 'auto'
        }
      }
    }

    const onTouchEnd = () => {
      if (mode !== 'dragging') {
        mode = 'idle'
        return
      }
      mode = 'idle'
      resetStyles()
      const elapsed = Math.max(1, Date.now() - startTime)
      const vx = lastDx / elapsed
      if (!wasOpen) {
        if (lastDx > drawerWidth * 0.25 || (vx > 0.35 && lastDx > 24)) {
          openMobileSider()
        } else {
          closeMobileSider()
        }
      } else if (lastDx < -drawerWidth * 0.2 || (vx < -0.35 && lastDx < -24)) {
        closeMobileSider()
      } else {
        openMobileSider()
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
    <>
      <div
        ref={maskRef}
        data-open={open ? 'true' : undefined}
        className={clsx(styles.drawerMask, open && styles.drawerMaskOpen)}
        onClick={closeMobileSider}
      />
      <div ref={drawerRef} className={clsx(styles.drawer, open && styles.drawerOpen)}>
        <Sider mobile />
      </div>
    </>
  )
}
