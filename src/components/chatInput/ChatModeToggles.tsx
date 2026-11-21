import clsx from 'clsx'
import { useLayoutEffect, useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { setSearch, setThinking, useSettings, type ChatMode } from '../../services/settings.js'
import { IconGlobeLanguageOutline14, IconThinkOutline14 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import styles from './ChatInput.module.css'

export const ChatModeToggles = ({ mode }: { mode: ChatMode }) => {
  const t = useTranslate()
  const thinking = useSettings((state) => state.thinking)
  const search = useSettings((state) => state.search)
  const togglesRef = useRef<HTMLDivElement>(null)
  const bypass = mode === 'expert'
  const searchLabel = t(bypass ? 'bypassSearch' : 'search')

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [mode, t])

  return (
    <div ref={togglesRef} className={styles.toggles}>
      <Tooltip content={t('deactivatedThinkTooltip')}>
        <button
          type="button"
          className={clsx(styles.toggle, thinking && styles.selected)}
          aria-label={t('thinkingSwitch')}
          aria-pressed={thinking}
          // 保持焦点，避免切换开关时收起输入法。
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setThinking(!thinking)}
        >
          <IconThinkOutline14 active={thinking} />
          <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
        </button>
      </Tooltip>
      {mode !== 'rp' ? (
        <Tooltip content={t(bypass ? 'bypassSearchTooltip' : 'deactivatedSearchTooltip')}>
          <button
            type="button"
            className={clsx(styles.toggle, search && styles.selected)}
            aria-label={searchLabel}
            aria-pressed={search}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setSearch(!search)}
          >
            <IconGlobeLanguageOutline14 active={search} />
            <span className={styles.toggleLabel}>{searchLabel}</span>
          </button>
        </Tooltip>
      ) : null}
    </div>
  )
}
