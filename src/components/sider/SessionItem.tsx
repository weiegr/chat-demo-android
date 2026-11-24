import clsx from 'clsx'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconEditOutline16, IconEllipsisOutline16, IconTrashOutline16 } from '../base/icons.js'
import { renameSession, selectSession } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider, dismissKeyboard } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

const LONG_PRESS_MS = 420
const LONG_PRESS_MOVE_LIMIT = 8

const RenameField = ({
  sessionId,
  initialTitle,
  mobile,
  commitEditingRef,
  onEndEditing,
}: {
  sessionId: string
  initialTitle: string
  mobile: boolean
  commitEditingRef?: MutableRefObject<(() => void) | null>
  onEndEditing: (id: string) => void
}) => {
  const t = useTranslate()
  const [value, setValue] = useState(initialTitle)
  const inputRef = useRef<HTMLInputElement>(null)
  const settledRef = useRef(false)
  const endRef = useRef(onEndEditing)
  endRef.current = onEndEditing

  const commit = useCallback(
    (raw: string, hideIme: boolean) => {
      if (settledRef.current) {
        return
      }
      settledRef.current = true
      const trimmed = raw.trim()
      if (trimmed && trimmed !== initialTitle) {
        renameSession(sessionId, trimmed)
      }
      endRef.current(sessionId)
      if (mobile && hideIme) {
        dismissKeyboard()
      }
    },
    [initialTitle, mobile, sessionId]
  )

  useEffect(() => {
    if (!commitEditingRef) {
      return
    }
    commitEditingRef.current = () => {
      commit(inputRef.current?.value ?? initialTitle, false)
    }
    return () => {
      commitEditingRef.current = null
    }
  }, [commit, commitEditingRef, initialTitle])

  const cancel = useCallback(
    (hideIme: boolean) => {
      if (settledRef.current) {
        return
      }
      settledRef.current = true
      endRef.current(sessionId)
      if (mobile && hideIme) {
        dismissKeyboard()
      }
    },
    [mobile, sessionId]
  )

  // 同步聚焦并禁用浏览器默认粗糙跳滚，将滚动定位完全交给侧栏软键盘跟手引擎
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }
    input.focus({ preventScroll: true })
    if (mobile) {
      // 移动端光标落至末尾，避免全选直接弹出原生复制/粘贴工具栏遮挡标题与上方条目
      const end = input.value.length
      input.setSelectionRange(end, end)
      input.scrollLeft = input.scrollWidth
    } else {
      input.select()
    }
  }, [mobile])

  // 捕获 Escape（含 Android 返回键派发的 Escape），优先退出重命名而不误关侧边栏抽屉
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      cancel(true)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [cancel])

  return (
    <div className={styles.renameBox} data-session-rename-box="true" data-sider-swipe-ignore="true">
      <input
        ref={inputRef}
        type="text"
        className={styles.renameInput}
        value={value}
        aria-label={t('sessionItemMenuRenameOption')}
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onBlur={(event) => commit(event.target.value, false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            commit(event.currentTarget.value, true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            cancel(true)
          }
        }}
      />
    </div>
  )
}

export const SessionItem = memo(function SessionItem({
  session,
  active,
  mobile,
  editing,
  anyEditing,
  commitEditingRef,
  onDelete,
  onStartEditing,
  onEndEditing,
}: {
  session: SessionSummary
  active: boolean
  mobile: boolean
  editing: boolean
  anyEditing: boolean
  commitEditingRef?: MutableRefObject<(() => void) | null>
  onDelete: (session: SessionSummary) => void
  onStartEditing: (id: string) => void
  onEndEditing: (id: string) => void
}) {
  const t = useTranslate()
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

  if (editing) {
    return (
      <RenameField
        sessionId={session.id}
        initialTitle={displayTitle}
        mobile={mobile}
        commitEditingRef={commitEditingRef}
        onEndEditing={onEndEditing}
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
          anyEditing ||
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
        if (anyEditing) {
          return
        }
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
              onSelect: () => onStartEditing(session.id),
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
