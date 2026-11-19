import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import type { SelectMessageVersion } from './BranchSwitcher.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollToBottomContext } from './scrollContext.js'
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
  versions,
  onSelectVersion,
}: {
  sessionId: string
  message: AssistantMessageType
  isLast: boolean
  streaming: boolean
  busy: boolean
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
      versions={versions}
      onSelectVersion={onSelectVersion}
    />
  )
}

export const MessageList = ({
  session,
  streaming,
  footer,
}: {
  session: Session
  streaming: boolean
  footer: React.ReactNode
}) => {
  const isMobile = useIsMobile()
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const scrollTopRef = useRef(0)
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
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight
      scrollTopRef.current = el.scrollTop
      setShowScrollButton(false)
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(scrollToBottom)
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
  useEffect(cancelUserEdit, [session.id, lastMessageId])

  const editingUserMessage = useUserEdit((state) => state.active?.sessionId === session.id)
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
      if (streaming) {
        return
      }
      restoreScrollRef.current = { messageId, top: anchorTop }
      stickyRef.current = false
      closeSearchPanel()
      cancelUserEdit()
      selectMessageVersion(session.id, messageId)
    },
    [session.id, streaming]
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
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD
      // 仅在用户向上滚动时停止跟随底部，布局或内容增高时保持跟随状态。
      if (nearBottom) {
        stickyRef.current = true
      } else if (el.scrollTop < scrollTopRef.current) {
        stickyRef.current = false
      }
      scrollTopRef.current = el.scrollTop
      setShowScrollButton(!stickyRef.current && !nearBottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isMobile, scrollToBottom])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  return (
    <ScrollToBottomContext.Provider value={scrollToBottom}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container}>
        <div className={styles.scrollArea}>
          <div ref={isMobile ? scrollRef : undefined} className={styles.scroll}>
            <div
              ref={contentRef}
              className={styles.column}
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
                    versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                    onSelectVersion={selectVersion}
                  />
                )
              )}
            </div>
          </div>
          {isMobile && showScrollButton && !editingUserMessage ? (
            <button
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
        {footer}
      </div>
    </ScrollToBottomContext.Provider>
  )
}
