import clsx from 'clsx'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import {
  getSearchRevision,
  queryChatHistory,
  subscribeToSearchChanges,
} from '../../services/chat/searchClient.js'
import {
  searchSessionTitles,
  type ChatSearchHit,
  type SearchSegment,
} from '../../services/chat/search.js'
import { selectSession, useChatStore } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import {
  IconBackOutline20,
  IconCloseFill14,
  IconFileOutline16,
  IconSearchOutline16,
  IconVideoOutline16,
} from '../base/icons.js'
import { getChatModeMeta } from '../session/chatModeMeta.js'
import { closeMobileSider, useMobileSider } from '../sider/mobileSiderState.js'
import { closeChatSearch, finishChatSearchClose, useChatSearch } from './chatSearchState.js'
import styles from './ChatSearchView.module.css'

const SEGMENT_KEY = (index: number) => `segment-${index}`

/** 退场过渡结束后再复位与卸载结果，确保收拢动画与静态侧栏胶囊无缝衔接 */
const MOBILE_CLOSE_MS = 270
const MOBILE_SESSION_CLOSE_MS = 300
const DESKTOP_CLOSE_MS = 210

type SearchResult = { query: string; revision: number; hits: ChatSearchHit[] | null }

/** 命中片段：关键词画黄底，其余保持原样 */
const Segments = ({ segments }: { segments: readonly SearchSegment[] }) => (
  <>
    {segments.map((segment, index) =>
      segment.hit ? (
        <mark key={SEGMENT_KEY(index)} className={styles.mark}>
          {segment.text}
        </mark>
      ) : (
        <span key={SEGMENT_KEY(index)}>{segment.text}</span>
      )
    )}
  </>
)

const englishDate = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const hitDate = (timestamp: number, locale: string) => {
  const date = new Date(timestamp)
  if (locale === 'zh-CN') {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
  }
  return englishDate.format(date)
}

/** 会话列表可能还没渲染完，逐帧等待目标消息挂载后再滚动，最多等 2 秒 */
const scrollToMessage = (messageId: string) => {
  const started = performance.now()
  const step = () => {
    const element = document.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`
    )
    if (element) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    if (performance.now() - started < 2000) {
      requestAnimationFrame(step)
    }
  }
  requestAnimationFrame(step)
}

const ResultRow = ({
  hit,
  locale,
  onOpen,
}: {
  hit: ChatSearchHit
  locale: string
  onOpen: (hit: ChatSearchHit) => void
}) => {
  const t = useTranslate()
  const meta = hit.mode ? getChatModeMeta(hit.mode) : null
  const branch = hit.branch && hit.branch.index > 0 ? hit.branch.index + 1 : 0
  return (
    <button type="button" className={styles.row} onClick={() => onOpen(hit)}>
      <span
        className={styles.modeIcon}
        aria-hidden="true"
        title={meta ? t(meta.labelKey) : undefined}
      >
        {meta?.outlineIcon}
      </span>
      <span className={styles.rowBody}>
        <span className={styles.rowHead}>
          <span className={styles.rowTitle}>
            {hit.title ? <Segments segments={hit.titleSegments} /> : t('untitledChat')}
          </span>
          <span className={styles.rowDate}>{hitDate(hit.updatedAt, locale)}</span>
        </span>
        <span className={styles.rowMeta}>
          {branch ? (
            <span className={styles.branch}>{t('searchBranch', { index: branch })}</span>
          ) : null}
          {hit.attachment ? (
            <span className={styles.fileIcon} aria-hidden="true">
              {hit.attachment.video ? <IconVideoOutline16 /> : <IconFileOutline16 />}
            </span>
          ) : null}
          <span className={styles.snippet}>
            <Segments segments={hit.snippet} />
          </span>
        </span>
      </span>
    </button>
  )
}

/**
 * 全局会话搜索页：侧边栏搜索框或桌面 Ctrl+K 打开。
 * 移动端外壳常驻在侧边栏之上、主对话卡片之下：打开时与主界面右滑、侧栏列表淡出同帧启动，
 * 搜索胶囊从侧边栏原位置平滑右移并向全宽展开；关闭时镜像收拢回侧边栏原位。
 */
export const ChatSearchView = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const open = useChatSearch((state) => state.open)
  const presenting = useChatSearch((state) => state.presenting)
  const closingToSession = useChatSearch((state) => state.closingToSession)
  const mobileSiderOpen = useMobileSider((state) => state.open)
  const sessions = useChatStore((state) => (presenting ? state.sessions : null))
  const revision = useSyncExternalStore(subscribeToSearchChanges, getSearchRevision)

  const [query, setQuery] = useState('')
  // 关闭返回侧栏时保留最后一次结果文案用于 110ms 淡出，避免结果列表瞬间闪没
  const [resultQuery, setResultQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)

  const pageRef = useRef<HTMLDivElement>(null)
  const barInnerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastMeasuredWidthRef = useRef(0)
  const deferredQuery = useDeferredValue(resultQuery.trim())

  /** 读取移动端侧边栏静态搜索胶囊的真实几何位置，写入纯像素变量以保证过渡绝对平滑 */
  const syncCollapsedMetrics = useCallback(() => {
    const page = pageRef.current
    const barInner = barInnerRef.current
    if (!page || !barInner || !isMobile) {
      return
    }
    const entry = document.querySelector<HTMLElement>('[data-mobile-search-entry="true"]')
    if (!entry) {
      return
    }
    const barRect = barInner.getBoundingClientRect()
    const entryRect = entry.getBoundingClientRect()
    if (barRect.width <= 0 || entryRect.width <= 0) {
      return
    }
    const rightInset = Math.max(0, barRect.right - entryRect.right)
    const leftInset = Math.max(0, entryRect.left - barRect.left)
    lastMeasuredWidthRef.current = window.innerWidth
    page.style.setProperty('--search-collapsed-right', `${rightInset}px`)
    page.style.setProperty('--search-collapsed-left', `${leftInset}px`)
  }, [isMobile])

  useLayoutEffect(() => {
    if (!isMobile) {
      pageRef.current?.style.removeProperty('--search-collapsed-right')
      pageRef.current?.style.removeProperty('--search-collapsed-left')
      return
    }
    syncCollapsedMetrics()
    // 仅在横向宽度变化时重测胶囊位置，避免键盘或高度变动期间触发每帧同步回流
    const onResize = () => {
      if (window.innerWidth !== lastMeasuredWidthRef.current) {
        syncCollapsedMetrics()
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isMobile, syncCollapsedMetrics])

  // 每次打开侧边栏或切换搜索开关时校准一次起点/终点坐标（兼容屏幕旋转或安全区变化）
  useLayoutEffect(() => {
    if (isMobile && (mobileSiderOpen || presenting)) {
      syncCollapsedMetrics()
    }
  }, [isMobile, mobileSiderOpen, presenting, syncCollapsedMetrics])

  // 用原生 inert 隔离隐藏态焦点，且在打开提交同帧解除，确保 focus 不被拦截
  useLayoutEffect(() => {
    if (pageRef.current) {
      pageRef.current.inert = !open
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setResultQuery('')
      setResult(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || deferredQuery === '') {
      return
    }
    const controller = new AbortController()
    const showResult = (hits: ChatSearchHit[] | null) => {
      if (!controller.signal.aborted) {
        setResult({ query: deferredQuery, revision, hits })
      }
    }
    void queryChatHistory(deferredQuery, controller.signal).then(showResult, () => showResult(null))
    return () => controller.abort()
  }, [open, deferredQuery, revision])

  // 返回侧边栏时立刻恢复占位文字以便胶囊收拢无缝对接；退场完全结束后再清空结果状态
  useEffect(() => {
    if (open) {
      return
    }
    if (!presenting) {
      setQuery('')
      setResultQuery('')
      setResult(null)
      return
    }
    if (!closingToSession) {
      setQuery('')
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reducedMotion
      ? 0
      : isMobile
        ? closingToSession
          ? MOBILE_SESSION_CLOSE_MS
          : MOBILE_CLOSE_MS
        : DESKTOP_CLOSE_MS
    const timer = window.setTimeout(finishChatSearchClose, duration)
    return () => window.clearTimeout(timer)
  }, [open, presenting, closingToSession, isMobile])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeChatSearch()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open])

  const currentResult =
    result?.query === deferredQuery && (!open || result.revision === revision) ? result : null
  const hits = useMemo(
    () => currentResult?.hits ?? (sessions ? searchSessionTitles(sessions, deferredQuery) : []),
    [currentResult, sessions, deferredQuery]
  )
  const status =
    currentResult === null
      ? t('searchLoading')
      : currentResult.hits === null
        ? t('searchIndexFailed')
        : ''

  const openHit = useCallback((hit: ChatSearchHit) => {
    closeChatSearch({ toSession: true })
    closeMobileSider()
    if (useChatStore.getState().activeId !== hit.sessionId) {
      selectSession(hit.sessionId)
    }
    if (hit.messageId) {
      scrollToMessage(hit.messageId)
    }
  }, [])

  const holding = isMobile && presenting && !open && closingToSession
  const trimmed = resultQuery.trim()

  return (
    <div
      ref={pageRef}
      className={clsx(
        styles.page,
        presenting && styles.pagePresenting,
        open && styles.pageOpen,
        holding && styles.pageHolding
      )}
      data-open={open ? 'true' : undefined}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? 'true' : undefined}
      aria-hidden={!open}
      aria-label={t('searchChats')}
    >
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.bar}>
        <div ref={barInnerRef} className={styles.barInner}>
          <div className={styles.backWrap}>
            <IconButton
              size="m"
              tone={isMobile ? 'primary' : 'tertiary'}
              icon={<IconBackOutline20 />}
              tooltip={t('back')}
              onClick={() => closeChatSearch()}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldIcon} aria-hidden="true">
              <IconSearchOutline16 />
            </span>
            <input
              ref={inputRef}
              className={styles.input}
              type="text"
              value={query}
              placeholder={t('searchChatsPlaceholder')}
              aria-label={t('searchChatsPlaceholder')}
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => {
                const next = event.target.value
                setQuery(next)
                setResultQuery(next)
              }}
            />
            {query ? (
              <button
                type="button"
                className={styles.clear}
                aria-label={t('searchClear')}
                onClick={() => {
                  setQuery('')
                  setResultQuery('')
                  inputRef.current?.focus({ preventScroll: true })
                }}
              >
                <IconCloseFill14 />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className={styles.results}>
        {!presenting || trimmed === '' ? null : hits.length === 0 ? (
          <div className={styles.state} role="status">
            <span>{status || t('searchNoResult')}</span>
            {status ? null : <span className={styles.stateHint}>{t('searchNoResultHint')}</span>}
          </div>
        ) : (
          <div className={styles.list}>
            {hits.map((hit) => (
              <ResultRow
                key={`${hit.sessionId}-${hit.rank}-${hit.messageId ?? ''}-${hit.attachment?.name ?? ''}`}
                hit={hit}
                locale={locale}
                onOpen={openHit}
              />
            ))}
            {status ? (
              <div className={styles.searchStatus} role="status">
                {status}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
