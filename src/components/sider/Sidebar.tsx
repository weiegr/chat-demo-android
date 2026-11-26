import clsx from 'clsx'
import { Sider } from './Sider.js'
import styles from './Sider.module.css'

/**
 * 桌面侧边栏的动画外壳。
 * 常驻挂载：收起时只滑出并隐藏，展开时直接从 -261px 补间回来。
 * 之前收起后卸载、展开时重新挂载，会把整张会话列表重建一遍，展开瞬间明显卡顿。
 */
export const Sidebar = ({ collapsed }: { collapsed: boolean }) => (
  <div className={clsx(styles.shell, collapsed && styles.shellCollapsed)}>
    <Sider showRpContext={!collapsed} />
  </div>
)
