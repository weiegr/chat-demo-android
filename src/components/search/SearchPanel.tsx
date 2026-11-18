import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { usePresence } from '../base/usePresence.js'
import { closeSearchPanel, useSearchPanel } from './searchPanelState.js'
import { SourceCard } from './SourceCard.js'
import styles from './SearchPanel.module.css'

/** 右侧/移动端底部「搜索结果」面板 */
export const SearchPanel = () => {
  const t = useTranslate()
  const entry = useSearchPanel((state) => state.entry)
  const sources = useSearchPanel((state) => state.sources)
  const open = Boolean(entry)
  const presence = usePresence(open, 280)
  const cachedSourcesRef = useRef(sources)
  if (open) {
    cachedSourcesRef.current = sources
  }
  const renderSources = open ? sources : cachedSourcesRef.current

  useEffect(() => {
    if (!entry) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        closeSearchPanel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [entry])

  if (!presence.mounted) {
    return null
  }
  return (
    <>
      <div
        className={clsx(styles.mask, presence.visible && styles.maskOpen)}
        onClick={closeSearchPanel}
      />
      <aside className={clsx(styles.panel, presence.visible && styles.panelOpen)}>
        <div className={styles.header}>
          <div role="heading" className={styles.title}>
            {t('searchResult')}
          </div>
          <IconButton
            className={styles.closeButton}
            icon={<IconCloseOutline16 />}
            aria-label={t('close')}
            onClick={closeSearchPanel}
          />
        </div>
        <div className={styles.content}>
          {renderSources.map((source) => (
            <SourceCard key={source.url} source={source} className={styles.item} />
          ))}
        </div>
      </aside>
    </>
  )
}
