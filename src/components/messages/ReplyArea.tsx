import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useActiveChatBackgroundUrl } from '../../services/chatBackground.js'
import {
  IconBrowseOutline16,
  IconBrowseWarningOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCheckedOutline14,
  IconCloseFill14,
  IconDocumentOutline16,
  IconFileOutline16,
  IconImageOutline16,
  IconLinkOutline16,
  IconLocationOutline16,
  IconLocationWarningOutline16,
  IconRightUpOutline14,
  IconSearchOutline16,
  IconSearchWarningOutline16,
  IconThinkOutline16,
  IconWalletOutline16,
  IconWarningOutline16,
} from '../base/icons.js'
import type { AssistantMessage, MemoryToolStepBlock } from '../../services/chat/types.js'
import {
  getAreaTitle,
  isDeepSearchKind,
  isImageSearchKind,
  type BalanceStep,
  type FindStep,
  type GuideStep,
  type ImageStep,
  type LocationStep,
  type OpenStep,
  type PageItem,
  type ReadLinkStep,
  type ReplyView,
  type SearchStep,
  type Source,
  type Step,
} from '../../services/chat/view.js'
import { Tooltip } from '../base/Tooltip.js'
import { GeneratedImageCard } from './GeneratedImageCard.js'
import {
  openSettingsPage,
  readSettingsPageFromUrl,
} from '../settings/settingsDialogState.js'
import { Markdown } from '../markdown/Markdown.js'
import { SiteThumbnails } from '../search/SiteLogo.js'
import { toggleSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import { useReportThinkStuck } from './scrollContext.js'
import styles from './ReplyArea.module.css'
import './thinking.markdown.css'

/** 进行中时每秒刷新，用于思考用时与搜索词轮播 */
const useTicker = (active: boolean, interval: number) => {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) {
      return
    }
    const timer = setInterval(() => setTick((value) => value + 1), interval)
    return () => clearInterval(timer)
  }, [active, interval])
  return tick
}

/** 查找最近的可纵向滚动祖先容器，供滚动定位与吸顶检测共用 */
const findScrollContainer = (element: HTMLElement | null): HTMLElement | null => {
  let current = element?.parentElement ?? null
  while (current && current !== document.body) {
    if (/auto|scroll/.test(getComputedStyle(current).overflowY)) {
      return current
    }
    current = current.parentElement
  }
  return null
}

/**
 * 思考与工具步骤的时间线：
 * 开启深度思考时带可折叠的标题（正在思考 / 正在搜索 / 正在浏览网页 / 已思考（用时 N 秒））；
 * 未开启时只有工具步骤（如普通搜索的「已阅读 N 个网页」）。
 */
export const ReplyArea = memo(function ReplyArea({
  message,
  view,
  streaming,
  hasResponse,
}: {
  message: AssistantMessage
  view: ReplyView
  streaming: boolean
  hasResponse: boolean
}) {
  useTranslate()
  const isMobile = useIsMobile()
  const hasChatBg = useActiveChatBackgroundUrl() !== null
  const reportThinkStuck = useReportThinkStuck()
  const [open, setOpen] = useState(true)
  const [stuck, setStuck] = useState(false)
  const areaRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const titleActive = streaming && !hasResponse
  useTicker(titleActive, 1000)

  const hasContent = view.steps.length > 0 || Boolean(message.thinking && streaming)
  // 未记录请求开关时，按是否有思考内容显示标题。
  const thinking = message.thinking ?? view.steps.some((step) => step.type === 'thinking')
  const title =
    hasContent && thinking ? getAreaTitle(view, streaming, Date.now(), hasResponse) : null
  const activeSticky = hasContent && Boolean(title) && open

  useEffect(() => {
    if (!activeSticky) {
      setStuck(false)
      return
    }
    const sentinel = sentinelRef.current
    const titleElement = titleRef.current
    const scroller = findScrollContainer(areaRef.current)
    if (!sentinel || !scroller || !titleElement) {
      setStuck(false)
      return
    }
    const inset = Number.parseFloat(getComputedStyle(titleElement).top) || 0
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return
        }
        const rootTop = entry.rootBounds?.top ?? 0
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top <= rootTop)
      },
      { root: scroller, rootMargin: `${-inset}px 0px 0px`, threshold: [0, 1] }
    )
    observer.observe(sentinel)

    // 自定义背景时滚动层延伸至顶栏背后：思考区滚完推走标题时平滑淡出，避免与悬浮顶栏叠字
    if (!hasChatBg || inset <= 0) {
      titleElement.style.removeProperty('opacity')
      return () => observer.disconnect()
    }
    const syncExitFade = () => {
      const topLimit = scroller.getBoundingClientRect().top + inset
      const rect = titleElement.getBoundingClientRect()
      if (rect.top >= topLimit - 0.5) {
        if (titleElement.style.opacity) {
          titleElement.style.removeProperty('opacity')
        }
        return
      }
      const height = Math.max(rect.height, 1)
      const visible = Math.max(0, Math.min(1, (rect.bottom - topLimit) / height))
      titleElement.style.opacity = visible.toFixed(3)
    }
    syncExitFade()
    scroller.addEventListener('scroll', syncExitFade, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', syncExitFade)
      titleElement.style.removeProperty('opacity')
    }
  }, [activeSticky, isMobile, hasChatBg])

  // 同步当前思考区吸顶态给列表顶部连续渐进模糊层，卸载时自动清理
  useEffect(() => {
    const active = activeSticky && stuck
    reportThinkStuck(message.id, active)
    return () => {
      if (active) {
        reportThinkStuck(message.id, false)
      }
    }
  }, [activeSticky, stuck, message.id, reportThinkStuck])

  if (!hasContent) {
    return null
  }
  const stopped = !streaming && !hasResponse

  const toggleOpen = () => {
    if (open && areaRef.current) {
      const scroller = findScrollContainer(areaRef.current)
      if (scroller) {
        const inset = titleRef.current
          ? Number.parseFloat(getComputedStyle(titleRef.current).top) || 0
          : 0
        const areaTop = areaRef.current.getBoundingClientRect().top
        const scrollerTop = scroller.getBoundingClientRect().top
        if (areaTop < scrollerTop + inset + 8) {
          scroller.scrollTop += areaTop - scrollerTop - inset - 8
        }
      }
    }
    setOpen((value) => !value)
  }

  return (
    <div ref={areaRef} className={styles.area}>
      {title ? (
        <div ref={sentinelRef} className={styles.stickySentinel} aria-hidden="true" />
      ) : null}
      {title ? (
        <div
          ref={titleRef}
          className={clsx(
            styles.title,
            open && styles.titleSticky,
            open && stuck && styles.titleStuck
          )}
          onClick={toggleOpen}
        >
          <span className={clsx(styles.titleIcon, stopped && styles.stoppedIcon)}>
            <IconThinkOutline16 />
          </span>
          <span className={clsx(styles.titleText, titleActive && styles.shimmer)}>{title}</span>
          {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
        </div>
      ) : null}
      <div
        className={clsx(styles.stepsCollapse, !(open || !title) && styles.stepsCollapsed)}
        aria-hidden={!(open || !title)}
      >
        <div className={styles.steps}>
          {view.steps.map((step, index) => (
            <StepItem
              key={stepKey(step, index)}
              step={step}
              message={message}
              sources={view.sources}
              streaming={streaming}
              isLast={index === view.steps.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
})

const stepKey = (step: Step, index: number) =>
  step.type === 'thinking' || step.type === 'text' || step.type === 'search'
    ? step.key
    : step.type === 'location'
      ? `location-${step.id}`
      : step.type === 'balance'
        ? `balance-${step.id}`
        : step.type === 'guide'
          ? `guide-${step.id}`
          : step.type === 'image'
            ? `image-${step.id}`
            : step.type === 'memory_tool_step'
              ? `memory-${step.id}`
              : `${step.type}-${index}`

const StepItem = ({
  step,
  message,
  sources,
  streaming,
  isLast,
}: {
  step: Step
  message: AssistantMessage
  sources: Source[]
  streaming: boolean
  isLast: boolean
}) => {
  switch (step.type) {
    case 'thinking': {
      const lastBlock = step.blocks.at(-1)
      const thinking =
        streaming && lastBlock?.startedAt !== undefined && lastBlock.endedAt === undefined
      return (
        <ContentItem isLast={isLast} active={thinking}>
          <Markdown
            content={step.blocks.map((block) => block.thinking).join('')}
            loading={thinking}
            cacheKey={`${message.id}-${step.key}`}
            disableLink
          />
        </ContentItem>
      )
    }
    case 'text':
      return (
        <ContentItem isLast={isLast} active={false}>
          <Markdown
            content={step.markdown}
            loading={streaming && isLast}
            cacheKey={`${message.id}-${step.key}`}
            disableLink={false}
            sources={sources}
          />
        </ContentItem>
      )
    case 'search':
      return <SearchRow step={step} message={message} streaming={streaming} isLast={isLast} />
    case 'open':
      return <OpenRow step={step} sources={sources} isLast={isLast} />
    case 'find':
      return <FindRow step={step} isLast={isLast} />
    case 'read_link':
      return <ReadLinkRow step={step} isLast={isLast} />
    case 'location':
      return <LocationRow step={step} message={message} streaming={streaming} isLast={isLast} />
    case 'balance':
      return <BalanceRow step={step} message={message} streaming={streaming} isLast={isLast} />
    case 'guide':
      return <GuideRow step={step} message={message} streaming={streaming} isLast={isLast} />
    case 'image':
      return <ImageRow step={step} message={message} streaming={streaming} isLast={isLast} />
    case 'memory_tool_step':
      return <HistoryToolRow step={step} isLast={isLast} />
    default:
      return null
  }
}

/** 思考或过程性文字：左侧圆点 + 竖线，小号 markdown */
const ContentItem = ({
  children,
  active,
  isLast,
}: {
  children: ReactNode
  active: boolean
  isLast: boolean
}) => (
  <div className={clsx(styles.content, 'ds-think-content', isLast && styles.lastItem)}>
    <span className={styles.dot}>
      <span className={clsx(styles.dotInner, !active && styles.inactive)} />
    </span>
    {children}
  </div>
)

/** 搜索：普通搜索为「已阅读 N 个网页」，边想边搜为「搜索到 N 个网页」，点击打开搜索结果 */
const SearchRow = ({
  step,
  message,
  streaming,
  isLast,
}: {
  step: SearchStep
  message: AssistantMessage
  streaming: boolean
  isLast: boolean
}) => {
  const t = useTranslate()
  const entry = useSearchPanel((state) => state.entry)
  const wip = step.status === 'wip'
  const tick = useTicker(wip && step.queries.length > 1, 2000)
  const count = step.results.length
  const clickable = !wip && count > 0
  const panelEntry = `${message.id}-search-${step.key}`
  const failed = step.status === 'failed'
  const interrupted = failed && !streaming && message.status === 'stopped'

  let body: ReactNode
  if (wip) {
    body =
      step.queries.length > 0 ? (
        <>
          <span className={styles.prefix}>{t('toolSearchIntro')}</span>
          <span className={styles.query} key={tick}>
            {step.queries[tick % step.queries.length]}
          </span>
        </>
      ) : (
        <span>{t(isImageSearchKind(step.kind) ? 'imageSearching' : 'messageSearching')}</span>
      )
  } else if (interrupted) {
    body = <span>{t('searchStopped')}</span>
  } else if (failed) {
    body = <span>{t('toolSearchFail')}</span>
  } else if (count === 0) {
    body = (
      <span>{t(isDeepSearchKind(step.kind) ? 'toolSearchNoResult' : 'messageSearchNoResult')}</span>
    )
  } else {
    const text = t(
      isDeepSearchKind(step.kind)
        ? count === 1
          ? 'toolSearch1Result'
          : 'toolSearchResults'
        : count === 1
          ? 'messageSearchResult'
          : 'messageSearchResults',
      { count }
    )
    body = (
      <>
        <span className={styles.summary}>{text}</span>
        <SiteThumbnails sources={step.results} />
      </>
    )
  }
  return (
    <div
      className={clsx(
        styles.row,
        !isLast && styles.withLine,
        clickable && styles.clickable,
        entry === panelEntry && styles.active
      )}
      onClick={clickable ? () => toggleSearchPanel(panelEntry, step.results) : undefined}
    >
      <span className={styles.rowIcon}>
        {failed ? <IconSearchWarningOutline16 /> : <IconSearchOutline16 />}
      </span>
      {body}
    </div>
  )
}

/** 工具行外壳：左侧图标，右侧可换行的内容 */
const ToolRow = ({
  icon,
  children,
  isLast,
}: {
  icon: ReactNode
  children: ReactNode
  isLast: boolean
}) => (
  <div className={clsx(styles.tool, !isLast && styles.withLine)}>
    <span className={clsx(styles.rowIcon, styles.toolIcon)}>{icon}</span>
    <div className={styles.toolBody}>{children}</div>
  </div>
)

const historyToolLabels = {
  search: {
    wip: 'toolHistorySearchPending',
    done: 'toolHistorySearchDone',
    failed: 'toolHistorySearchFailed',
    stopped: 'toolHistorySearchStopped',
  },
  read: {
    wip: 'toolHistoryReadPending',
    done: 'toolHistoryReadDone',
    failed: 'toolHistoryReadFailed',
    stopped: 'toolHistoryReadStopped',
  },
} as const

const HistoryToolRow = ({ step, isLast }: { step: MemoryToolStepBlock; isLast: boolean }) => {
  const t = useTranslate()
  const searching = step.action === 'search'
  const failed = step.status === 'failed'
  const icon = searching ? (
    failed ? (
      <IconSearchWarningOutline16 />
    ) : (
      <IconSearchOutline16 />
    )
  ) : failed ? (
    <IconBrowseWarningOutline16 />
  ) : (
    <IconFileOutline16 />
  )
  const matches = searching && step.status === 'done' ? step.matchCount : undefined
  const label =
    matches === 0 ? 'toolHistorySearchEmpty' : historyToolLabels[step.action][step.status]
  return (
    <ToolRow icon={icon} isLast={isLast}>
      <span role="status" className={clsx(styles.intro, step.status === 'wip' && styles.shimmer)}>
        {t(label)}
      </span>
      {matches ? (
        <span className={styles.chip}>
          <span className={styles.chipText}>
            {t(matches === 1 ? 'toolHistorySearchOne' : 'toolHistorySearchMatches', {
              count: matches,
            })}
          </span>
        </span>
      ) : null}
    </ToolRow>
  )
}

const PageLink = ({ page, failedTip }: { page: PageItem; failedTip?: string }) => (
  <span
    className={clsx(styles.page, page.status === 'failed' ? styles.pageFailed : styles.pageDone)}
  >
    {page.status === 'failed' ? (
      <Tooltip content={failedTip}>
        <span className={styles.pageText}>{page.title}</span>
      </Tooltip>
    ) : (
      <a className={styles.pageText} href={page.url} target="_blank" rel="noreferrer">
        {page.title}
      </a>
    )}
    <span className={styles.pageIcon}>
      <IconRightUpOutline14 />
    </span>
  </span>
)

/** 边想边搜打开的网页：「浏览 N 个页面」+ 最多 5 个页面 */
const OpenRow = ({
  step,
  sources,
  isLast,
}: {
  step: OpenStep
  sources: Source[]
  isLast: boolean
}) => {
  const t = useTranslate()
  const allFailed = step.pages.every((page) => page.status === 'failed')
  const count = step.pages.length
  const intro = t(count === 1 ? 'toolOpenOneIntro' : 'toolOpensIntro', { count })
  const panelEntry = `open-${step.pages[0]?.id}`
  return (
    <ToolRow
      icon={allFailed ? <IconBrowseWarningOutline16 /> : <IconBrowseOutline16 />}
      isLast={isLast}
    >
      {allFailed ? (
        t('toolOpenFail')
      ) : (
        <>
          <span className={styles.intro}>{intro}</span>
          {step.pages.slice(0, 5).map((page) => (
            <PageLink key={page.id} page={page} failedTip={t('toolOpenFailTooltip')} />
          ))}
          {count > 5 ? (
            <span
              className={styles.chip}
              onClick={() =>
                toggleSearchPanel(
                  panelEntry,
                  sources.filter((source) => step.pages.some((page) => page.url === source.url))
                )
              }
            >
              {t('toolOpenViewAll')}
            </span>
          ) : null}
        </>
      )}
    </ToolRow>
  )
}

/** 边想边搜的页内查找：「查找关键词」+ 关键词标签 */
const FindRow = ({ step, isLast }: { step: FindStep; isLast: boolean }) => {
  const t = useTranslate()
  const allFailed = step.patterns.every((item) => item.status === 'failed')
  return (
    <ToolRow
      icon={allFailed ? <IconBrowseWarningOutline16 /> : <IconBrowseOutline16 />}
      isLast={isLast}
    >
      {allFailed ? (
        t('toolFindFail')
      ) : (
        <>
          <span className={styles.intro}>{t('toolFindIntro')}</span>
          {step.patterns.map((item) => (
            <Tooltip
              key={item.id}
              content={item.status === 'failed' ? t('toolFindFailTooltip') : null}
            >
              <span className={clsx(styles.chip, item.status === 'failed' && styles.chipFailed)}>
                {item.status === 'wip' ? null : (
                  <span className={styles.chipIcon}>
                    {item.status === 'failed' ? <IconCloseFill14 /> : <IconCheckedOutline14 />}
                  </span>
                )}
                <span className={styles.chipText}>{item.pattern}</span>
              </span>
            </Tooltip>
          ))}
        </>
      )}
    </ToolRow>
  )
}

/** 阅读用户消息中的链接：视图只保留仍在读取的链接。 */
const ReadLinkRow = ({ step, isLast }: { step: ReadLinkStep; isLast: boolean }) => {
  const t = useTranslate()
  return (
    <ToolRow icon={<IconLinkOutline16 />} isLast={isLast}>
      <span className={clsx(styles.intro, styles.shimmer)}>{t('readingLink')}</span>
      {step.links.map((link) => (
        <PageLink key={link.id} page={link} />
      ))}
    </ToolRow>
  )
}

const locationErrorKey = (code?: string) => {
  switch (code) {
    case 'permission_denied':
      return 'toolLocationPermissionDenied'
    case 'precise_location_required':
      return 'toolLocationPreciseRequired'
    case 'location_disabled':
      return 'toolLocationServiceDisabled'
    case 'timeout':
      return 'toolLocationTimeout'
    default:
      return 'toolLocationUnavailable'
  }
}

/** 真实位置工具行：对齐搜索/网页步骤时间线风格 */
const LocationRow = ({
  step,
  message,
  streaming,
  isLast,
}: {
  step: LocationStep
  message: AssistantMessage
  streaming: boolean
  isLast: boolean
}) => {
  const t = useTranslate()
  const wip = step.status === 'wip'
  const failed = step.status === 'failed'
  const interrupted = failed && !streaming && message.status === 'stopped'

  if (wip) {
    return (
      <ToolRow icon={<IconLocationOutline16 />} isLast={isLast}>
        <span className={clsx(styles.intro, styles.shimmer)}>{t('toolLocationPending')}</span>
      </ToolRow>
    )
  }
  if (interrupted) {
    return (
      <ToolRow icon={<IconLocationOutline16 />} isLast={isLast}>
        <span className={styles.intro}>{t('toolLocationStopped')}</span>
      </ToolRow>
    )
  }
  if (failed) {
    return (
      <ToolRow icon={<IconLocationWarningOutline16 />} isLast={isLast}>
        <span className={styles.intro}>
          {t('toolLocationFail')} · {t(locationErrorKey(step.errorCode))}
        </span>
      </ToolRow>
    )
  }
  return (
    <ToolRow icon={<IconLocationOutline16 />} isLast={isLast}>
      <span className={styles.intro}>{t('toolLocationDone')}</span>
      {step.summary ? (
        <span className={styles.chip}>
          <span className={styles.chipText}>{step.summary}</span>
        </span>
      ) : null}
    </ToolRow>
  )
}

const balanceErrorKey = (code?: string) => {
  switch (code) {
    case 'missing_api_key':
      return 'toolBalanceMissingKey'
    case 'unauthorized':
      return 'toolBalanceUnauthorized'
    case 'insufficient_balance':
      return 'toolBalanceInsufficient'
    case 'rate_limited':
      return 'toolBalanceRateLimited'
    case 'network':
      return 'toolBalanceNetwork'
    default:
      return 'toolBalanceUnavailable'
  }
}

/** 账户余额工具行：与定位工具共用时间线样式，金额以芯片展示 */
const BalanceRow = ({
  step,
  message,
  streaming,
  isLast,
}: {
  step: BalanceStep
  message: AssistantMessage
  streaming: boolean
  isLast: boolean
}) => {
  const t = useTranslate()
  const wip = step.status === 'wip'
  const failed = step.status === 'failed'
  const interrupted = failed && !streaming && message.status === 'stopped'

  if (wip) {
    return (
      <ToolRow icon={<IconWalletOutline16 />} isLast={isLast}>
        <span className={clsx(styles.intro, styles.shimmer)}>{t('toolBalancePending')}</span>
      </ToolRow>
    )
  }
  if (interrupted) {
    return (
      <ToolRow icon={<IconWalletOutline16 />} isLast={isLast}>
        <span className={styles.intro}>{t('toolBalanceStopped')}</span>
      </ToolRow>
    )
  }
  if (failed) {
    return (
      <ToolRow icon={<IconWarningOutline16 />} isLast={isLast}>
        <span className={styles.intro}>
          {t('toolBalanceFail')} · {t(balanceErrorKey(step.errorCode))}
        </span>
      </ToolRow>
    )
  }
  return (
    <ToolRow icon={<IconWalletOutline16 />} isLast={isLast}>
      <span className={styles.intro}>{t('toolBalanceDone')}</span>
      {step.summary ? (
        <span className={styles.chip}>
          <span className={styles.chipText}>
            {step.available === false
              ? `${step.summary} · ${t('toolBalanceInsufficient')}`
              : step.summary}
          </span>
        </span>
      ) : null}
    </ToolRow>
  )
}

/** 功能文档工具行：每个命中项一个可点击设置入口，模型正文里也会给出同样的链接 */
const GuideRow = ({
  step,
  message,
  streaming,
  isLast,
}: {
  step: GuideStep
  message: AssistantMessage
  streaming: boolean
  isLast: boolean
}) => {
  const t = useTranslate()
  const wip = step.status === 'wip'
  const failed = step.status === 'failed'
  const interrupted = failed && !streaming && message.status === 'stopped'

  if (wip) {
    return (
      <ToolRow icon={<IconDocumentOutline16 />} isLast={isLast}>
        <span className={clsx(styles.intro, styles.shimmer)}>{t('toolGuidePending')}</span>
      </ToolRow>
    )
  }
  if (interrupted) {
    return (
      <ToolRow icon={<IconDocumentOutline16 />} isLast={isLast}>
        <span className={styles.intro}>{t('toolGuideStopped')}</span>
      </ToolRow>
    )
  }
  if (failed) {
    return (
      <ToolRow icon={<IconWarningOutline16 />} isLast={isLast}>
        <span className={styles.intro}>
          {t('toolGuideFail')}
          {step.errorCode === 'missing_topic' ? ` · ${t('toolGuideMissingTopic')}` : ''}
        </span>
      </ToolRow>
    )
  }
  if (!step.overview && step.items.length === 0) {
    return (
      <ToolRow icon={<IconDocumentOutline16 />} isLast={isLast}>
        <span className={styles.intro}>{t('toolGuideEmpty')}</span>
      </ToolRow>
    )
  }
  return (
    <ToolRow icon={<IconDocumentOutline16 />} isLast={isLast}>
      <span className={styles.intro}>
        {t(step.overview ? 'toolGuideOverview' : 'toolGuideDone')}
      </span>
      {step.overview?.categories.map((category) => (
        <span key={category} className={styles.chip}>
          <span className={styles.chipText}>{category}</span>
        </span>
      ))}
      {step.items.map((item, index) => {
        const page = item.settingsUrl ? readSettingsPageFromUrl(item.settingsUrl) : null
        return page ? (
          <button
            key={`${item.id}-${index}`}
            type="button"
            className={clsx(styles.chip, styles.guideChip)}
            onClick={(event) => {
              event.stopPropagation()
              openSettingsPage(page)
            }}
            title={item.summary}
          >
            <span className={styles.chipText}>
              {item.title} · {t('guideOpenSettings')}
            </span>
          </button>
        ) : (
          <span key={`${item.id}-${index}`} className={styles.chip} title={item.summary}>
            <span className={styles.chipText}>{item.title}</span>
          </span>
        )
      })}
    </ToolRow>
  )
}

const imageErrorKey = (code?: string) => {
  switch (code) {
    case 'missing_blockout':
      return 'toolImageMissingBlockout'
    case 'empty_canvas':
      return 'toolImageEmptyCanvas'
    case 'too_many_instructions':
      return 'toolImageTooComplex'
    case 'unknown_instruction':
    case 'unknown_palette_index':
    case 'invalid_stage':
    case 'invalid_color':
    case 'invalid_palette':
    case 'invalid_argument':
    case 'invalid_point':
    case 'missing_argument':
    case 'missing_color':
    case 'missing_ops':
    case 'missing_point':
    case 'missing_palette':
    case 'palette_too_large':
      return 'toolImageInvalid'
    default:
      return 'toolImageFail'
  }
}

/**
 * 本地绘制的像素画：草图留在时间线里展示两轮过程，成品改到回复正文展示，时间线只留一条状态。
 */
const ImageRow = ({
  step,
  message,
  streaming,
  isLast,
}: {
  step: ImageStep
  message: AssistantMessage
  streaming: boolean
  isLast: boolean
}) => {
  const t = useTranslate()
  const wip = step.status === 'wip'
  const failed = step.status === 'failed'
  const interrupted = failed && !streaming && message.status === 'stopped'
  const title = step.title?.trim() || t('toolImageAlt')

  if (wip) {
    return (
      <ToolRow icon={<IconImageOutline16 />} isLast={isLast}>
        <span className={clsx(styles.intro, styles.shimmer)}>
          {t(step.stage === 'blockout' ? 'toolImageBlockoutPending' : 'toolImagePending')}
        </span>
      </ToolRow>
    )
  }
  if (interrupted) {
    return (
      <ToolRow icon={<IconImageOutline16 />} isLast={isLast}>
        <span className={styles.intro}>{t('toolImageStopped')}</span>
      </ToolRow>
    )
  }
  if (failed || !step.dataUrl) {
    return (
      <ToolRow icon={<IconWarningOutline16 />} isLast={isLast}>
        <span className={styles.intro}>
          {t('toolImageFail')} · {t(imageErrorKey(step.errorCode))}
        </span>
      </ToolRow>
    )
  }
  if (step.stage === 'refine') {
    return (
      <ToolRow icon={<IconImageOutline16 />} isLast={isLast}>
        <span className={styles.intro}>{t('toolImageDone')}</span>
        <span className={styles.chip}>
          <span className={styles.chipText}>{title}</span>
        </span>
      </ToolRow>
    )
  }
  return (
    <ToolRow icon={<IconImageOutline16 />} isLast={isLast}>
      <GeneratedImageCard dataUrl={step.dataUrl} title={title} />
    </ToolRow>
  )
}
