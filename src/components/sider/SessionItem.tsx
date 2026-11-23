import clsx from 'clsx'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconEditOutline16, IconEllipsisOutline16, IconTrashOutline16 } from '../base/icons.js'
import { renameSession, selectSession } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

const LONG_PRESS_MS = 420
const LONG_PRESS_MOVE_LIMIT = 8

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
  onEditing,
}: {
  session: SessionSummary
  active: boolean
  onDelete: (session: SessionSummary) => void
  onEditing: (id: string) => () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const [menuSource, setMenuSource] = useState<'button' | 'longPress' | null>(null)
  const [pressing, setPressing] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)
  const longPressTimerRef = useRef(0)
  const longPressResetTimerRef = useRef(0)
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const longPressTriggeredRef = useRef(false)
  const displayTitle = session.title || t('untitledChat')

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

  useLayoutEffect(
    () => (editing ? onEditing(session.id) : undefined),
    [editing, onEditing, session.id]
  )

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  const menuOpen = menuSource !== null
  const isLongPressMenu = menuSource === 'longPress'

  return (
    <div
      ref={itemRef}
      className={clsx(
        styles.item,
        active && styles.active,
        menuSource === 'button' && styles.menuOpen,
        (pressing || isLongPressMenu) && !active && styles.longPressed
      )}
      onTouchStart={(event) => {
        if (
          event.touches.length !== 1 ||
          (event.target instanceof Element && event.target.closest(`.${styles.action}`))
        ) {
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
          setMenuSource('longPress')
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
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        if (longPressTriggeredRef.current) {
          window.clearTimeout(longPressResetTimerRef.current)
          longPressResetTimerRef.current = 0
          longPressTriggeredRef.current = false
          return
        }
        selectSession(session.id)
        closeMobileSider()
      }}
    >
      <div className={styles.title}>{displayTitle}</div>
      <div className={styles.action} onClick={(event) => event.stopPropagation()}>
        <Menu
          open={menuOpen}
          anchorRef={isLongPressMenu ? itemRef : undefined}
          align={isLongPressMenu ? 'end' : 'start'}
          alignOffset={isLongPressMenu ? 0 : -5}
          offset={isLongPressMenu ? 6 : 4}
          variant={isLongPressMenu ? 'context' : 'default'}
          withBackdrop={isLongPressMenu}
          onOpenChange={(next) => {
            if (!next) {
              setMenuSource(null)
            }
          }}
          options={[
            {
              key: 'rename',
              label: t('sessionItemMenuRenameOption'),
              icon: <IconEditOutline16 />,
              onSelect: () => setEditing(true),
            },
            {
              key: 'delete',
              label: t('delete'),
              icon: <IconTrashOutline16 />,
              danger: true,
              onSelect: () => onDelete(session),
            },
          ]}
        >
          {({ toggle }) => (
            <IconButton
              icon={<IconEllipsisOutline16 />}
              aria-label={t('more')}
              onClick={() => {
                if (menuSource === 'button') {
                  toggle()
                } else {
                  setMenuSource('button')
                }
              }}
            />
          )}
        </Menu>
      </div>
    </div>
  )
})
