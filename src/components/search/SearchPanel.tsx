import { useEffect } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { closeSearchPanel, useSearchPanel } from './searchPanelState.js'
import { SourceCard } from './SourceCard.js'
import styles from './SearchPanel.module.css'

/** 右侧「搜索结果」面板 */
export const SearchPanel = () => {
  const t = useTranslate()
  const entry = useSearchPanel((state) => state.entry)
  const sources = useSearchPanel((state) => state.sources)
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
  if (!entry) {
    return null
  }
  return (
    <>
      <div className={styles.mask} onClick={closeSearchPanel} />
      <aside className={styles.panel}>
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
          {sources.map((source) => (
            <SourceCard key={source.url} source={source} className={styles.item} />
          ))}
        </div>
      </aside>
    </>
  )
}
