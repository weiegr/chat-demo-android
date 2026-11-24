import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  getImeMotionState,
  getLastKnownImeRaiseCss,
  hasNativeImeMotion,
  subscribeImeMotion,
} from '../../app/imeMotion.js'
import { useTranslate } from '../../i18n/index.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { dismissKeyboard } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

const OVERSCAN_ROWS = 8
// 与 CSS 中的会话行和日期分组尺寸保持一致。
const SECTION_PADDING = 4
const SECTION_GAP = 16
/** 重命名输入框底边与软键盘顶沿之间的呼吸间距 */
const EDIT_IME_GAP = 20
/** 键盘展开时在列表底部追加的额外滚动缓冲，避免最后一项紧贴硬底 */
const EDIT_IME_EXTRA_PAD = 24
/** 避开底部设置栏上方 24px 渐隐遮罩 */
const LIST_BOTTOM_FADE_GUARD = 24

const readSafeBottomCss = () => {
  if (typeof window === 'undefined') {
    return 0
  }
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')
  )
  return Number.isFinite(value) && value > 0 ? value : 0
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

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
  const imeSpacerRef = useRef<HTMLDivElement>(null)
  const commitEditingRef = useRef<(() => void) | null>(null)
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

  const editingPosition = useMemo(() => {
    if (editingId !== null) {
      for (const section of sections) {
        const index = section.sessions.findIndex((session) => session.id === editingId)
        if (index !== -1) {
          const rowTop = section.rowsTop + index * rowHeight
          return { section, index, rowTop, rowBottom: rowTop + rowHeight }
        }
      }
    }
    return null
  }, [editingId, sections, rowHeight])

  const editingIdRef = useRef<string | null>(editingId)
  editingIdRef.current = editingId
  const editingBoundsRef = useRef<{ rowTop: number; rowBottom: number } | null>(null)
  editingBoundsRef.current = editingPosition
    ? { rowTop: editingPosition.rowTop, rowBottom: editingPosition.rowBottom }
    : null
  const totalHeightRef = useRef(totalHeight)
  totalHeightRef.current = totalHeight
  const headerHeightRef = useRef(headerHeight)
  headerHeightRef.current = headerHeight

  const imePadRef = useRef(0)
  const smoothScrollRafRef = useRef(0)
  const userTouchedRef = useRef(false)
  const hadImeVisibleRef = useRef(false)
  const cleanupTimerRef = useRef(0)
  const outsideTapRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(
    null
  )
  const swallowNextClickRef = useRef(false)
  const swallowResetTimerRef = useRef(0)

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

  const cancelSmoothScroll = useCallback(() => {
    if (smoothScrollRafRef.current) {
      window.cancelAnimationFrame(smoothScrollRafRef.current)
      smoothScrollRafRef.current = 0
    }
  }, [])

  const smoothScrollTo = useCallback(
    (targetTop: number, durationMs = 180, onDone?: () => void) => {
      cancelSmoothScroll()
      const list = listRef.current
      if (!list) {
        onDone?.()
        return
      }
      const startTop = list.scrollTop
      const delta = targetTop - startTop
      if (Math.abs(delta) < 0.5 || prefersReducedMotion() || durationMs <= 0) {
        list.scrollTop = targetTop
        updateScrollTop(list.scrollTop)
        onDone?.()
        return
      }
      const startTime = performance.now()
      const step = (nowTs: number) => {
        const raw = Math.min(1, Math.max(0, nowTs - startTime) / durationMs)
        const nextTop = startTop + delta * easeOutCubic(raw)
        list.scrollTop = nextTop
        updateScrollTop(list.scrollTop)
        if (raw < 1) {
          smoothScrollRafRef.current = window.requestAnimationFrame(step)
        } else {
          smoothScrollRafRef.current = 0
          list.scrollTop = targetTop
          updateScrollTop(list.scrollTop)
          onDone?.()
        }
      }
      smoothScrollRafRef.current = window.requestAnimationFrame(step)
    },
    [cancelSmoothScroll, updateScrollTop]
  )

  const setImePadding = useCallback((padPx: number) => {
    const spacer = imeSpacerRef.current
    const safePad = padPx > 0.5 ? Math.ceil(padPx) : 0
    imePadRef.current = safePad
    if (!spacer) {
      return
    }
    spacer.style.height = safePad > 0 ? `${safePad}px` : '0px'
  }, [])

  const computeRequiredPadding = useCallback((raise: number) => {
    const list = listRef.current
    if (!list || raise <= 0.5) {
      return 0
    }
    const listRect = list.getBoundingClientRect()
    const keyboardTop = window.innerHeight - readSafeBottomCss() - raise
    const imeOverlap = Math.max(0, listRect.bottom - keyboardTop)
    return imeOverlap > 0 ? Math.ceil(imeOverlap + EDIT_IME_GAP + EDIT_IME_EXTRA_PAD) : 0
  }, [])

  /** 计算使当前重命名行清晰露出在软键盘与底沿渐隐遮罩上方所需的目标 scrollTop */
  const computeTargetScrollTop = useCallback((raise: number) => {
    const list = listRef.current
    const bounds = editingBoundsRef.current
    if (!list || !bounds) {
      return null
    }
    const listRect = list.getBoundingClientRect()
    const keyboardTop = window.innerHeight - readSafeBottomCss() - raise
    const visibleBottom =
      raise > 0.5
        ? Math.min(keyboardTop - EDIT_IME_GAP, listRect.bottom - LIST_BOTTOM_FADE_GUARD)
        : listRect.bottom - LIST_BOTTOM_FADE_GUARD
    const headerClearance = headerHeightRef.current + 8
    const topGuardMax = Math.max(0, bounds.rowTop - headerClearance)

    // 若当前行已位于顶部吸顶分组标题后面，优先把它拉回安全顶沿下方
    if (bounds.rowTop - list.scrollTop < headerClearance) {
      return topGuardMax
    }
    const neededScrollTop = bounds.rowBottom - (visibleBottom - listRect.top)
    if (neededScrollTop <= list.scrollTop) {
      return null
    }
    return Math.min(neededScrollTop, topGuardMax)
  }, [])

  const alignImmediateForRaise = useCallback(
    (raise: number) => {
      const list = listRef.current
      if (!list) {
        return
      }
      const target = computeTargetScrollTop(raise)
      if (target !== null && Math.abs(target - list.scrollTop) > 0.5) {
        list.scrollTop = target
        updateScrollTop(list.scrollTop)
      }
    },
    [computeTargetScrollTop, updateScrollTop]
  )

  const settlePaddingBackToNatural = useCallback(
    (animate: boolean) => {
      const list = listRef.current
      if (!list || imePadRef.current <= 0.5) {
        setImePadding(0)
        return
      }
      const naturalMax = Math.max(0, totalHeightRef.current - list.clientHeight)
      if (list.scrollTop > naturalMax + 1) {
        if (animate) {
          smoothScrollTo(naturalMax, 180, () => setImePadding(0))
          return
        }
        list.scrollTop = naturalMax
        updateScrollTop(list.scrollTop)
      }
      setImePadding(0)
    },
    [setImePadding, smoothScrollTo, updateScrollTop]
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

  // Android 原生软键盘逐帧联动：键盘升起时跟手把下方重命名行托至键盘上方，收起时平滑回落零闪跳
  useEffect(() => {
    if (!mobile || !hasNativeImeMotion()) {
      return
    }
    let mode: 'idle' | 'opening' | 'settled' | 'closing' = 'idle'
    let closeStartRaise = 0
    let closeStartScrollTop = 0
    let closeTargetScrollTop = 0

    const clearPendingCleanup = () => {
      if (cleanupTimerRef.current) {
        window.clearTimeout(cleanupTimerRef.current)
        cleanupTimerRef.current = 0
      }
    }

    const ensurePadding = (raise: number) => {
      const needed = computeRequiredPadding(raise)
      if (needed > imePadRef.current) {
        setImePadding(needed)
      }
    }

    const unsubscribe = subscribeImeMotion((phase, ime) => {
      const list = listRef.current
      if (!list) {
        return
      }
      const editing = editingIdRef.current !== null

      if (phase === 'prepare') {
        if (!editing) {
          return
        }
        clearPendingCleanup()
        cancelSmoothScroll()
        if (ime.raise <= 0.5) {
          const predicted = getLastKnownImeRaiseCss()
          if (predicted > 0.5) {
            ensurePadding(predicted)
          }
          userTouchedRef.current = false
          mode = 'opening'
        }
        return
      }

      if (phase === 'start') {
        if (ime.opening) {
          if (!editing) {
            return
          }
          clearPendingCleanup()
          cancelSmoothScroll()
          hadImeVisibleRef.current = true
          userTouchedRef.current = false
          mode = 'opening'
          ensurePadding(Math.max(ime.targetRaise, ime.raise))
          alignImmediateForRaise(ime.raise)
          return
        }
        // 仅当目标高度归零（键盘真正收起）才进入回落，忽略切换表情/候选栏导致的微幅变矮
        if (ime.targetRaise <= 0.5 && (editing || imePadRef.current > 0.5)) {
          clearPendingCleanup()
          cancelSmoothScroll()
          mode = 'closing'
          const naturalMax = Math.max(0, totalHeightRef.current - list.clientHeight)
          closeStartRaise = Math.max(ime.raise, ime.settled, 1)
          closeStartScrollTop = list.scrollTop
          closeTargetScrollTop = Math.min(closeStartScrollTop, naturalMax)
        } else if (editing) {
          mode = 'settled'
        }
        return
      }

      if (phase === 'progress') {
        if (mode === 'opening' && editing) {
          if (ime.raise > 0.5) {
            hadImeVisibleRef.current = true
          }
          ensurePadding(ime.raise)
          alignImmediateForRaise(ime.raise)
          return
        }
        if (mode === 'closing' && closeStartScrollTop > closeTargetScrollTop + 0.5) {
          const ratio = Math.min(1, Math.max(0, ime.raise / closeStartRaise))
          const nextTop =
            closeTargetScrollTop + (closeStartScrollTop - closeTargetScrollTop) * ratio
          list.scrollTop = nextTop
          updateScrollTop(list.scrollTop)
        }
        return
      }

      // phase === 'end'
      if (ime.raise > 0.5) {
        if (!editing) {
          return
        }
        clearPendingCleanup()
        hadImeVisibleRef.current = true
        ensurePadding(ime.raise)
        if (!userTouchedRef.current) {
          const target = computeTargetScrollTop(ime.raise)
          if (target !== null && Math.abs(target - list.scrollTop) > 0.5) {
            if (ime.smoothSettle) {
              smoothScrollTo(target, 180)
            } else {
              list.scrollTop = target
              updateScrollTop(list.scrollTop)
            }
          }
        }
        mode = 'settled'
        return
      }

      // 键盘彻底收起：若编辑态仍挂起（如用户点了系统收起键盘键），自动提交并退出编辑
      if (editing && hadImeVisibleRef.current) {
        hadImeVisibleRef.current = false
        commitEditingRef.current?.()
        const active = document.activeElement
        if (active instanceof HTMLElement && list.contains(active)) {
          active.blur()
        }
      }
      clearPendingCleanup()
      if (imePadRef.current > 0.5) {
        // 正常逐帧 closing 已把列表带回自然底部，此处直接落位撤掉占位，仅无动画突收时补平滑回落
        settlePaddingBackToNatural(mode !== 'closing' && ime.smoothSettle)
      }
      mode = 'idle'
      closeStartRaise = 0
      closeStartScrollTop = 0
      closeTargetScrollTop = 0
    })

    return () => {
      unsubscribe()
      clearPendingCleanup()
      cancelSmoothScroll()
      setImePadding(0)
    }
  }, [
    mobile,
    alignImmediateForRaise,
    cancelSmoothScroll,
    computeRequiredPadding,
    computeTargetScrollTop,
    setImePadding,
    settlePaddingBackToNatural,
    smoothScrollTo,
    updateScrollTop,
  ])

  // 进入/退出编辑态时的衔接处理：已开键盘立即平滑露出、退出编辑无键盘时安全清理底部留白
  useLayoutEffect(() => {
    if (!mobile) {
      return
    }
    if (cleanupTimerRef.current) {
      window.clearTimeout(cleanupTimerRef.current)
      cleanupTimerRef.current = 0
    }

    if (editingId !== null) {
      userTouchedRef.current = false
      if (hasNativeImeMotion()) {
        const ime = getImeMotionState()
        hadImeVisibleRef.current = ime.raise > 0.5 || (ime.animating && ime.opening)
        if (ime.raise > 0.5) {
          const needed = computeRequiredPadding(ime.raise)
          if (needed > imePadRef.current) {
            setImePadding(needed)
          }
          const target = computeTargetScrollTop(ime.raise)
          if (target !== null) {
            smoothScrollTo(target, 180)
          }
        } else {
          // 键盘尚未升起时，先确保条目本身不在底部 24px 渐隐遮罩内被半截裁切
          const target = computeTargetScrollTop(0)
          if (target !== null) {
            smoothScrollTo(target, 160)
          }
        }
      }
      return
    }

    hadImeVisibleRef.current = false
    if (hasNativeImeMotion() && imePadRef.current > 0.5) {
      const ime = getImeMotionState()
      if (!ime.animating && ime.raise <= 0.5) {
        settlePaddingBackToNatural(true)
      } else {
        // 正常由紧随其后的键盘收起动画逐帧回落；超时兜底防止偶发未触发收起时残留留白
        cleanupTimerRef.current = window.setTimeout(() => {
          cleanupTimerRef.current = 0
          const latest = getImeMotionState()
          if (editingIdRef.current === null && !latest.animating && latest.raise <= 0.5) {
            settlePaddingBackToNatural(true)
          }
        }, 520)
      }
    }
  }, [
    mobile,
    editingId,
    computeRequiredPadding,
    computeTargetScrollTop,
    setImePadding,
    settlePaddingBackToNatural,
    smoothScrollTo,
  ])

  // 非原生移动浏览器（Safari / Chrome 移动网页）：基于 visualViewport 把下方重命名行平滑滚到键盘上方
  useEffect(() => {
    if (!mobile || hasNativeImeMotion() || editingId === null) {
      return
    }
    const alignForViewport = () => {
      const list = listRef.current
      const bounds = editingBoundsRef.current
      if (!list || !bounds || userTouchedRef.current) {
        return
      }
      const vv = window.visualViewport
      const vvBottom = (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight)
      const listRect = list.getBoundingClientRect()
      const overlap = Math.max(0, listRect.bottom - vvBottom)
      const neededPad = overlap > 0 ? Math.ceil(overlap + EDIT_IME_GAP + EDIT_IME_EXTRA_PAD) : 0
      if (neededPad > imePadRef.current) {
        setImePadding(neededPad)
      }
      const visibleBottom = Math.min(
        vvBottom - EDIT_IME_GAP,
        listRect.bottom - LIST_BOTTOM_FADE_GUARD
      )
      const headerClearance = headerHeightRef.current + 8
      const topGuardMax = Math.max(0, bounds.rowTop - headerClearance)
      const neededScrollTop = bounds.rowBottom - (visibleBottom - listRect.top)
      const target =
        bounds.rowTop - list.scrollTop < headerClearance
          ? topGuardMax
          : neededScrollTop > list.scrollTop
            ? Math.min(neededScrollTop, topGuardMax)
            : null
      if (target !== null && Math.abs(target - list.scrollTop) > 0.5) {
        smoothScrollTo(target, 180)
      }
    }

    const rafId = window.requestAnimationFrame(alignForViewport)
    const timer1 = window.setTimeout(alignForViewport, 140)
    const timer2 = window.setTimeout(alignForViewport, 320)
    window.visualViewport?.addEventListener('resize', alignForViewport)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.clearTimeout(timer1)
      window.clearTimeout(timer2)
      window.visualViewport?.removeEventListener('resize', alignForViewport)
      if (imePadRef.current > 0.5) {
        settlePaddingBackToNatural(true)
      }
    }
  }, [mobile, editingId, setImePadding, settlePaddingBackToNatural, smoothScrollTo])

  useEffect(
    () => () => {
      window.clearTimeout(swallowResetTimerRef.current)
      window.clearTimeout(cleanupTimerRef.current)
      cancelSmoothScroll()
    },
    [cancelSmoothScroll]
  )

  const startEditing = useCallback((id: string) => {
    setEditingId(id)
  }, [])

  const endEditing = useCallback((id: string) => {
    setEditingId((previous) => (previous === id ? null : previous))
  }, [])

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
        onWheel={() => {
          if (editingIdRef.current !== null) {
            userTouchedRef.current = true
            cancelSmoothScroll()
          }
        }}
        onPointerDownCapture={(event) => {
          if (editingIdRef.current === null) {
            return
          }
          if (
            event.target instanceof Element &&
            event.target.closest('[data-session-rename-box]')
          ) {
            return
          }
          // 编辑态下点列表内其他区域只用于提交退出重命名，防止误切会话并关闭侧边栏
          outsideTapRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
          }
          swallowNextClickRef.current = true
          window.clearTimeout(swallowResetTimerRef.current)
          swallowResetTimerRef.current = window.setTimeout(() => {
            swallowNextClickRef.current = false
            outsideTapRef.current = null
            swallowResetTimerRef.current = 0
          }, 450)
        }}
        onPointerMoveCapture={(event) => {
          const tap = outsideTapRef.current
          if (!tap || tap.pointerId !== event.pointerId || tap.moved) {
            return
          }
          if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) {
            tap.moved = true
            userTouchedRef.current = true
            cancelSmoothScroll()
            swallowNextClickRef.current = false
          }
        }}
        onClickCapture={(event) => {
          if (!swallowNextClickRef.current) {
            return
          }
          swallowNextClickRef.current = false
          outsideTapRef.current = null
          window.clearTimeout(swallowResetTimerRef.current)
          swallowResetTimerRef.current = 0
          event.preventDefault()
          event.stopPropagation()
          commitEditingRef.current?.()
          const list = listRef.current
          const active = document.activeElement
          if (list && active instanceof HTMLElement && list.contains(active)) {
            active.blur()
          }
          if (mobile) {
            dismissKeyboard()
          }
        }}
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
                  mobile={mobile}
                  editing={session.id === editingId}
                  anyEditing={editingId !== null}
                  commitEditingRef={session.id === editingId ? commitEditingRef : undefined}
                  onDelete={onDelete}
                  onStartEditing={startEditing}
                  onEndEditing={endEditing}
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
        {/* 移动端重命名软键盘动态底部占位：只增加可滚动高度，不改变滚动容器自身尺寸 */}
        <div ref={imeSpacerRef} aria-hidden="true" />
      </div>
    </div>
  )
})
