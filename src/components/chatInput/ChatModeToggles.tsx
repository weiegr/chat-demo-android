import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  const searchSlotRef = useRef<HTMLDivElement>(null)
  const showSearch = mode !== 'rp'
  // 切入 RP 收起搜索按钮期间保留切换前的文案（智能搜索 / 旁路搜索），避免退场中途闪字
  const [shownBypass, setShownBypass] = useState(mode === 'expert')

  useEffect(() => {
    if (mode !== 'rp') {
      setShownBypass(mode === 'expert')
    }
  }, [mode])

  useLayoutEffect(() => {
    if (searchSlotRef.current) {
      searchSlotRef.current.inert = !showSearch
    }
  }, [showSearch])

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      if (!showSearch) {
        return
      }
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [showSearch, t])

  const smartLabel = t('search')
  const bypassLabel = t('bypassSearch')
  const activeSearchLabel = shownBypass ? bypassLabel : smartLabel

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
      <div
        ref={searchSlotRef}
        className={clsx(styles.searchToggleSlot, !showSearch && styles.searchToggleSlotHidden)}
        aria-hidden={!showSearch}
      >
        <div className={styles.searchToggleClip}>
          <Tooltip content={t(shownBypass ? 'bypassSearchTooltip' : 'deactivatedSearchTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, search && styles.selected)}
              aria-label={activeSearchLabel}
              aria-pressed={search}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setSearch(!search)}
            >
              <IconGlobeLanguageOutline14 active={search} />
              <span className={clsx(styles.toggleLabel, styles.searchLabelSwap)}>
                <span
                  aria-hidden={shownBypass}
                  className={clsx(
                    styles.searchLabelText,
                    shownBypass ? styles.searchLabelExitUp : styles.searchLabelActive
                  )}
                >
                  {smartLabel}
                </span>
                <span
                  aria-hidden={!shownBypass}
                  className={clsx(
                    styles.searchLabelText,
                    shownBypass ? styles.searchLabelActive : styles.searchLabelExitDown
                  )}
                >
                  {bypassLabel}
                </span>
              </span>
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
