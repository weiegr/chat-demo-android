import { IconCameraOutline20, IconMenuOutline20, IconNewChatOutline20 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { newChat, useChatStore } from '../../services/chat/store.js'
import { canUploadVideo, useSettings, type ChatMode } from '../../services/settings.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'
import { openMobileSider, closeMobileSider, useMobileSider } from '../sider/mobileSiderState.js'
import { getChatModeMeta } from './chatModeMeta.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：侧边栏、会话标题与模式、拍照快捷入口和新对话 */
export const MobileHeader = ({
  title,
  mode,
  editing = false,
  onTakePhoto,
}: {
  title?: string
  mode?: ChatMode
  editing?: boolean
  onTakePhoto?: () => void
}) => {
  const t = useTranslate()
  const siderOpen = useMobileSider((state) => state.open)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const showCameraShortcut = useSettings((settings) => {
    const activeMode = mode ?? settings.chatMode
    // 编辑消息时，附件菜单会同时提供拍照和视频。
    return (
      activeMode === 'fast' &&
      (settings.quickCameraShortcut === 'on' ||
        (settings.quickCameraShortcut === 'when-occupied' &&
          !editing &&
          canUploadVideo(activeMode, settings)))
    )
  })
  const modeMeta = mode ? getChatModeMeta(mode) : null
  return (
    <div className={styles.header}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={siderOpen ? t('collapseSiderbarButton') : t('expandSiderbarButton')}
        onClick={() => (siderOpen ? closeMobileSider() : openMobileSider())}
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
      {onTakePhoto && showCameraShortcut ? (
        <IconButton
          size="xl"
          tone="primary"
          icon={<IconCameraOutline20 />}
          aria-label={t('attachCamera')}
          disabled={importingHistory}
          onClick={onTakePhoto}
        />
      ) : null}
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
