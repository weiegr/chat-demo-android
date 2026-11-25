import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { usePresence } from '../base/usePresence.js'
import { RpModelPickerModal } from '../settings/RpModeSettings.js'
import styles from './RpModelCapsule.module.css'

/**
 * RP 模式模型快捷切换胶囊（置于上下文圆环右侧）：
 * 直接展示 Flash / Pro，点击弹出上下滑动选择菜单并持久化保存为新会话默认模型；
 * 开始 RP 对话后仍保持显示。
 */
export const RpModelCapsule = ({
  mobile = false,
  collapsed = false,
}: {
  mobile?: boolean
  collapsed?: boolean
}) => {
  const t = useTranslate()
  const ready = useChatStore((state) => state.ready)
  const activeId = useChatStore((state) => state.activeId)
  const sessionMode = useChatStore((state) =>
    activeId === null ? undefined : state.sessionCache[activeId]?.mode
  )
  const welcomeMode = useSettings((state) => state.chatMode)
  const rpModel = useSettings((state) => state.rpModel)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerPresence = usePresence(pickerOpen, 280)

  const active = ready && (activeId === null ? welcomeMode === 'rp' : sessionMode === 'rp')
  if (!active && !pickerPresence.mounted) {
    return null
  }

  const shortLabel = rpModel === 'deepseek-v4-pro' ? 'Pro' : 'Flash'

  return (
    <>
      {active ? (
        <button
          type="button"
          className={clsx(styles.capsule, mobile && styles.mobile, collapsed && styles.collapsed)}
          aria-label={`${t('settingsRpModel')}: ${shortLabel}`}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen(true)}
        >
          {shortLabel}
        </button>
      ) : null}
      {pickerPresence.mounted ? (
        <RpModelPickerModal visible={pickerPresence.visible} onClose={() => setPickerOpen(false)} />
      ) : null}
    </>
  )
}
