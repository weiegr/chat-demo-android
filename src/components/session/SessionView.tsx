import clsx from 'clsx'
import { useLayoutEffect, useRef } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { showToast } from '../base/toastState.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { useUserEdit } from '../messages/userEditState.js'
import { getChatModeMeta } from './chatModeMeta.js'
import { runComposerTransition } from './composerTransition.js'
import { MobileHeader } from './MobileHeader.js'
import { SessionMemoryButton } from './SessionMemoryButton.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
  onStartCall,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
  onStartCall?: (sessionId: string | null) => void
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const editing = useUserEdit((state) => state.active?.sessionId === session.id)
  const viewRef = useRef<HTMLDivElement>(null)
  const headerSlotRef = useRef<HTMLDivElement>(null)
  const cameraShortcutRef = useRef<(() => void) | null>(null)
  const title = session.title || t('untitledChat')
  const mode = session.mode ?? 'fast'
  const modeMeta = getChatModeMeta(mode)

  useLayoutEffect(() => runComposerTransition(viewRef.current, 'session').cleanup, [])

  // 同步实测顶栏高度，供自定义背景模式下悬浮顶栏、列表顶部留白与思考标题精确吸顶使用
  useLayoutEffect(() => {
    const view = viewRef.current
    const slot = headerSlotRef.current
    if (!view || !slot) {
      return
    }
    const target = slot.firstElementChild instanceof HTMLElement ? slot.firstElementChild : slot
    const syncHeight = () => {
      const height = Math.round(target.getBoundingClientRect().height)
      if (height > 0) {
        view.style.setProperty('--session-header-height', `${height}px`)
      }
    }
    syncHeight()
    const observer = new ResizeObserver(syncHeight)
    observer.observe(target)
    return () => {
      observer.disconnect()
      view.style.removeProperty('--session-header-height')
    }
  }, [isMobile])

  return (
    <div ref={viewRef} className={styles.view}>
      <div
        ref={headerSlotRef}
        className={clsx(styles.headerSlot, editing && styles.headerSlotEditing)}
      >
        {isMobile ? (
          <MobileHeader
            title={title}
            mode={mode}
            editing={editing}
            memorySession={session}
            onTakePhoto={() => cameraShortcutRef.current?.()}
          />
        ) : (
          <div className={styles.header}>
            <div
              className={clsx(styles.titleGroup, siderCollapsed && styles.withCollapsedSider)}
              data-rp-context={__BETA__ && mode === 'rp' ? 'true' : undefined}
            >
              <div className={styles.title}>{title}</div>
              <button
                type="button"
                className={styles.modeBadge}
                onClick={() =>
                  showToast({ key: 'chatModeSwitchInNewSessionHint' }, { placement: 'center' })
                }
              >
                <span className={styles.modeIcon} aria-hidden="true">
                  {modeMeta.icon}
                </span>
                <span className={styles.modeLabel}>{t(modeMeta.labelKey)}</span>
              </button>
            </div>
            <SessionMemoryButton session={session} desktop />
          </div>
        )}
      </div>
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={clsx(styles.inputContainer, editing && styles.inputContainerEditing)}>
            <ChatInput
              sessionId={session.id}
              onStartCall={onStartCall}
              cameraShortcutRef={cameraShortcutRef}
            />
          </div>
        }
      />
    </div>
  )
}
