import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

const OVERSCAN_ROWS = 8
// 与 CSS 中的会话行和日期分组尺寸保持一致。
const SECTION_PADDING = 4
const SECTION_GAP = 16

export const SessionList = memo(function SessionList({
  mobile,
  onDelete,
}: {
  mobile: boolean
  onDelete: (session: SessionSummary) => void
}) {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const listRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(Date.now)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const rowHeight = mobile ? 44 : 40
  const headerHeight = mobile ? 30 : 22

  const sections = useMemo(() => {
    let end = 0
    return groupSessions(sessions, now, t).map((group, index) => {
      const top = end + (index === 0 ? 0 : SECTION_GAP)
      const rowsTop = top + SECTION_PADDING + headerHeight
      end = rowsTop + group.sessions.length * rowHeight
      return { ...group, top, rowsTop, end }
    })
  }, [sessions, now, t, headerHeight, rowHeight])
  const totalHeight = sections.at(-1)?.end ?? 0

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = new Date()
      const today = time.toDateString()
      setNow((previous) => (new Date(previous).toDateString() === today ? previous : +time))
      timer = setTimeout(refresh, new Date(time).setHours(24, 0, 0, 0) - +time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const updateScrollTop = useCallback(
    (top: number) => {
      setScrollTop(Math.floor(top / rowHeight) * rowHeight)
    },
    [rowHeight]
  )

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) {
      return
    }
    const measure = () => {
      setViewportHeight(list.clientHeight)
      updateScrollTop(list.scrollTop)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [updateScrollTop])

  const keepEditing = useCallback((id: string) => {
    setEditingId(id)
    return () => setEditingId((previous) => (previous === id ? null : previous))
  }, [])
  const editingPosition = useMemo(() => {
    if (editingId !== null) {
      for (const section of sections) {
        const index = section.sessions.findIndex((session) => session.id === editingId)
        if (index !== -1) {
          return { section, index }
        }
      }
    }
    return null
  }, [editingId, sections])

  const overscan = OVERSCAN_ROWS * rowHeight
  const top = Math.min(scrollTop, Math.max(0, totalHeight - viewportHeight))
  const from = Math.max(0, top - overscan)
  const to = top + viewportHeight + overscan

  return (
    <div className={styles.listWrap}>
      <div
        ref={listRef}
        className={styles.list}
        onScroll={(event) => updateScrollTop(event.currentTarget.scrollTop)}
      >
        <div className={styles.listTrack} style={{ height: totalHeight }}>
          {sections.map((section) => {
            const visible = section.top < to && section.end > from
            const editing = editingPosition?.section === section ? editingPosition.index : -1
            if (!visible && editing === -1) {
              return null
            }
            const first = Math.max(0, Math.floor((from - section.rowsTop) / rowHeight))
            const last = Math.min(
              section.sessions.length,
              Math.ceil((to - section.rowsTop) / rowHeight)
            )
            const renderRow = (session: SessionSummary, index: number) => (
              <div
                key={session.id}
                className={styles.sessionRow}
                style={{ top: section.rowsTop - section.top + index * rowHeight }}
              >
                <SessionItem
                  session={session}
                  active={session.id === activeId}
                  onDelete={onDelete}
                  onEditing={keepEditing}
                />
              </div>
            )
            const rows = visible
              ? section.sessions
                  .slice(first, Math.max(first, last))
                  .map((session, index) => renderRow(session, first + index))
              : []
            // 滚出可视范围后保留正在重命名的输入框及其 DOM 顺序。
            if (editing !== -1 && (!visible || editing < first || editing >= last)) {
              const row = renderRow(section.sessions[editing], editing)
              if (editing < first) {
                rows.unshift(row)
              } else {
                rows.push(row)
              }
            }
            return (
              <div
                key={section.key}
                className={styles.section}
                style={{ top: section.top, height: section.end - section.top }}
              >
                <div className={styles.sectionHeader}>{section.label}</div>
                {rows}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
})
