import clsx from 'clsx'
import { useRef } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { showToast } from '../base/toastState.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { useUserEdit } from '../messages/userEditState.js'
import { getChatModeMeta } from './chatModeMeta.js'
import { MobileHeader } from './MobileHeader.js'
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
  const cameraShortcutRef = useRef<(() => void) | null>(null)
  const title = session.title || t('untitledChat')
  const mode = session.mode ?? 'fast'
  const modeMeta = getChatModeMeta(mode)
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader
          title={title}
          mode={mode}
          editing={editing}
          onTakePhoto={() => cameraShortcutRef.current?.()}
        />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.titleGroup, siderCollapsed && styles.withCollapsedSider)}>
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
        </div>
      )}
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
