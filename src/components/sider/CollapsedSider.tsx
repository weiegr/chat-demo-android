import clsx from 'clsx'
import { IconPanelLeftOutline16, NewChatIcon } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { RpContextRing } from '../session/RpContextRing.js'
import { RpModelCapsule } from '../session/RpModelCapsule.js'
import styles from './Sider.module.css'

/** 收起后左上角的按钮组；常驻挂载，靠透明度切换，展开时与侧栏同步淡出 */
export const CollapsedSider = ({ collapsed }: { collapsed: boolean }) => {
  const t = useTranslate()
  return (
    <div
      className={clsx(styles.collapsed, !collapsed && styles.collapsedHidden)}
      aria-hidden={!collapsed}
    >
      <div className={styles.collapsedGroup}>
        <IconButton
          size="m"
          tone="primary"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('expandSiderbarButton')}
          onClick={() => setSiderCollapsed(false)}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          onClick={newChat}
        />
        {collapsed ? (
          <>
            <RpContextRing />
            <RpModelCapsule collapsed />
          </>
        ) : null}
      </div>
    </div>
  )
}
