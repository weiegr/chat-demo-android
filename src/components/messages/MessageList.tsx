import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getImeMotionState, hasNativeImeMotion, subscribeImeMotion } from '../../app/imeMotion.js'
import { useIsMobile } from '../../app/viewport.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { selectMessageVersion, useChatStore } from '../../services/chat/store.js'
import type {
  AssistantMessage as AssistantMessageType,
  Session,
} from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { useMobileSider } from '../sider/mobileSiderState.js'
import type { SelectMessageVersion } from './BranchSwitcher.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollToBottomContext, ThinkStuckContext } from './scrollContext.js'
import { cancelUserEdit, useUserEdit } from './userEditState.js'
import { UserMessage } from './UserMessage.js'
import type { Message } from '../../services/chat/types.js'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}
import styles from './MessageList.module.css'

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }
/** 超过该条数后交给浏览器跳过屏幕外消息的布局与绘制 */
const LONG_LIST_THRESHOLD = 120

/**
 * 最后一条回复单独订阅草稿槽：流式增量只重渲染这一条，
 * 历史消息既不重渲染，也不必各自挂一份订阅。
 */
const LiveAssistantMessage = ({
  sessionId,
  message,
  isLast,
  streaming,
  busy,
  readOnly,
  versions,
  onSelectVersion,
}: {
  sessionId: string
  message: AssistantMessageType
  isLast: boolean
  streaming: boolean
  busy: boolean
  readOnly: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) => {
  const draft = useChatStore((state) =>
    Object.hasOwn(state.draftReplies, sessionId) ? state.draftReplies[sessionId] : undefined
  )
  return (
    <AssistantMessage
      sessionId={sessionId}
      message={draft?.id === message.id ? draft : message}
      isLast={isLast}
      streaming={streaming}
      busy={busy}
      readOnly={readOnly}
      versions={versions}
      onSelectVersion={onSelectVersion}
    />
  )
}

export const MessageList = ({
  session,
  streaming,
  footer,
  readOnly = false,
}: {
  session: Session
  streaming: boolean
  footer?: React.ReactNode
  readOnly?: boolean
}) => {
  const isMobile = useIsMobile()
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const topFrostRef = useRef<HTMLDivElement>(null)
  const footerSlotRef = useRef<HTMLDivElement>(null)
  const scrollButtonRef = useRef<HTMLButtonElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
  const stuckThinkIdsRef = useRef(new Set<string>())
  const imeTransitioningRef = useRef(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const messages = useMemo(() => getVisibleMessages(session), [session])
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const lastMessageId = messages.at(-1)?.id

  const syncTopFrostScrolled = useCallback((el: HTMLElement | null) => {
    const frost = topFrostRef.current
    if (!frost || !el) {
      return
    }
    const next = el.scrollTop > 2 ? 'true' : 'false'
    if (frost.dataset.scrolled !== next) {
      frost.dataset.scrolled = next
    }
  }, [])

  const reportThinkStuck = useCallback((id: string, stuck: boolean) => {
    const set = stuckThinkIdsRef.current
    if (stuck) {
      set.add(id)
    } else {
      set.delete(id)
    }
    const frost = topFrostRef.current
    if (frost) {
      const next = set.size > 0 ? 'true' : 'false'
      if (frost.dataset.thinkStuck !== next) {
        frost.dataset.thinkStuck = next
      }
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
      syncTopFrostScrolled(el)
      setShowScrollButton(false)
    }
  }, [syncTopFrostScrolled])

  const editingUserMessage = useUserEdit(
    (state) => !readOnly && state.active?.sessionId === session.id
  )
  const editingUserMessageRef = useRef(editingUserMessage)
  editingUserMessageRef.current = editingUserMessage

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态；编辑态不因输入框增高强行重排滚底。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(() => {
      if (!imeTransitioningRef.current && !editingUserMessageRef.current) {
        scrollToBottom()
      }
    })
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [isMobile, scrollToBottom])

  // 切换版本后将选择器留在原位置，避免回答长短变化导致操作区跳出视口。
  useLayoutEffect(() => {
    const anchor = restoreScrollRef.current
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      if (switcher) {
        scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      }
      restoreScrollRef.current = null
      return
    }
    stickyRef.current = true
    scrollToBottom()
  }, [session.id, lastMessageId, scrollToBottom])

  useEffect(closeSearchPanel, [session.id, lastMessageId])
  useEffect(() => {
    stuckThinkIdsRef.current.clear()
    if (topFrostRef.current) {
      topFrostRef.current.dataset.thinkStuck = 'false'
    }
    if (!readOnly) {
      cancelUserEdit()
    }
  }, [session.id, lastMessageId, readOnly])

  // 移动端进入编辑态时（早于 ChatInput useEffect 拉起软键盘），提前预热 footerSlot 合成层消除首帧冷上传尖峰
  useLayoutEffect(() => {
    if (!isMobile || !hasNativeImeMotion()) {
      return
    }
    const footerSlot = footerSlotRef.current
    if (!footerSlot) {
      return
    }
    if (editingUserMessage) {
      footerSlot.style.willChange = 'transform'
    } else if (!imeTransitioningRef.current && !footerSlot.style.transform) {
      footerSlot.style.removeProperty('will-change')
    }
  }, [editingUserMessage, isMobile])

  useEffect(() => {
    if (!editingUserMessage) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        cancelUserEdit()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editingUserMessage])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (readOnly || streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      cancelUserEdit()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, readOnly, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (stickyRef.current) {
      scrollToBottom()
    } else {
      el.scrollTop = scrollTopRef.current
    }
    syncTopFrostScrolled(el)
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
      syncTopFrostScrolled(el)
      setShowScrollButton(!stickyRef.current && !nearBottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom, syncTopFrostScrolled])

  // Android 原生键盘动效：动画期间以纯 GPU transform 同步托起输入区与底部消息，静止后无缝移交真实底距以保留原生滚动
  useLayoutEffect(() => {
    const container = containerRef.current
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!isMobile || !hasNativeImeMotion() || !container || !scroll || !content) {
      return
    }

    const SMOOTH_SETTLE_TRANSITION = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)'
    const reducedMotion = () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let mode: 'idle' | 'opening' | 'closing' = 'idle'
    let openSticky = true
    let openGapBelow = 0
    let closeStartShift = 0
    let closeDeltaScroll = 0
    let currentContentLift = 0
    let smoothTimer: number | null = null

    const getPaddingBottom = () => Number.parseFloat(container.style.paddingBottom) || 0

    const clearSmoothTransition = () => {
      if (smoothTimer !== null) {
        window.clearTimeout(smoothTimer)
        smoothTimer = null
      }
      footerSlotRef.current?.style.removeProperty('transition')
      content.style.removeProperty('transition')
      scrollButtonRef.current?.style.removeProperty('transition')
    }

    const clearTransforms = () => {
      clearSmoothTransition()
      currentContentLift = 0
      const footerSlot = footerSlotRef.current
      if (footerSlot) {
        footerSlot.style.removeProperty('transform')
        footerSlot.style.removeProperty('will-change')
      }
      content.style.removeProperty('transform')
      content.style.removeProperty('will-change')
      const btn = scrollButtonRef.current
      if (btn) {
        btn.style.removeProperty('transform')
      }
    }

    const applyOpeningTransforms = (shift: number) => {
      const footerSlot = footerSlotRef.current
      const btn = scrollButtonRef.current
      if (shift > 0.05) {
        const footerTx = `translate3d(0, ${(-shift).toFixed(2)}px, 0)`
        if (footerSlot) {
          footerSlot.style.transform = footerTx
        }
        if (btn) {
          btn.style.transform = footerTx
        }
        if (openSticky) {
          const lift = Math.max(0, shift - openGapBelow)
          currentContentLift = lift
          content.style.transform = lift > 0.05 ? `translate3d(0, ${(-lift).toFixed(2)}px, 0)` : ''
        }
      } else {
        currentContentLift = 0
        if (footerSlot) {
          footerSlot.style.removeProperty('transform')
        }
        if (btn) {
          btn.style.removeProperty('transform')
        }
        content.style.removeProperty('transform')
      }
    }

    const applyClosingTransforms = (shift: number) => {
      const footerSlot = footerSlotRef.current
      const btn = scrollButtonRef.current
      if (shift > 0.05) {
        const footerTx = `translate3d(0, ${(-shift).toFixed(2)}px, 0)`
        if (footerSlot) {
          footerSlot.style.transform = footerTx
        }
        if (btn) {
          btn.style.transform = footerTx
        }
        if (closeDeltaScroll > 0.5 && closeStartShift > 0.5) {
          const lift = closeDeltaScroll * Math.min(1, shift / closeStartShift)
          currentContentLift = lift
          content.style.transform = lift > 0.05 ? `translate3d(0, ${(-lift).toFixed(2)}px, 0)` : ''
        }
      } else {
        currentContentLift = 0
        if (footerSlot) {
          footerSlot.style.removeProperty('transform')
        }
        if (btn) {
          btn.style.removeProperty('transform')
        }
        content.style.removeProperty('transform')
      }
    }

    const beginOpening = () => {
      clearSmoothTransition()
      imeTransitioningRef.current = true
      mode = 'opening'
      // 编辑态下 .editMask (position: fixed) 挂在 .column 内：禁止给 .column 挂 transform，
      // 既避免 fixed 遮罩被 transform 劫持错位重建合成层，也保持正在编辑的气泡稳稳停在原位。
      openSticky = !editingUserMessageRef.current && stickyRef.current
      openGapBelow = Math.max(0, scroll.clientHeight - (scroll.scrollHeight - scroll.scrollTop))
      if (footerSlotRef.current) {
        footerSlotRef.current.style.willChange = 'transform'
      }
      if (openSticky) {
        content.style.willChange = 'transform'
      }
    }

    const beginClosing = (fallbackShift: number) => {
      clearSmoothTransition()
      imeTransitioningRef.current = true
      const settledPx = getPaddingBottom()
      if (settledPx > 0.5) {
        const prevScrollTop = scroll.scrollTop
        container.style.removeProperty('padding-bottom')
        closeDeltaScroll = Math.max(0, prevScrollTop - scroll.scrollTop)
        closeStartShift = settledPx
        mode = 'closing'
        if (footerSlotRef.current) {
          footerSlotRef.current.style.willChange = 'transform'
        }
        if (closeDeltaScroll > 0.5) {
          content.style.willChange = 'transform'
        }
        applyClosingTransforms(settledPx)
      } else {
        // 中途打断弹出转收起：尚未移交 padding-bottom，沿用当前内容已抬升的位移平滑降回 0，避免消息区冻在半空再闪现
        mode = 'closing'
        closeStartShift = Math.max(fallbackShift, 1)
        closeDeltaScroll = currentContentLift
        if (footerSlotRef.current) {
          footerSlotRef.current.style.willChange = 'transform'
        }
        if (closeDeltaScroll > 0.5) {
          content.style.willChange = 'transform'
        }
      }
    }

    const settle = (shift: number, smoothSettle = false) => {
      const keepSticky = mode === 'opening' ? openSticky : stickyRef.current
      if (smoothSettle && shift <= 0.5 && !reducedMotion()) {
        const existingPadding = getPaddingBottom()
        if (existingPadding > 0.5) {
          beginClosing(existingPadding)
          // 强制确认起点帧，确保紧随其后的 GPU transition 从原位平滑落底而非瞬间闪现
          void footerSlotRef.current?.offsetHeight
        }
        mode = 'idle'
        closeStartShift = 0
        closeDeltaScroll = 0
        const footerSlot = footerSlotRef.current
        const btn = scrollButtonRef.current
        if (footerSlot) {
          footerSlot.style.willChange = 'transform'
          footerSlot.style.transition = SMOOTH_SETTLE_TRANSITION
          footerSlot.style.transform = 'translate3d(0, 0, 0)'
        }
        if (btn) {
          btn.style.transition = SMOOTH_SETTLE_TRANSITION
          btn.style.transform = 'translate3d(0, 0, 0)'
        }
        if (currentContentLift > 0.5) {
          content.style.willChange = 'transform'
          content.style.transition = SMOOTH_SETTLE_TRANSITION
          content.style.transform = 'translate3d(0, 0, 0)'
        }
        smoothTimer = window.setTimeout(() => {
          smoothTimer = null
          imeTransitioningRef.current = false
          clearTransforms()
        }, 200)
        return
      }
      imeTransitioningRef.current = false
      mode = 'idle'
      closeStartShift = 0
      closeDeltaScroll = 0
      if (shift > 0.5) {
        container.style.paddingBottom = `${shift.toFixed(2)}px`
        clearTransforms()
        if (keepSticky && !editingUserMessageRef.current) {
          scroll.scrollTop = scroll.scrollHeight
          scrollTopRef.current = scroll.scrollTop
        }
      } else {
        container.style.removeProperty('padding-bottom')
        clearTransforms()
      }
    }

    const initial = getImeMotionState()
    if (!useMobileSider.getState().open) {
      if (!initial.animating && initial.settled > 0.5) {
        settle(initial.settled)
      } else if (initial.animating && initial.shift > 0.5) {
        if (initial.opening) {
          beginOpening()
          applyOpeningTransforms(initial.shift)
        } else {
          beginClosing(initial.shift)
          applyClosingTransforms(initial.shift)
        }
      }
    }

    const isLifted = () =>
      mode !== 'idle' ||
      getPaddingBottom() > 0.5 ||
      currentContentLift > 0.5 ||
      Boolean(footerSlotRef.current?.style.transform)

    const unsubscribe = subscribeImeMotion((phase, ime) => {
      // 移动端侧边栏打开期间（如侧栏重命名会话）弹起键盘时，保持右侧露出的对话页与输入区静止
      if (useMobileSider.getState().open && !isLifted()) {
        return
      }
      if (phase === 'prepare') {
        clearSmoothTransition()
        if (getPaddingBottom() <= 0.5) {
          beginOpening()
        }
        return
      }
      if (phase === 'start') {
        if (ime.opening) {
          if (getPaddingBottom() > 0.5) {
            container.style.removeProperty('padding-bottom')
          }
          beginOpening()
          applyOpeningTransforms(ime.shift)
        } else {
          beginClosing(ime.shift || ime.settled)
        }
        return
      }
      if (phase === 'progress') {
        clearSmoothTransition()
        if (mode === 'closing') {
          applyClosingTransforms(ime.shift)
        } else {
          if (mode === 'idle') {
            beginOpening()
          }
          applyOpeningTransforms(ime.shift)
        }
        return
      }
      settle(ime.shift, ime.smoothSettle)
    })

    return () => {
      unsubscribe()
      imeTransitioningRef.current = false
      container.style.removeProperty('padding-bottom')
      clearTransforms()
    }
  }, [isMobile])

  const lastIndex = messages.length - 1
  const uploadRetryId = readOnly ? null : getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <ThinkStuckContext.Provider value={reportThinkStuck}>
        <div ref={isMobile ? containerRef : scrollRef} className={styles.container}>
          <div className={styles.scrollArea}>
            <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
              <div
                ref={topFrostRef}
                className={clsx(styles.topFrost, editingUserMessage && styles.topFrostHidden)}
                data-read-only={readOnly ? 'true' : undefined}
                aria-hidden="true"
              />
              <div
                ref={contentRef}
                className={styles.column}
                data-inset-header={readOnly ? undefined : 'true'}
                data-long={messages.length > LONG_LIST_THRESHOLD ? 'true' : undefined}
              >
                {editingUserMessage ? (
                  <div data-open="true" className={styles.editMask} onClick={cancelUserEdit} />
                ) : null}
                {messages.map((message, index) =>
                  message.role === 'user' ? (
                    <UserMessage
                      key={message.id}
                      sessionId={session.id}
                      message={message}
                      retryUploadId={uploadRetryId}
                      isFirst={index === 0}
                      isLast={index === lastIndex || index === lastIndex - 1}
                      busy={streaming}
                      readOnly={readOnly}
                      versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                      onSelectVersion={selectVersion}
                    />
                  ) : index === lastIndex ? (
                    <LiveAssistantMessage
                      key={message.id}
                      sessionId={session.id}
                      message={message}
                      isLast
                      streaming={streaming}
                      busy={streaming}
                      readOnly={readOnly}
                      versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                      onSelectVersion={selectVersion}
                    />
                  ) : (
                    <AssistantMessage
                      key={message.id}
                      sessionId={session.id}
                      message={message}
                      isLast={false}
                      streaming={false}
                      busy={streaming}
                      readOnly={readOnly}
                      versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                      onSelectVersion={selectVersion}
                    />
                  )
                )}
              </div>
            </div>
            {isMobile && showScrollButton && !editingUserMessage ? (
              <button
                ref={scrollButtonRef}
                type="button"
                className={styles.scrollBottomButton}
                aria-label="Scroll to bottom"
                onClick={() => {
                  stickyRef.current = true
                  scrollToBottom()
                }}
              >
                <IconChevronDownOutline14 />
              </button>
            ) : null}
          </div>
          {footer ? (
            <div ref={footerSlotRef} className={styles.footerSlot}>
              {footer}
            </div>
          ) : null}
        </div>
      </ThinkStuckContext.Provider>
    </ScrollToBottomContext.Provider>
  )
}
