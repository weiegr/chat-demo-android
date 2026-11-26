import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { onMemoryChange } from '../../services/chat/db.js'
import { useGlobalMemory } from '../../services/chat/globalMemory.js'
import { isMemorySession } from '../../services/chat/memoryModel.js'
import { loadSessionMemory, setSessionMemoryEnabled } from '../../services/chat/memoryStorage.js'
import { setDraftMemoryEnabled, useChatStore } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { useSettings } from '../../services/settings.js'
import { IconButton } from '../base/IconButton.js'
import { IconNotebookOutline20 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import styles from './SessionMemoryButton.module.css'

export const SessionMemoryButton = ({
  session,
  desktop = false,
}: {
  session: Session | null
  desktop?: boolean
}) => {
  const t = useTranslate()
  const globalEnabled = useGlobalMemory((state) => state.profile.enabled)
  const draftMode = useSettings((state) => state.chatMode)
  const draftEnabled = useChatStore((state) => state.draftMemoryEnabled)
  const importing = useChatStore((state) => state.importingHistory)
  const [saved, setSaved] = useState<{ id: string; enabled: boolean }>()
  const savingRef = useRef(false)
  const sessionId = session?.id
  const visible =
    __BETA__ && globalEnabled && (session ? isMemorySession(session) : draftMode === 'fast')

  useEffect(() => {
    if (!visible || sessionId === undefined) {
      return
    }
    let active = true
    let read = 0
    const refresh = () => {
      const current = ++read
      void loadSessionMemory(sessionId)
        .then(({ enabled }) => {
          if (active && read === current) {
            setSaved({ id: sessionId, enabled })
          }
        })
        .catch(() => {
          if (active && read === current) {
            setSaved(undefined)
          }
        })
    }
    const unsubscribe = onMemoryChange((change, id) => {
      if (change === 'sources' && (id === undefined || id === sessionId)) {
        refresh()
      }
    })
    refresh()
    return () => {
      active = false
      unsubscribe()
    }
  }, [sessionId, visible])

  if (!visible) {
    return null
  }
  const enabled =
    sessionId === undefined ? draftEnabled : saved?.id === sessionId ? saved?.enabled : undefined
  const toggle = async () => {
    if (enabled === undefined || savingRef.current || importing) {
      return
    }
    const nextEnabled = !enabled
    if (sessionId === undefined) {
      setDraftMemoryEnabled(nextEnabled)
      showToast(
        { key: nextEnabled ? 'sessionMemoryEnabled' : 'sessionMemoryDisabled' },
        { placement: 'center' }
      )
      return
    }
    const targetSessionId = sessionId
    const previousEnabled = enabled
    savingRef.current = true
    // 乐观切换状态：斜杠动效零延迟启动且不触发禁用闪灰，写入失败时回滚
    setSaved({ id: targetSessionId, enabled: nextEnabled })
    try {
      const updated = await setSessionMemoryEnabled(targetSessionId, nextEnabled)
      setSaved((current) =>
        current?.id === targetSessionId
          ? { id: targetSessionId, enabled: updated.enabled }
          : current
      )
      showToast(
        { key: updated.enabled ? 'sessionMemoryEnabled' : 'sessionMemoryDisabled' },
        { placement: 'center' }
      )
    } catch {
      setSaved((current) =>
        current?.id === targetSessionId
          ? { id: targetSessionId, enabled: previousEnabled }
          : current
      )
      showToast({ key: 'sessionMemorySaveError' }, { placement: 'center' })
    } finally {
      savingRef.current = false
    }
  }
  return (
    <IconButton
      size={desktop ? 'm' : 'xl'}
      tone="primary"
      className={styles.memoryButton}
      icon={
        <IconNotebookOutline20
          key={sessionId ?? 'draft'}
          slashed={enabled === undefined ? undefined : !enabled}
        />
      }
      role="switch"
      aria-checked={enabled ?? true}
      aria-label={t('sessionMemory')}
      tooltip={desktop ? t('sessionMemory') : undefined}
      disabled={enabled === undefined || importing}
      onClick={() => void toggle()}
    />
  )
}
