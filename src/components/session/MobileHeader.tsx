import { IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat } from '../../services/chat/store.js'
import type { ChatMode } from '../../services/settings.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import { getChatModeMeta } from './chatModeMeta.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：左侧菜单打开侧边栏，中间显示会话标题与当前模式，右侧开启新对话 */
export const MobileHeader = ({ title, mode }: { title?: string; mode?: ChatMode }) => {
  const t = useTranslate()
  const modeMeta = mode ? getChatModeMeta(mode) : null
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={() => openMobileSider()}
      />
      <div className={styles.titleGroup}>
        <div className={styles.title}>{title ?? ''}</div>
        {modeMeta ? (
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
        ) : null}
      </div>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconNewChatOutline20 />}
        aria-label={t('newChat')}
        onClick={newChat}
      />
    </div>
  )
}
