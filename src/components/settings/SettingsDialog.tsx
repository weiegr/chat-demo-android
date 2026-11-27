import clsx from 'clsx'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import {
  IconChevronRightOutline14,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconRightUpOutline14,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  canOpenExportFolder,
  clearHistory,
  exportAndSaveHistory,
  getLastExportRecord,
  importHistory,
  importHistoryFromUrl,
  openExportFolder,
  parseArchiveDownloadUrl,
  type ExportRecord,
  type HistoryImportProgress,
  type HistoryUrlImportProgress,
} from '../../services/chat/backup.js'
import { formatSize } from '../../services/attachments.js'
import { useIsMobile } from '../../app/viewport.js'
import {
  MAX_ACCOUNT_NICKNAME_LENGTH,
  getAccountDisplayLabel,
  setMockAccountNickname,
  setMockAccountUseNicknameInReply,
  useMockAccount,
} from '../../services/account.js'
import { subscribeDeviceTilt } from '../../services/deviceTilt.js'
import { useChatStore } from '../../services/chat/store.js'
import { useGlobalMemory } from '../../services/chat/globalMemory.js'
import {
  setAutoReadAloud,
  setAllowVideoUpload,
  setLocale,
  setPersonalCenterEnabled,
  setThemePreference,
  setTtsVoice,
  setVideoAudioEnabled,
  useSettings,
  type Locale,
  type ThemePreference,
} from '../../services/settings.js'
import { hasVideoAudioSupport } from '../../services/video/audio.js'
import type { TtsVoice } from '../../services/api/speech.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import { usePresence } from '../base/usePresence.js'
import {
  AccountAvatar,
  AccountImagePickerControls,
  useAvatarPicker,
  useCoverPicker,
} from './AccountAvatar.js'
import { ApiKeySetting } from './ApiKeyField.js'
import { AppBackgroundPage, ChatBackgroundPage } from './ChatBackgroundSettings.js'
import { LiveAvatarPage } from './LiveAvatarSettings.js'
import { GlobalMemoryPage, MemoryFilePage } from './GlobalMemorySettings.js'
import { InfoModalButton } from './InfoModalButton.js'
import {
  AiLocationSetting,
  LocationSetting,
  MobileLocationNavRow,
  MobileLocationPage,
} from './LocationSettings.js'
import { MobileActionCard } from './MobileActionCard.js'
import { QuickCameraShortcutSetting } from './QuickCameraShortcutSetting.js'
import {
  MobileSystemPromptNavRow,
  MobileSystemPromptPage,
  SystemPromptSetting,
} from './SystemPromptSettings.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import { useHeroMagneticSnap } from './useHeroMagneticSnap.js'
import {
  desktopSettingsPage,
  mobileSettingsPath,
  settingsPageSection,
} from '../../services/settingsPages.js'
import styles from './Settings.module.css'

type MobileRootSubPage =
  | 'data'
  | 'personalCenter'
  | 'nickname'
  | 'appBackground'
  | 'liveAvatar'
  | 'importSessions'
  | 'exportInfo'
  | 'voiceBroadcast'
  | 'videoUpload'
  | 'location'
  | 'systemPrompt'
  | 'globalMemory'
type MemoryPage = 'globalMemory' | 'memoryFile'
type MobileL2SubPage = MemoryPage | 'chatBackground'
type DesktopSubPage =
  | MemoryPage
  | 'personalCenter'
  | 'appBackground'
  | 'chatBackground'
  | 'liveAvatar'
type MobileSubPage = MobileRootSubPage | MobileL2SubPage

/** Beta 移动端头图完全折叠为顶栏所需的滑动距离（px）：头图高度 340 - 顶栏高度 56 */
const HERO_COLLAPSE_DISTANCE = 284
const HERO_AVATAR_START_SIZE = 88
const HERO_AVATAR_LARGE_START_SIZE = 108
const HERO_AVATAR_END_SIZE = 34

const clamp01 = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value)

const APP_VERSION =
  typeof document !== 'undefined'
    ? document.querySelector('meta[name="application-version"]')?.getAttribute('content')?.trim() ||
      ''
    : ''

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface HeroParallaxTargets {
  bg: HTMLElement | null
  avatar3d: HTMLElement | null
  avatarShadow: HTMLElement | null
  avatarSheen: HTMLElement | null
  avatarEdit: HTMLElement | null
  coverEdit: HTMLElement | null
  identity: HTMLElement | null
}

/**
 * 统一的多层 3D 视差映射：
 * 背景向反方向退后，账号名居中景，头像向前微浮并做 3D 透视倾转（配球面流动光泽与反向投影），
 * 头像编辑按钮位于最前景，形成清晰的四层空间纵深。
 */
const applyHeroParallax = (
  targets: HeroParallaxTargets,
  x: number,
  y: number,
  weight: number,
  scale = 1
) => {
  const tx = x * weight
  const ty = y * weight
  const tiltMag = Math.min(1, Math.hypot(tx, ty))

  if (targets.bg) {
    targets.bg.style.transform = `translate3d(${(-tx * 13 * scale).toFixed(2)}px, ${(-ty * 10 * scale).toFixed(2)}px, 0) scale(1.02)`
  }
  if (targets.avatar3d) {
    targets.avatar3d.style.transform = `perspective(520px) translate3d(${(tx * 10 * scale).toFixed(2)}px, ${(ty * 8 * scale).toFixed(2)}px, 0) rotateY(${(tx * 13 * scale).toFixed(2)}deg) rotateX(${(-ty * 11 * scale).toFixed(2)}deg)`
  }
  if (targets.avatarShadow) {
    targets.avatarShadow.style.transform = `translate3d(${(-tx * 9 * scale).toFixed(2)}px, ${(7 * scale - ty * 6 * scale).toFixed(2)}px, 0) scale(${(0.94 + 0.04 * weight).toFixed(3)})`
    targets.avatarShadow.style.opacity = (0.9 * weight).toFixed(3)
  }
  if (targets.avatarSheen) {
    targets.avatarSheen.style.transform = `translate3d(${(tx * 24 * scale).toFixed(2)}px, ${(ty * 22 * scale).toFixed(2)}px, 0)`
    targets.avatarSheen.style.opacity = ((0.22 + 0.46 * tiltMag) * weight).toFixed(3)
  }
  if (targets.avatarEdit) {
    targets.avatarEdit.style.transform = `perspective(520px) translate3d(${(tx * 14 * scale).toFixed(2)}px, ${(ty * 11 * scale).toFixed(2)}px, 0) rotateY(${(tx * 9 * scale).toFixed(2)}deg) rotateX(${(-ty * 8 * scale).toFixed(2)}deg)`
  }
  if (targets.coverEdit) {
    targets.coverEdit.style.transform = `translate3d(${(tx * 5 * scale).toFixed(2)}px, ${(ty * 4 * scale).toFixed(2)}px, 0)`
  }
  if (targets.identity) {
    targets.identity.style.transform = `translate3d(${(tx * 5.5 * scale).toFixed(2)}px, ${(ty * 4.5 * scale).toFixed(2)}px, 0)`
  }
}

const DesktopAccountHero = ({
  avatarDataUrl,
  coverDataUrl,
  accountLabel,
  avatarAriaLabel,
  coverAriaLabel,
  onEditAvatar,
  onEditCover,
}: {
  avatarDataUrl: string | null
  coverDataUrl: string | null
  accountLabel: string
  avatarAriaLabel: string
  coverAriaLabel: string
  onEditAvatar: () => void
  onEditCover: () => void
}) => {
  const bgParallaxRef = useRef<HTMLDivElement>(null)
  const avatar3dRef = useRef<HTMLDivElement>(null)
  const avatarShadowRef = useRef<HTMLDivElement>(null)
  const avatarSheenRef = useRef<HTMLSpanElement>(null)
  const avatarEditParallaxRef = useRef<HTMLSpanElement>(null)
  const coverEditParallaxRef = useRef<HTMLSpanElement>(null)
  const identityParallaxRef = useRef<HTMLSpanElement>(null)
  const targetRef = useRef({ x: 0, y: 0 })
  const currentRef = useRef({ x: 0, y: 0 })
  const rafRef = useRef(0)
  const lastFrameRef = useRef(0)

  const getTargets = useCallback(
    (): HeroParallaxTargets => ({
      bg: bgParallaxRef.current,
      avatar3d: avatar3dRef.current,
      avatarShadow: avatarShadowRef.current,
      avatarSheen: avatarSheenRef.current,
      avatarEdit: avatarEditParallaxRef.current,
      coverEdit: coverEditParallaxRef.current,
      identity: identityParallaxRef.current,
    }),
    []
  )

  const wakeLoop = useCallback(() => {
    if (rafRef.current || prefersReducedMotion()) {
      return
    }
    lastFrameRef.current = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(Math.max((now - lastFrameRef.current) / 1000, 0), 0.05)
      lastFrameRef.current = now
      const alpha = 1 - Math.exp(-dt * 11)
      const curr = currentRef.current
      const tgt = targetRef.current
      curr.x += (tgt.x - curr.x) * alpha
      curr.y += (tgt.y - curr.y) * alpha
      const settled = Math.abs(tgt.x - curr.x) < 0.001 && Math.abs(tgt.y - curr.y) < 0.001
      if (settled) {
        curr.x = tgt.x
        curr.y = tgt.y
      }
      applyHeroParallax(getTargets(), curr.x, curr.y, 1, 0.78)
      if (settled) {
        rafRef.current = 0
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [getTargets])

  useEffect(() => {
    applyHeroParallax(getTargets(), 0, 0, 1, 0.78)
    return () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [getTargets])

  return (
    <div
      className={styles.desktopAccountHero}
      onPointerMove={(event) => {
        if (prefersReducedMotion()) {
          return
        }
        const rect = event.currentTarget.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
          return
        }
        const nx = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2))
        const ny = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2))
        targetRef.current.x = nx
        targetRef.current.y = ny
        wakeLoop()
      }}
      onPointerLeave={() => {
        targetRef.current.x = 0
        targetRef.current.y = 0
        wakeLoop()
      }}
    >
      <div className={styles.desktopAccountHeroBg} aria-hidden="true">
        <div ref={bgParallaxRef} className={styles.desktopAccountHeroBgParallax}>
          {coverDataUrl ? (
            <>
              <img
                src={coverDataUrl}
                alt=""
                draggable={false}
                className={styles.mobileHeroCoverImage}
              />
              <div className={styles.mobileHeroCoverScrim} />
            </>
          ) : null}
        </div>
      </div>
      <div
        className={clsx(
          styles.desktopAccountHeroCenter,
          !accountLabel && styles.desktopAccountHeroCenterAvatarOnly
        )}
      >
        <div
          className={clsx(
            styles.desktopHeroAvatarWrap,
            !accountLabel && styles.desktopHeroAvatarLarge
          )}
        >
          <div ref={avatarShadowRef} className={styles.heroAvatarShadow} aria-hidden="true" />
          <div ref={avatar3dRef} className={styles.heroAvatar3d}>
            <button
              type="button"
              className={styles.floatingAvatarHit}
              aria-label={avatarAriaLabel}
              onClick={onEditAvatar}
            >
              <AccountAvatar
                src={avatarDataUrl}
                className={styles.desktopHeroAvatarCircle}
                iconClassName={styles.desktopHeroAvatarIcon}
              />
              <span ref={avatarSheenRef} className={styles.heroAvatarSheen} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className={clsx(
              styles.heroAvatarEditButton,
              styles.desktopHeroAvatarEditButton,
              coverDataUrl && styles.heroEditOnCover
            )}
            aria-label={avatarAriaLabel}
            onClick={onEditAvatar}
          >
            <span ref={avatarEditParallaxRef} className={styles.heroParallaxLayer}>
              <IconEditOutline16 />
            </span>
          </button>
        </div>
        {accountLabel ? (
          <span
            ref={identityParallaxRef}
            className={clsx(
              styles.desktopHeroAccountLabel,
              coverDataUrl && styles.heroLabelOnCover
            )}
          >
            {accountLabel}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className={clsx(
          styles.heroCoverEditButton,
          styles.desktopHeroCoverEditButton,
          coverDataUrl && styles.heroEditOnCover
        )}
        aria-label={coverAriaLabel}
        onClick={onEditCover}
      >
        <span ref={coverEditParallaxRef} className={styles.heroParallaxLayer}>
          <IconEditOutline16 />
        </span>
      </button>
    </div>
  )
}

const readSafeTop = () => {
  const parsed = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--safe-top')
  )
  return Number.isFinite(parsed) ? parsed : 0
}

const MOBILE_SUB_TITLE_KEY: Record<MobileSubPage, TranslationKey> = {
  data: 'settingDialogAsideDataOptionLabel',
  personalCenter: 'settingsPersonalCenter',
  nickname: 'settingsNickname',
  appBackground: 'settingsAppBackground',
  chatBackground: 'settingsChatBackground',
  liveAvatar: 'settingsLiveAvatar',
  importSessions: 'importSessionsTitle',
  exportInfo: 'exportInfoTitle',
  voiceBroadcast: 'settingsVoiceBroadcast',
  videoUpload: 'settingsVideoUpload',
  location: 'settingsLocation',
  systemPrompt: 'settingsSystemPrompt',
  globalMemory: 'globalMemory',
  memoryFile: 'memoryFile',
}

/** 移动端二级/三级推入页面层：负责视差压栈、滚动顶栏分割线感知与底层 inert 隔离 */
const MobileSubLayer = ({
  visible,
  pushed,
  level,
  onScrolledChange,
  children,
}: {
  visible: boolean
  pushed: boolean
  level: 1 | 2 | 3
  onScrolledChange?: (level: 1 | 2 | 3, scrolled: boolean) => void
  children: ReactNode
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const prevPushedRef = useRef(pushed)
  const onScrolledChangeRef = useRef(onScrolledChange)
  onScrolledChangeRef.current = onScrolledChange

  useEffect(() => {
    if (ref.current) {
      ref.current.inert = pushed
    }
  }, [pushed])

  // 仅在从更深层级退栈回到本层时重新读取真实滚动位置，避免首次推入动画首帧触发同步强制布局
  useEffect(() => {
    const returnedToTop = prevPushedRef.current && !pushed
    prevPushedRef.current = pushed
    if (!visible) {
      onScrolledChangeRef.current?.(level, false)
      return
    }
    if (!returnedToTop) {
      return
    }
    const scroller = ref.current?.firstElementChild
    const scrolled =
      scroller instanceof HTMLElement &&
      scroller.scrollTop > 2 &&
      scroller.scrollHeight > scroller.clientHeight + 1
    onScrolledChangeRef.current?.(level, scrolled)
  }, [visible, pushed, level])

  return (
    <div
      ref={ref}
      aria-hidden={pushed || undefined}
      style={{ zIndex: level + 1 }}
      className={clsx(
        styles.mobileSubPage,
        visible && styles.mobileSubPageVisible,
        pushed && styles.mobileSubPagePushed
      )}
      onScrollCapture={(event) => {
        const target = event.target
        if (!(target instanceof HTMLElement) || target.parentElement !== ref.current) {
          return
        }
        const scrolled = target.scrollTop > 2 && target.scrollHeight > target.clientHeight + 1
        onScrolledChangeRef.current?.(level, scrolled)
      }}
    >
      {children}
    </div>
  )
}

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为右侧滑入全屏页、二级子页带原生 Push/Pop 视差过渡
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  const presence = usePresence(open, 280)
  useEffect(() => {
    if (!presence.mounted && !useHistoryImportState.getState().busy) {
      useHistoryImportState.setState({ status: null })
    }
  }, [presence.mounted])
  return presence.mounted ? <SettingsContent open={open} visible={presence.visible} /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = ({ open, visible }: { open: boolean; visible: boolean }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const personalCenterEnabled = useSettings((state) => state.personalCenterEnabled)
  const betaMobile = __BETA__ && isMobile
  const immersiveMobile = betaMobile && personalCenterEnabled
  const account = useMockAccount()
  const accountLabel = getAccountDisplayLabel(account)
  const hasAccountLabel = accountLabel.length > 0
  const avatarPicker = useAvatarPicker()
  const coverPicker = useCoverPicker()
  const storeSection = useSettingsDialog((state) => state.section)
  const storePage = useSettingsDialog((state) => state.page)
  // 打开时按调用方指定的分组选中，之后在弹窗内切换；退场未结束时快速重开同步复位
  const [section, setSection] = useState<SettingsSection>(storeSection)
  const [mobileStack, setMobileStack] = useState<MobileSubPage[]>([])
  const [renderedL1, setRenderedL1] = useState<MobileRootSubPage | null>(null)
  const [renderedL2, setRenderedL2] = useState<MobileL2SubPage | null>(null)
  const [renderedL3, setRenderedL3] = useState<'memoryFile' | null>(null)
  const [desktopSubPage, setDesktopSubPage] = useState<DesktopSubPage | null>(null)
  const memoryEnabled = useGlobalMemory((state) => state.profile.enabled)
  const prevOpenRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const mobileMainRef = useRef<HTMLDivElement>(null)
  const mobileScrollRef = useRef<HTMLDivElement>(null)
  const mobilePlainScrollRef = useRef<HTMLDivElement>(null)
  const heroBgRef = useRef<HTMLDivElement>(null)
  const heroBgParallaxRef = useRef<HTMLDivElement>(null)
  const heroIdentityRef = useRef<HTMLDivElement>(null)
  const identityParallaxRef = useRef<HTMLSpanElement>(null)
  const coverEditRef = useRef<HTMLButtonElement>(null)
  const coverEditParallaxRef = useRef<HTMLSpanElement>(null)
  const sheetGlassRef = useRef<HTMLDivElement>(null)
  const sheetSolidRef = useRef<HTMLDivElement>(null)
  const dataCardRef = useRef<HTMLDivElement>(null)
  const backButtonRef = useRef<HTMLButtonElement>(null)
  const headerBgRef = useRef<HTMLDivElement>(null)
  const headerDividerRef = useRef<HTMLDivElement>(null)
  const rootTitleRef = useRef<HTMLSpanElement>(null)
  const heroMetricsRef = useRef({ containerWidth: 0, safeTop: 0 })
  const heroScrollRafRef = useRef(0)
  const pendingHeroScrollTopRef = useRef(0)
  const lastHeroScrollTopRef = useRef(-1)
  const layerScrolledRef = useRef<Record<0 | 1 | 2 | 3, boolean>>({
    0: false,
    1: false,
    2: false,
    3: false,
  })
  const activeDepthRef = useRef<0 | 1 | 2 | 3>(0)

  const syncHeaderDivider = useCallback(() => {
    const divider = headerDividerRef.current
    if (!divider) {
      return
    }
    const depth = activeDepthRef.current
    divider.classList.toggle(styles.mobileHeaderDividerVisible, layerScrolledRef.current[depth])
  }, [])

  const handleSubLayerScrolledChange = useCallback(
    (level: 1 | 2 | 3, scrolled: boolean) => {
      if (layerScrolledRef.current[level] === scrolled) {
        return
      }
      layerScrolledRef.current[level] = scrolled
      syncHeaderDivider()
    },
    [syncHeaderDivider]
  )
  const floatingAvatarRef = useRef<HTMLDivElement>(null)
  const avatar3dRef = useRef<HTMLDivElement>(null)
  const avatarShadowRef = useRef<HTMLDivElement>(null)
  const avatarSheenRef = useRef<HTMLSpanElement>(null)
  const editBadgeRef = useRef<HTMLButtonElement>(null)
  const avatarEditParallaxRef = useRef<HTMLSpanElement>(null)
  const collapseProgressRef = useRef(0)
  const tiltTargetRef = useRef({ x: 0, y: 0 })
  const tiltCurrentRef = useRef({ x: 0, y: 0 })
  const tiltWeightRef = useRef(1)
  const tiltRafRef = useRef(0)
  const tiltLastFrameRef = useRef(0)

  const getMobileParallaxTargets = useCallback(
    (): HeroParallaxTargets => ({
      bg: heroBgParallaxRef.current,
      avatar3d: avatar3dRef.current,
      avatarShadow: avatarShadowRef.current,
      avatarSheen: avatarSheenRef.current,
      avatarEdit: avatarEditParallaxRef.current,
      coverEdit: coverEditParallaxRef.current,
      identity: identityParallaxRef.current,
    }),
    []
  )

  const wakeTiltLoop = useCallback(() => {
    if (tiltRafRef.current) {
      return
    }
    tiltLastFrameRef.current = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(Math.max((now - tiltLastFrameRef.current) / 1000, 0), 0.05)
      tiltLastFrameRef.current = now
      const alpha = 1 - Math.exp(-dt * 10)
      const weight = clamp01(1 - collapseProgressRef.current / 0.55)
      const reduced = prefersReducedMotion()
      const targetX = reduced ? 0 : tiltTargetRef.current.x
      const targetY = reduced ? 0 : tiltTargetRef.current.y
      const curr = tiltCurrentRef.current
      curr.x += (targetX - curr.x) * alpha
      curr.y += (targetY - curr.y) * alpha
      tiltWeightRef.current += (weight - tiltWeightRef.current) * alpha
      const settled =
        Math.abs(targetX - curr.x) < 0.001 &&
        Math.abs(targetY - curr.y) < 0.001 &&
        Math.abs(weight - tiltWeightRef.current) < 0.002
      if (settled) {
        curr.x = targetX
        curr.y = targetY
        tiltWeightRef.current = weight
      }
      applyHeroParallax(getMobileParallaxTargets(), curr.x, curr.y, tiltWeightRef.current)
      if (settled) {
        tiltRafRef.current = 0
        return
      }
      tiltRafRef.current = requestAnimationFrame(tick)
    }
    tiltRafRef.current = requestAnimationFrame(tick)
  }, [getMobileParallaxTargets])

  const refreshHeroMetrics = useCallback(() => {
    const containerWidth =
      mobileMainRef.current?.clientWidth ||
      mobileScrollRef.current?.clientWidth ||
      window.innerWidth
    const safeTop = readSafeTop()
    const prev = heroMetricsRef.current
    const changed = prev.containerWidth !== containerWidth || prev.safeTop !== safeTop
    heroMetricsRef.current = { containerWidth, safeTop }
    return changed
  }, [])

  const applyHeroScroll = useCallback(
    (scrollTop: number, force = false) => {
      if (!force && lastHeroScrollTopRef.current === scrollTop) {
        return
      }
      lastHeroScrollTopRef.current = scrollTop
      const progress = clamp01(scrollTop / HERO_COLLAPSE_DISTANCE)
      collapseProgressRef.current = progress

      if (heroMetricsRef.current.containerWidth <= 0) {
        refreshHeroMetrics()
      }
      const { containerWidth, safeTop } = heroMetricsRef.current

      if (heroBgRef.current) {
        const bgOpacity = clamp01(1 - progress / 0.92)
        const bgShift = -Math.min(Math.max(0, scrollTop), HERO_COLLAPSE_DISTANCE) * 0.24
        heroBgRef.current.style.opacity = bgOpacity.toFixed(3)
        heroBgRef.current.style.transform = `translate3d(0, ${bgShift.toFixed(2)}px, 0)`
      }

      if (sheetSolidRef.current) {
        const solidOpacity = clamp01((progress - 0.2) / 0.72)
        sheetSolidRef.current.style.opacity = solidOpacity.toFixed(3)
      }

      if (sheetGlassRef.current) {
        sheetGlassRef.current.classList.toggle(styles.mobileSettingsSheetGlassOff, progress >= 0.72)
      }

      if (dataCardRef.current) {
        dataCardRef.current.classList.toggle(styles.mobileGlassCardSolid, progress >= 0.82)
      }

      if (backButtonRef.current) {
        backButtonRef.current.classList.toggle(styles.mobileBackButtonSolid, progress >= 0.82)
      }

      if (heroIdentityRef.current) {
        const idOpacity = clamp01(1 - progress / 0.42)
        heroIdentityRef.current.style.opacity = idOpacity.toFixed(3)
        heroIdentityRef.current.style.transform = `translate3d(0, ${(-progress * 18).toFixed(2)}px, 0)`
      }

      if (coverEditRef.current) {
        const coverBtnProgress = clamp01(1 - progress / 0.38)
        coverEditRef.current.style.opacity = coverBtnProgress.toFixed(3)
        coverEditRef.current.style.transform = `scale(${(0.7 + 0.3 * coverBtnProgress).toFixed(3)})`
        coverEditRef.current.style.pointerEvents = progress > 0.3 ? 'none' : 'auto'
      }

      if (headerBgRef.current) {
        const barOpacity = clamp01((progress - 0.68) / 0.32)
        headerBgRef.current.style.opacity = barOpacity.toFixed(3)
      }

      layerScrolledRef.current[0] = scrollTop > 2 && progress >= 0.88
      syncHeaderDivider()

      if (rootTitleRef.current) {
        const titleProgress = clamp01((progress - 0.62) / 0.38)
        rootTitleRef.current.style.opacity = titleProgress.toFixed(3)
        rootTitleRef.current.style.transform = `translate3d(0, ${((1 - titleProgress) * 8).toFixed(2)}px, 0)`
      }

      if (floatingAvatarRef.current) {
        const startSize = hasAccountLabel ? HERO_AVATAR_START_SIZE : HERO_AVATAR_LARGE_START_SIZE
        const startX = containerWidth / 2
        const startY = safeTop + (hasAccountLabel ? 180 : 194)
        const endX = containerWidth - 16 - HERO_AVATAR_END_SIZE / 2
        const endY = safeTop + 28
        // 混合轻微 smoothstep 磁滞曲线：贴近展开态与顶栏槽位时带磁极粘滞，中段轻快穿梭落槽
        const smooth = progress * progress * (3 - 2 * progress)
        const avatarXProgress = progress * 0.52 + smooth * 0.48
        const avatarYProgress = progress * 0.66 + smooth * 0.34
        const avatarScaleProgress = progress * 0.6 + smooth * 0.4
        const cx = startX + (endX - startX) * avatarXProgress
        const cy = startY + (endY - startY) * avatarYProgress
        const endScale = HERO_AVATAR_END_SIZE / startSize
        const scale = 1 + (endScale - 1) * avatarScaleProgress
        floatingAvatarRef.current.style.transform = `translate3d(${(cx - startSize / 2).toFixed(2)}px, ${(cy - startSize / 2).toFixed(2)}px, 0) scale(${scale.toFixed(4)})`
      }

      if (editBadgeRef.current) {
        const badgeProgress = clamp01(1 - progress / 0.32)
        editBadgeRef.current.style.opacity = badgeProgress.toFixed(3)
        editBadgeRef.current.style.transform = `scale(${(0.55 + 0.45 * badgeProgress).toFixed(3)})`
        editBadgeRef.current.style.pointerEvents = progress > 0.25 ? 'none' : 'auto'
      }

      const weight = clamp01(1 - progress / 0.55)
      tiltWeightRef.current = weight
      applyHeroParallax(
        getMobileParallaxTargets(),
        prefersReducedMotion() ? 0 : tiltCurrentRef.current.x,
        prefersReducedMotion() ? 0 : tiltCurrentRef.current.y,
        weight
      )
    },
    [getMobileParallaxTargets, hasAccountLabel, refreshHeroMetrics, syncHeaderDivider]
  )

  const {
    isSnapAnimatingRef: isHeroSnapAnimatingRef,
    notifyScroll: notifyHeroScroll,
    snapTo: snapHeroTo,
    cancelSnap: cancelHeroSnap,
  } = useHeroMagneticSnap({
    scrollRef: mobileScrollRef,
    enabled: immersiveMobile && open && mobileStack.length === 0,
    collapseDistance: HERO_COLLAPSE_DISTANCE,
    onFrame: applyHeroScroll,
    prefersReducedMotion,
  })

  const handleImmersiveScroll = useCallback(
    (scrollTop: number) => {
      notifyHeroScroll(scrollTop)
      if (isHeroSnapAnimatingRef.current) {
        return
      }
      pendingHeroScrollTopRef.current = scrollTop
      if (heroScrollRafRef.current) {
        return
      }
      heroScrollRafRef.current = requestAnimationFrame(() => {
        heroScrollRafRef.current = 0
        applyHeroScroll(pendingHeroScrollTopRef.current)
      })
    },
    [applyHeroScroll, isHeroSnapAnimatingRef, notifyHeroScroll]
  )

  useEffect(
    () => () => {
      cancelAnimationFrame(heroScrollRafRef.current)
      heroScrollRafRef.current = 0
    },
    []
  )

  useLayoutEffect(() => {
    if (open && (!prevOpenRef.current || storePage !== null)) {
      const page = storePage
      setSection(page ? settingsPageSection(page, isMobile) : storeSection)
      if (page) {
        const path = isMobile ? mobileSettingsPath(page) : []
        setMobileStack(path as MobileSubPage[])
        setRenderedL1((path[0] as MobileRootSubPage | undefined) ?? null)
        setRenderedL2((path[1] as MobileL2SubPage | undefined) ?? null)
        setRenderedL3(path[2] === 'memoryFile' ? 'memoryFile' : null)
        setDesktopSubPage(
          isMobile ? null : ((desktopSettingsPage(page) as DesktopSubPage | null) ?? null)
        )
        useSettingsDialog.setState({ page: null })
      } else {
        setMobileStack([])
        setDesktopSubPage(null)
      }
      cancelHeroSnap()
      if (mobileScrollRef.current) {
        mobileScrollRef.current.scrollTop = 0
      }
      if (mobilePlainScrollRef.current) {
        mobilePlainScrollRef.current.scrollTop = 0
      }
      layerScrolledRef.current[0] = false
      syncHeaderDivider()
      if (immersiveMobile) {
        refreshHeroMetrics()
        applyHeroScroll(0, true)
      }
    }
    prevOpenRef.current = open
  }, [
    open,
    storeSection,
    storePage,
    isMobile,
    immersiveMobile,
    refreshHeroMetrics,
    applyHeroScroll,
    cancelHeroSnap,
    syncHeaderDivider,
  ])

  useLayoutEffect(() => {
    if (!immersiveMobile) {
      lastHeroScrollTopRef.current = -1
      collapseProgressRef.current = 0
      headerBgRef.current?.style.removeProperty('opacity')
      backButtonRef.current?.classList.remove(styles.mobileBackButtonSolid)
      if (mobilePlainScrollRef.current) {
        mobilePlainScrollRef.current.scrollTop = 0
      }
      layerScrolledRef.current[0] = false
      syncHeaderDivider()
      return
    }
    refreshHeroMetrics()
    applyHeroScroll(mobileScrollRef.current?.scrollTop ?? 0, true)
    const onResize = () => {
      if (refreshHeroMetrics()) {
        applyHeroScroll(mobileScrollRef.current?.scrollTop ?? 0, true)
      }
    }
    if (typeof ResizeObserver === 'function' && mobileMainRef.current) {
      const observer = new ResizeObserver(onResize)
      observer.observe(mobileMainRef.current)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [immersiveMobile, refreshHeroMetrics, applyHeroScroll, syncHeaderDivider])

  // 设置页滑入/滑出及子页进退栈期间（320ms）同步挂载 data-animating，暂停巨幅实时模糊以保障高刷满帧
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!isMobile || !dialog) {
      return
    }
    dialog.dataset.animating = 'true'
    if (!open || !visible) {
      return
    }
    const timer = window.setTimeout(() => {
      if (dialogRef.current) {
        delete dialogRef.current.dataset.animating
      }
    }, 320)
    return () => window.clearTimeout(timer)
  }, [isMobile, open, visible, mobileStack.length])

  // 切换分组不丢失导入状态
  const historyImport = useHistoryImport()
  const historyUrlImport = useHistoryUrlImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy =
    historyImport.busy || historyUrlImport.busy || historyDelete.busy || replacingHistory
  const hasL1 = isMobile && mobileStack.length >= 1
  const hasL2 = isMobile && mobileStack.length >= 2
  const hasL3 = isMobile && mobileStack.length >= 3
  const l1Presence = usePresence(hasL1, 280)
  const l2Presence = usePresence(hasL2, 280)
  const l3Presence = usePresence(hasL3, 280)

  const openMobileSubPage = (page: MobileRootSubPage) => {
    layerScrolledRef.current[1] = false
    layerScrolledRef.current[2] = false
    layerScrolledRef.current[3] = false
    setRenderedL1(page)
    setMobileStack([page])
  }

  const openMobileChatBackground = () => {
    layerScrolledRef.current[2] = false
    setRenderedL2('chatBackground')
    setMobileStack((prev) =>
      prev[0] === 'appBackground' ? ['appBackground', 'chatBackground'] : prev
    )
  }

  const openMobileMemory = () => {
    if (__BETA__) {
      openMobileSubPage('globalMemory')
      return
    }
    layerScrolledRef.current[2] = false
    setRenderedL2('globalMemory')
    setMobileStack((prev) => (prev[0] === 'data' ? ['data', 'globalMemory'] : prev))
  }

  const openMobileMemoryFile = () => {
    if (__BETA__) {
      layerScrolledRef.current[2] = false
      setRenderedL2('memoryFile')
      setMobileStack((prev) => (prev[0] === 'globalMemory' ? ['globalMemory', 'memoryFile'] : prev))
      return
    }
    layerScrolledRef.current[3] = false
    setRenderedL3('memoryFile')
    setMobileStack((prev) =>
      prev[1] === 'globalMemory' ? ['data', 'globalMemory', 'memoryFile'] : prev
    )
  }

  const backFromMobilePage = () => {
    setMobileStack((prev) => prev.slice(0, -1))
  }

  useEffect(() => {
    const depth = (isMobile ? Math.min(3, mobileStack.length) : 0) as 0 | 1 | 2 | 3
    activeDepthRef.current = depth
    if (depth < 1) {
      layerScrolledRef.current[1] = false
    }
    if (depth < 2) {
      layerScrolledRef.current[2] = false
    }
    if (depth < 3) {
      layerScrolledRef.current[3] = false
    }
    syncHeaderDivider()
  }, [isMobile, mobileStack.length, open, syncHeaderDivider])

  useEffect(() => {
    if (!memoryEnabled) {
      setMobileStack((prev) => (prev.at(-1) === 'memoryFile' ? prev.slice(0, -1) : prev))
      if (desktopSubPage === 'memoryFile') {
        setDesktopSubPage('globalMemory')
      }
    }
  }, [memoryEnabled, desktopSubPage])

  useEffect(() => {
    if (mobileMainRef.current) {
      mobileMainRef.current.inert = hasL1
    }
  }, [hasL1])

  // 仅在设置主页静止可见且页面过渡结束后订阅陀螺仪，避免开关设置或切换子页期间争抢主线程与 GPU
  useEffect(() => {
    if (
      !immersiveMobile ||
      !open ||
      !visible ||
      hasL1 ||
      l1Presence.mounted ||
      prefersReducedMotion()
    ) {
      tiltTargetRef.current.x = 0
      tiltTargetRef.current.y = 0
      tiltCurrentRef.current.x = 0
      tiltCurrentRef.current.y = 0
      cancelAnimationFrame(tiltRafRef.current)
      tiltRafRef.current = 0
      if (immersiveMobile) {
        const weight = clamp01(1 - collapseProgressRef.current / 0.55)
        tiltWeightRef.current = weight
        applyHeroParallax(getMobileParallaxTargets(), 0, 0, weight)
      }
      return
    }

    let unsubscribe: (() => void) | null = null
    const timer = window.setTimeout(() => {
      unsubscribe = subscribeDeviceTilt((tilt) => {
        tiltTargetRef.current.x = tilt.x
        tiltTargetRef.current.y = tilt.y
        wakeTiltLoop()
      })
    }, 340)

    return () => {
      window.clearTimeout(timer)
      unsubscribe?.()
      cancelAnimationFrame(tiltRafRef.current)
      tiltRafRef.current = 0
    }
  }, [
    immersiveMobile,
    open,
    visible,
    hasL1,
    l1Presence.mounted,
    wakeTiltLoop,
    getMobileParallaxTargets,
  ])

  const handleFloatingAvatarClick = () => {
    if (collapseProgressRef.current > 0.55) {
      snapHeroTo('expanded')
      return
    }
    avatarPicker.openPickerOrMenu()
  }

  const renderBetaMobileGroups = (glassDataCard: boolean) => (
    <>
      <div className={styles.mobileGroupTitle}>{t('settingDialogAsideDataOptionLabel')}</div>
      <div
        ref={glassDataCard ? dataCardRef : undefined}
        className={clsx(styles.mobileCard, glassDataCard && styles.mobileGlassCard)}
      >
        <ApiKeySetting />
        <MobileActionCard
          embedded
          label={t('globalMemory')}
          right={
            <span className={styles.mobileNavRight}>
              <IconChevronRightOutline14 />
            </span>
          }
          onAction={openMobileMemory}
        />
        <MobileActionCard
          embedded
          label={t('importChatsEntry')}
          right={
            <span className={styles.mobileNavRight}>
              <IconChevronRightOutline14 />
            </span>
          }
          onAction={() => openMobileSubPage('importSessions')}
        />
        <MobileActionCard
          embedded
          label={t('exportInfoTitle')}
          right={
            <span className={styles.mobileNavRight}>
              <IconChevronRightOutline14 />
            </span>
          }
          onAction={() => openMobileSubPage('exportInfo')}
        />
      </div>
      <div className={styles.mobileGroupTitle}>{t('settingsPersonalization')}</div>
      <div className={styles.mobileCard}>
        <button
          type="button"
          className={styles.mobileNavRow}
          onClick={() => openMobileSubPage('personalCenter')}
        >
          <span className={styles.label}>{t('settingsPersonalCenter')}</span>
          <span className={styles.mobileNavRight}>
            <IconChevronRightOutline14 />
          </span>
        </button>
        <button
          type="button"
          className={styles.mobileNavRow}
          onClick={() => openMobileSubPage('nickname')}
        >
          <span className={styles.label}>{t('settingsNickname')}</span>
          <span className={styles.mobileNavRight}>
            <IconChevronRightOutline14 />
          </span>
        </button>
        <button
          type="button"
          className={styles.mobileNavRow}
          onClick={() => openMobileSubPage('appBackground')}
        >
          <span className={styles.label}>{t('settingsAppBackground')}</span>
          <span className={styles.mobileNavRight}>
            <IconChevronRightOutline14 />
          </span>
        </button>
        <button
          type="button"
          className={styles.mobileNavRow}
          onClick={() => openMobileSubPage('liveAvatar')}
        >
          <span className={styles.label}>{t('settingsLiveAvatar')}</span>
          <span className={styles.mobileNavRight}>
            <IconChevronRightOutline14 />
          </span>
        </button>
      </div>
      <div className={styles.mobileGroupTitle}>{t('settingGroupChat')}</div>
      <div className={styles.mobileCard}>
        <MobileSystemPromptNavRow onOpen={() => openMobileSubPage('systemPrompt')} />
        <button
          type="button"
          className={styles.mobileNavRow}
          onClick={() => openMobileSubPage('voiceBroadcast')}
        >
          <span className={styles.label}>{t('settingsVoiceBroadcast')}</span>
          <span className={styles.mobileNavRight}>
            <IconChevronRightOutline14 />
          </span>
        </button>
        <button
          type="button"
          className={styles.mobileNavRow}
          onClick={() => openMobileSubPage('videoUpload')}
        >
          <span className={styles.label}>{t('settingsVideoUpload')}</span>
          <span className={styles.mobileNavRight}>
            <IconChevronRightOutline14 />
          </span>
        </button>
      </div>
      <div className={styles.mobileGroupTitle}>{t('settingGroupApp')}</div>
      <div className={styles.mobileCard}>
        <MobileLocaleSetting />
        <MobileThemeSetting />
        <MobileLocationNavRow onOpen={() => openMobileSubPage('location')} />
      </div>
      {APP_VERSION ? <div className={styles.version}>{`v${APP_VERSION}`}</div> : null}
    </>
  )

  return (
    <>
      <Modal
        dialogRef={dialogRef}
        title={
          isMobile ? (
            <div className={styles.mobileSubHeader}>
              {betaMobile ? (
                <>
                  <div
                    ref={headerBgRef}
                    aria-hidden="true"
                    className={clsx(
                      styles.mobileHeaderBackdrop,
                      (l1Presence.visible || !immersiveMobile) && styles.mobileHeaderBackdropSolid
                    )}
                  />
                  <div
                    ref={headerDividerRef}
                    aria-hidden="true"
                    className={styles.mobileHeaderDivider}
                  />
                </>
              ) : null}
              <button
                ref={backButtonRef}
                type="button"
                className={clsx(
                  styles.mobileBackButton,
                  immersiveMobile && !l1Presence.visible && styles.mobileBackButtonOverlay
                )}
                aria-label={t(hasL1 ? 'back' : 'close')}
                onClick={() => {
                  if (hasL1) {
                    backFromMobilePage()
                  } else if (!historyDelete.busy) {
                    closeSettings()
                  }
                }}
              >
                <IconChevronRightOutline14 />
              </button>
              <span className={styles.mobileTitleStack}>
                <span
                  aria-hidden={hasL1}
                  className={clsx(
                    styles.mobileTitleItem,
                    l1Presence.visible ? styles.mobileTitleExitLeft : styles.mobileTitleActive
                  )}
                >
                  {immersiveMobile ? (
                    <span ref={rootTitleRef} className={styles.mobileRootTitleInner}>
                      {t('settings')}
                    </span>
                  ) : (
                    t('settings')
                  )}
                </span>
                {l1Presence.mounted && renderedL1 ? (
                  <span
                    aria-hidden={!hasL1 || hasL2}
                    className={clsx(
                      styles.mobileTitleItem,
                      l2Presence.visible
                        ? styles.mobileTitleExitLeft
                        : l1Presence.visible
                          ? styles.mobileTitleActive
                          : styles.mobileTitleEnterRight
                    )}
                  >
                    {t(MOBILE_SUB_TITLE_KEY[renderedL1])}
                  </span>
                ) : null}
                {l2Presence.mounted && renderedL2 ? (
                  <span
                    aria-hidden={!hasL2 || hasL3}
                    className={clsx(
                      styles.mobileTitleItem,
                      l3Presence.visible
                        ? styles.mobileTitleExitLeft
                        : l2Presence.visible
                          ? styles.mobileTitleActive
                          : styles.mobileTitleEnterRight
                    )}
                  >
                    {t(MOBILE_SUB_TITLE_KEY[renderedL2])}
                  </span>
                ) : null}
                {l3Presence.mounted && renderedL3 ? (
                  <span
                    aria-hidden={!hasL3}
                    className={clsx(
                      styles.mobileTitleItem,
                      l3Presence.visible ? styles.mobileTitleActive : styles.mobileTitleEnterRight
                    )}
                  >
                    {t(MOBILE_SUB_TITLE_KEY[renderedL3])}
                  </span>
                ) : null}
              </span>
            </div>
          ) : (
            t('settings')
          )
        }
        closable={!isMobile}
        visible={visible}
        fullscreen={isMobile}
        overlayClassName={clsx(styles.settingsOverlay, visible && styles.settingsOverlayVisible)}
        className={clsx(
          styles.dialog,
          visible && styles.dialogVisible,
          betaMobile && styles.dialogImmersive
        )}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (historyDelete.busy) {
            return
          }
          if (hasL1) {
            backFromMobilePage()
            return
          }
          closeSettings()
        }}
      >
        {isMobile ? (
          <div className={styles.mobilePageViewport}>
            {immersiveMobile ? (
              <div
                className={clsx(
                  styles.floatingAvatarLayer,
                  l1Presence.visible && styles.floatingAvatarLayerHidden
                )}
                aria-hidden={hasL1 || undefined}
              >
                <div
                  ref={floatingAvatarRef}
                  className={clsx(
                    styles.floatingAvatarAnchor,
                    !hasAccountLabel && styles.floatingAvatarAnchorLarge
                  )}
                >
                  <div
                    ref={avatarShadowRef}
                    className={styles.heroAvatarShadow}
                    aria-hidden="true"
                  />
                  <div ref={avatar3dRef} className={styles.heroAvatar3d}>
                    <button
                      type="button"
                      className={styles.floatingAvatarHit}
                      aria-label={t('accountChangeAvatar')}
                      onClick={handleFloatingAvatarClick}
                    >
                      <AccountAvatar
                        src={account.avatarDataUrl}
                        className={styles.heroAvatarCircle}
                        iconClassName={styles.heroAvatarDefaultIcon}
                      />
                      <span
                        ref={avatarSheenRef}
                        className={styles.heroAvatarSheen}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <button
                    ref={editBadgeRef}
                    type="button"
                    className={clsx(
                      styles.heroAvatarEditButton,
                      account.coverDataUrl && styles.heroEditOnCover
                    )}
                    aria-label={t('accountChangeAvatar')}
                    onClick={(event) => {
                      event.stopPropagation()
                      avatarPicker.openPickerOrMenu()
                    }}
                  >
                    <span ref={avatarEditParallaxRef} className={styles.heroParallaxLayer}>
                      <IconEditOutline16 />
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
            <div
              ref={mobileMainRef}
              className={clsx(
                styles.mobileMainPage,
                l1Presence.visible && styles.mobileMainPagePushed
              )}
              aria-hidden={hasL1}
            >
              {immersiveMobile ? (
                <>
                  <div ref={heroBgRef} className={styles.mobileHeroBackdrop} aria-hidden="true">
                    <div ref={heroBgParallaxRef} className={styles.mobileHeroBackdropParallax}>
                      {account.coverDataUrl ? (
                        <>
                          <img
                            src={account.coverDataUrl}
                            alt=""
                            draggable={false}
                            className={styles.mobileHeroCoverImage}
                          />
                          <div className={styles.mobileHeroCoverScrim} />
                        </>
                      ) : null}
                    </div>
                    <div className={styles.mobileHeroBackdropFade} />
                  </div>
                  <div
                    ref={mobileScrollRef}
                    className={styles.mobileImmersiveScroll}
                    onScroll={(event) => handleImmersiveScroll(event.currentTarget.scrollTop)}
                  >
                    <div className={styles.mobileHeroSpacer}>
                      {hasAccountLabel ? (
                        <div ref={heroIdentityRef} className={styles.mobileHeroIdentity}>
                          <span
                            ref={identityParallaxRef}
                            className={clsx(
                              styles.mobileHeroAccountLabel,
                              account.coverDataUrl && styles.heroLabelOnCover
                            )}
                          >
                            {accountLabel}
                          </span>
                        </div>
                      ) : null}
                      <button
                        ref={coverEditRef}
                        type="button"
                        className={clsx(
                          styles.heroCoverEditButton,
                          account.coverDataUrl && styles.heroEditOnCover
                        )}
                        aria-label={t('accountChangeCover')}
                        onClick={coverPicker.openPickerOrMenu}
                      >
                        <span ref={coverEditParallaxRef} className={styles.heroParallaxLayer}>
                          <IconEditOutline16 />
                        </span>
                      </button>
                    </div>
                    <div className={styles.mobileSettingsSheet}>
                      <div
                        ref={sheetGlassRef}
                        className={styles.mobileSettingsSheetGlass}
                        aria-hidden="true"
                      />
                      <div className={styles.mobileSettingsSheetLower} aria-hidden="true" />
                      <div
                        ref={sheetSolidRef}
                        className={styles.mobileSettingsSheetSolid}
                        aria-hidden="true"
                      />
                      <div className={styles.mobileSettingsSheetContent}>
                        {renderBetaMobileGroups(true)}
                      </div>
                    </div>
                  </div>
                </>
              ) : betaMobile ? (
                <div
                  ref={mobilePlainScrollRef}
                  className={clsx(styles.content, styles.mobilePlainScroll)}
                  onScroll={(event) => {
                    const target = event.currentTarget
                    const scrolled =
                      target.scrollTop > 2 && target.scrollHeight > target.clientHeight + 1
                    if (layerScrolledRef.current[0] !== scrolled) {
                      layerScrolledRef.current[0] = scrolled
                      syncHeaderDivider()
                    }
                  }}
                >
                  {renderBetaMobileGroups(false)}
                </div>
              ) : (
                <div className={styles.content}>
                  <div className={styles.mobileGroupTitle}>
                    {t('settingDialogAsideDataOptionLabel')}
                  </div>
                  <div className={styles.mobileCard}>
                    <ApiKeySetting />
                    <button
                      type="button"
                      className={styles.mobileNavRow}
                      onClick={() => openMobileSubPage('data')}
                    >
                      <span className={styles.label}>{t('settingDialogAsideDataOptionLabel')}</span>
                      <span className={styles.mobileNavRight}>
                        <IconChevronRightOutline14 />
                      </span>
                    </button>
                  </div>
                  <div className={styles.mobileGroupTitle}>{t('settingGroupApp')}</div>
                  <div className={styles.mobileCard}>
                    <MobileLocaleSetting />
                    <MobileThemeSetting />
                    <MobileLocationNavRow onOpen={() => openMobileSubPage('location')} />
                  </div>
                  <div className={styles.mobileGroupTitle}>{t('settingGroupChat')}</div>
                  <div className={styles.mobileCard}>
                    <MobileSystemPromptNavRow onOpen={() => openMobileSubPage('systemPrompt')} />
                    <button
                      type="button"
                      className={styles.mobileNavRow}
                      onClick={() => openMobileSubPage('voiceBroadcast')}
                    >
                      <span className={styles.label}>{t('settingsVoiceBroadcast')}</span>
                      <span className={styles.mobileNavRight}>
                        <IconChevronRightOutline14 />
                      </span>
                    </button>
                    <button
                      type="button"
                      className={styles.mobileNavRow}
                      onClick={() => openMobileSubPage('videoUpload')}
                    >
                      <span className={styles.label}>{t('settingsVideoUpload')}</span>
                      <span className={styles.mobileNavRight}>
                        <IconChevronRightOutline14 />
                      </span>
                    </button>
                  </div>
                  {APP_VERSION ? <div className={styles.version}>{`v${APP_VERSION}`}</div> : null}
                </div>
              )}
            </div>
            {l1Presence.mounted && renderedL1 ? (
              <MobileSubLayer
                visible={l1Presence.visible}
                pushed={l2Presence.visible}
                level={1}
                onScrolledChange={handleSubLayerScrolledChange}
              >
                {renderedL1 === 'data' ? (
                  <div className={clsx(styles.content, styles.mobileDataContent)}>
                    <ImportHistory historyImport={historyImport} disabled={historyBusy} />
                    <ImportHistoryFromUrl urlImport={historyUrlImport} disabled={historyBusy} />
                    <ExportHistory disabled={historyBusy} />
                    {__BETA__ ? (
                      <MobileActionCard
                        label={t('globalMemory')}
                        right={
                          <span className={styles.mobileNavRight}>
                            <IconChevronRightOutline14 />
                          </span>
                        }
                        onAction={openMobileMemory}
                      />
                    ) : null}
                    <MobileActionCard
                      danger
                      label={t('deleteAllSessions')}
                      disabled={historyBusy}
                      onAction={historyDelete.open}
                    />
                  </div>
                ) : renderedL1 === 'personalCenter' ? (
                  <PersonalCenterPage />
                ) : renderedL1 === 'nickname' ? (
                  <MobileNicknamePage />
                ) : renderedL1 === 'appBackground' ? (
                  <AppBackgroundPage onOpenChatBackground={openMobileChatBackground} />
                ) : renderedL1 === 'liveAvatar' ? (
                  <LiveAvatarPage />
                ) : renderedL1 === 'importSessions' ? (
                  <div className={clsx(styles.content, styles.mobileDataContent)}>
                    <ImportHistory historyImport={historyImport} disabled={historyBusy} />
                    <ImportHistoryFromUrl urlImport={historyUrlImport} disabled={historyBusy} />
                  </div>
                ) : renderedL1 === 'exportInfo' ? (
                  <div className={clsx(styles.content, styles.mobileDataContent)}>
                    <ExportHistory disabled={historyBusy} />
                    <MobileActionCard
                      danger
                      label={t('deleteAllSessions')}
                      disabled={historyBusy}
                      onAction={historyDelete.open}
                    />
                  </div>
                ) : renderedL1 === 'voiceBroadcast' ? (
                  <div className={clsx(styles.content, styles.mobileLocationContent)}>
                    <div className={styles.mobileCard}>
                      <MobileAutoReadAloudSetting />
                      <MobileTtsVoiceSetting />
                    </div>
                  </div>
                ) : renderedL1 === 'videoUpload' ? (
                  <div className={clsx(styles.content, styles.mobileLocationContent)}>
                    <div className={styles.mobileCard}>
                      <VideoSettings />
                      <QuickCameraShortcutSetting />
                    </div>
                  </div>
                ) : renderedL1 === 'globalMemory' ? (
                  <GlobalMemoryPage disabled={historyBusy} onOpenFile={openMobileMemoryFile} />
                ) : renderedL1 === 'location' ? (
                  <MobileLocationPage />
                ) : (
                  <MobileSystemPromptPage />
                )}
              </MobileSubLayer>
            ) : null}
            {l2Presence.mounted && renderedL2 ? (
              <MobileSubLayer
                visible={l2Presence.visible}
                pushed={l3Presence.visible}
                level={2}
                onScrolledChange={handleSubLayerScrolledChange}
              >
                {renderedL2 === 'memoryFile' ? (
                  <MemoryFilePage disabled={historyBusy} />
                ) : renderedL2 === 'chatBackground' ? (
                  <ChatBackgroundPage />
                ) : (
                  <GlobalMemoryPage disabled={historyBusy} onOpenFile={openMobileMemoryFile} />
                )}
              </MobileSubLayer>
            ) : null}
            {l3Presence.mounted && renderedL3 ? (
              <MobileSubLayer
                visible={l3Presence.visible}
                pushed={false}
                level={3}
                onScrolledChange={handleSubLayerScrolledChange}
              >
                <MemoryFilePage disabled={historyBusy} />
              </MobileSubLayer>
            ) : null}
          </div>
        ) : (
          <>
            <div role="tablist" className={styles.navigation}>
              {sections.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={section === item.value}
                  className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
                  onClick={() => {
                    setSection(item.value)
                    setDesktopSubPage(null)
                  }}
                >
                  {item.icon}
                  {t(item.label)}
                </button>
              ))}
              {APP_VERSION ? <div className={styles.version}>{`v${APP_VERSION}`}</div> : null}
            </div>
            {section === 'data' && desktopSubPage ? (
              <div role="tabpanel" className={styles.desktopSubPanel}>
                <div className={styles.desktopSubHeader}>
                  <IconButton
                    size="xs"
                    tone="primary"
                    className={styles.desktopBackButton}
                    aria-label={t('back')}
                    icon={<IconChevronRightOutline14 />}
                    onClick={() =>
                      setDesktopSubPage(
                        desktopSubPage === 'memoryFile'
                          ? 'globalMemory'
                          : desktopSubPage === 'chatBackground'
                            ? 'appBackground'
                            : null
                      )
                    }
                  />
                  <span className={styles.desktopSubTitle}>
                    {t(MOBILE_SUB_TITLE_KEY[desktopSubPage])}
                  </span>
                </div>
                {desktopSubPage === 'globalMemory' ? (
                  <GlobalMemoryPage
                    disabled={historyBusy}
                    onOpenFile={() => setDesktopSubPage('memoryFile')}
                  />
                ) : desktopSubPage === 'memoryFile' ? (
                  <MemoryFilePage disabled={historyBusy} />
                ) : desktopSubPage === 'personalCenter' ? (
                  <PersonalCenterPage />
                ) : desktopSubPage === 'appBackground' ? (
                  <AppBackgroundPage
                    onOpenChatBackground={() => setDesktopSubPage('chatBackground')}
                  />
                ) : desktopSubPage === 'liveAvatar' ? (
                  <LiveAvatarPage />
                ) : (
                  <ChatBackgroundPage />
                )}
              </div>
            ) : (
              <div role="tabpanel" className={styles.content}>
                {section === 'general' ? (
                  <>
                    <ThemeSetting />
                    <LocaleSetting />
                    <TtsVoiceSetting />
                    <AutoReadAloudSetting />
                    <LocationSetting />
                    <AiLocationSetting />
                    <SystemPromptSetting />
                    <VideoSettings />
                  </>
                ) : (
                  <>
                    {__BETA__ ? (
                      <>
                        {personalCenterEnabled ? (
                          <DesktopAccountHero
                            avatarDataUrl={account.avatarDataUrl}
                            coverDataUrl={account.coverDataUrl}
                            accountLabel={accountLabel}
                            avatarAriaLabel={t('accountChangeAvatar')}
                            coverAriaLabel={t('accountChangeCover')}
                            onEditAvatar={avatarPicker.openPickerOrMenu}
                            onEditCover={coverPicker.openPickerOrMenu}
                          />
                        ) : null}
                        <SettingCell
                          label={t('settingsPersonalCenter')}
                          status={null}
                          action={
                            <Button
                              variant="outlined"
                              size="m"
                              className={styles.cellButton}
                              onClick={() => setDesktopSubPage('personalCenter')}
                            >
                              {t('memoryManage')}
                            </Button>
                          }
                        />
                        <NicknameSetting />
                        <NicknameForReplySetting />
                        <SettingCell
                          label={t('settingsAppBackground')}
                          status={null}
                          action={
                            <Button
                              variant="outlined"
                              size="m"
                              className={styles.cellButton}
                              onClick={() => setDesktopSubPage('appBackground')}
                            >
                              {t('memoryManage')}
                            </Button>
                          }
                        />
                        <SettingCell
                          label={t('settingsLiveAvatar')}
                          status={null}
                          action={
                            <Button
                              variant="outlined"
                              size="m"
                              className={styles.cellButton}
                              onClick={() => setDesktopSubPage('liveAvatar')}
                            >
                              {t('memoryManage')}
                            </Button>
                          }
                        />
                      </>
                    ) : null}
                    <ApiKeySetting />
                    <ImportHistory historyImport={historyImport} disabled={historyBusy} />
                    <ImportHistoryFromUrl urlImport={historyUrlImport} disabled={historyBusy} />
                    <ExportHistory disabled={historyBusy} />
                    {__BETA__ ? (
                      <SettingCell
                        label={t('globalMemory')}
                        status={null}
                        action={
                          <Button
                            variant="outlined"
                            size="m"
                            className={styles.cellButton}
                            onClick={() => setDesktopSubPage('globalMemory')}
                          >
                            {t('memoryManage')}
                          </Button>
                        }
                      />
                    ) : null}
                    <SettingCell
                      label={t('deleteAllSessions')}
                      status={null}
                      action={
                        <Button
                          variant="dangerOutlined"
                          size="m"
                          className={styles.cellButton}
                          disabled={historyBusy}
                          onClick={historyDelete.open}
                        >
                          {t('delete')}
                        </Button>
                      }
                    />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Modal>
      <AccountImagePickerControls picker={avatarPicker} />
      <AccountImagePickerControls picker={coverPicker} />
      <ImportConfirm historyImport={historyImport} />
      <UrlImportDialog urlImport={historyUrlImport} />
      <DeleteAllConfirm historyDelete={historyDelete} />
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const presence = usePresence(historyDelete.opened, 220)
  if (!presence.mounted) {
    return null
  }
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      visible={presence.visible}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus={!isMobile}
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy || !historyDelete.opened}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

/** 设置昵称：顶替默认手机号显示，留空保存则恢复默认手机号占位 */
const NicknameSetting = ({
  mobileLabelKey = 'settingsNickname',
}: {
  mobileLabelKey?: TranslationKey
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const nickname = useMockAccount((state) => state.nickname)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(nickname)
  const sheetPresence = usePresence(open && isMobile, 280)
  const modalPresence = usePresence(open && !isMobile, 220)

  const openModal = () => {
    setDraft(nickname)
    setOpen(true)
  }

  const closeModal = () => {
    setOpen(false)
  }

  const handleConfirm = () => {
    const next = draft
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, MAX_ACCOUNT_NICKNAME_LENGTH)
    if (next === nickname) {
      setOpen(false)
      return
    }
    setMockAccountNickname(next)
    setOpen(false)
    showToast(
      { key: next ? 'settingsNicknameUpdated' : 'settingsNicknameCleared' },
      { placement: 'center' }
    )
  }

  const content = (
    <div className={styles.apiKeyModalBody}>
      <div className={styles.apiKeyInput}>
        <input
          type="text"
          aria-label={t('settingsNickname')}
          placeholder={t('settingsNicknamePlaceholder')}
          maxLength={MAX_ACCOUNT_NICKNAME_LENGTH}
          autoComplete="nickname"
          // 移动端不自动聚焦：抽屉滑入与软键盘同时进行会整段掉帧，交给用户点
          autoFocus={!isMobile}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              handleConfirm()
            }
          }}
        />
      </div>
      {draft ? (
        <div className={styles.promptEditorFooterMeta}>
          <button type="button" className={styles.promptResetButton} onClick={() => setDraft('')}>
            {t('searchClear')}
          </button>
        </div>
      ) : null}
    </div>
  )

  return (
    <>
      {isMobile ? (
        <button type="button" className={styles.mobileNavRow} onClick={openModal}>
          <span className={styles.label}>{t(mobileLabelKey)}</span>
          <span className={styles.mobileNavRight}>
            <span className={styles.mobileNavValue}>{nickname || t('settingsNicknameNotSet')}</span>
            <IconChevronRightOutline14 />
          </span>
        </button>
      ) : (
        <SettingCell
          label={t('settingsNickname')}
          description={nickname || t('settingsNicknameNotSet')}
          status={null}
          action={
            <Button variant="outlined" size="m" className={styles.cellButton} onClick={openModal}>
              {t('settingsEditAction')}
            </Button>
          }
        />
      )}

      {isMobile ? (
        sheetPresence.mounted ? (
          <Modal
            title={t('settingsNickname')}
            closable
            visible={sheetPresence.visible}
            className={clsx(styles.urlSheet, sheetPresence.visible && styles.sheetVisible)}
            mainClassName={styles.urlSheetMain}
            onClose={closeModal}
          >
            <div className={styles.promptStage}>{content}</div>
            <button
              type="button"
              className={styles.ttsSheetConfirm}
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleConfirm}
            >
              {t('confirm')}
            </button>
          </Modal>
        ) : null
      ) : modalPresence.mounted ? (
        <Modal
          title={t('settingsNickname')}
          visible={modalPresence.visible}
          className={styles.urlModal}
          onClose={closeModal}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={closeModal}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="m"
                disabled={!open}
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleConfirm}
              >
                {t('confirm')}
              </Button>
            </>
          }
        >
          {content}
        </Modal>
      ) : null}
    </>
  )
}

/** 昵称用于回复开关：开启后在快速模式、专家模式随提示词一并发送 */
const NicknameForReplySetting = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const useNicknameInReply = useMockAccount((state) => state.useNicknameInReply)
  const label = t('settingsNicknameForReply')
  const description = t('settingsNicknameForReplyDesc')

  if (isMobile) {
    return (
      <div className={clsx(styles.cell, styles.switchHeader)}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{label}</span>
          <InfoModalButton ariaLabel={label} description={description} />
        </div>
        <Switch
          checked={useNicknameInReply}
          ariaLabel={label}
          onChange={setMockAccountUseNicknameInReply}
        />
      </div>
    )
  }

  return (
    <SettingCell
      label={label}
      description={description}
      infoAsModal
      status={null}
      action={
        <Switch
          checked={useNicknameInReply}
          ariaLabel={label}
          onChange={setMockAccountUseNicknameInReply}
        />
      }
    />
  )
}

/** 独立的「个人中心」页面：开启或关闭顶部背景图、头像、昵称展示与侧边栏账号入口 */
const PersonalCenterPage = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const personalCenterEnabled = useSettings((state) => state.personalCenterEnabled)
  const label = t('settingsPersonalCenter')
  const description = t('settingsPersonalCenterDesc')

  if (isMobile) {
    return (
      <div className={clsx(styles.content, styles.mobileLocationContent)}>
        <div className={styles.mobileCard}>
          <div className={clsx(styles.cell, styles.switchHeader)}>
            <span className={styles.label}>{label}</span>
            <Switch
              checked={personalCenterEnabled}
              ariaLabel={label}
              onChange={setPersonalCenterEnabled}
            />
          </div>
        </div>
        <p className={styles.mobileCardHint}>{description}</p>
      </div>
    )
  }

  return (
    <div className={styles.desktopSubScroll}>
      <SettingCell
        label={label}
        description={description}
        status={null}
        action={
          <Switch
            checked={personalCenterEnabled}
            ariaLabel={label}
            onChange={setPersonalCenterEnabled}
          />
        }
      />
    </div>
  )
}

/** 移动端独立的「设置昵称」二级页面：含昵称编辑项与「昵称用于回复」开关 */
const MobileNicknamePage = () => (
  <div className={clsx(styles.content, styles.mobileLocationContent)}>
    <div className={styles.mobileCard}>
      <NicknameSetting mobileLabelKey="settingsNicknameField" />
      <NicknameForReplySetting />
    </div>
  </div>
)

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

const mobileTtsVoices: {
  value: TtsVoice
  nameKey: TranslationKey
  descKey: TranslationKey
}[] = [
  {
    value: 'stella',
    nameKey: 'settingsTtsVoiceStellaName',
    descKey: 'settingsTtsVoiceStellaDesc',
  },
  {
    value: 'tide',
    nameKey: 'settingsTtsVoiceTideName',
    descKey: 'settingsTtsVoiceTideDesc',
  },
]

/** 移动端朗读音色：点击弹出底部圆角抽屉，支持左右滑动与点击圆点切换，切换时标题与说明随方向平滑移动 */
const MobileTtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetPresence = usePresence(sheetOpen, 280)
  const [draftVoice, setDraftVoice] = useState<TtsVoice>(ttsVoice)
  const [voiceTransition, setVoiceTransition] = useState<{
    prev: TtsVoice | null
    dir: 'next' | 'prev'
    tick: number
  }>({ prev: null, dir: 'next', tick: 0 })
  const touchStartX = useRef<number | null>(null)
  const currentVoice = mobileTtsVoices.find((item) => item.value === ttsVoice) ?? mobileTtsVoices[0]
  const draftIndex = Math.max(
    0,
    mobileTtsVoices.findIndex((item) => item.value === draftVoice)
  )
  const activeDraft = mobileTtsVoices[draftIndex] ?? mobileTtsVoices[0]
  const exitingDraft = voiceTransition.prev
    ? mobileTtsVoices.find((item) => item.value === voiceTransition.prev)
    : undefined

  const switchDraftVoice = (nextVoice: TtsVoice, dir: 'next' | 'prev') => {
    if (nextVoice === draftVoice) {
      return
    }
    setVoiceTransition((cur) => ({ prev: draftVoice, dir, tick: cur.tick + 1 }))
    setDraftVoice(nextVoice)
  }

  return (
    <>
      <button
        type="button"
        className={styles.mobileNavRow}
        onClick={() => {
          setDraftVoice(ttsVoice)
          setVoiceTransition({ prev: null, dir: 'next', tick: 0 })
          setSheetOpen(true)
        }}
      >
        <span className={styles.label}>{t('settingsTtsVoice')}</span>
        <span className={styles.mobileNavRight}>
          <span className={styles.mobileNavValue}>{t(currentVoice.nameKey)}</span>
          <IconChevronRightOutline14 />
        </span>
      </button>
      {sheetPresence.mounted ? (
        <Modal
          title={t('settingsTtsVoice')}
          closable
          visible={sheetPresence.visible}
          className={clsx(styles.ttsSheet, sheetPresence.visible && styles.sheetVisible)}
          mainClassName={styles.ttsSheetMain}
          onClose={() => setSheetOpen(false)}
        >
          <div
            className={styles.ttsStage}
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? null
            }}
            onTouchEnd={(event) => {
              const startX = touchStartX.current
              touchStartX.current = null
              const endX = event.changedTouches[0]?.clientX
              if (startX === null || endX === undefined) {
                return
              }
              const dx = endX - startX
              if (Math.abs(dx) > 36) {
                const dir = dx < 0 ? 'next' : 'prev'
                const nextIndex =
                  dx < 0
                    ? (draftIndex + 1) % mobileTtsVoices.length
                    : (draftIndex - 1 + mobileTtsVoices.length) % mobileTtsVoices.length
                const next = mobileTtsVoices[nextIndex]
                if (next) {
                  switchDraftVoice(next.value, dir)
                }
              }
            }}
          >
            <div className={styles.ttsVoiceViewport}>
              {exitingDraft ? (
                <div
                  key={`out-${exitingDraft.value}-${voiceTransition.tick}`}
                  aria-hidden="true"
                  className={clsx(
                    styles.ttsVoiceSlide,
                    voiceTransition.dir === 'next' ? styles.ttsExitNext : styles.ttsExitPrev
                  )}
                  onAnimationEnd={() =>
                    setVoiceTransition((cur) =>
                      cur.tick === voiceTransition.tick ? { ...cur, prev: null } : cur
                    )
                  }
                >
                  <div className={styles.ttsVoiceName}>{t(exitingDraft.nameKey)}</div>
                  <div className={styles.ttsVoiceDesc}>{t(exitingDraft.descKey)}</div>
                </div>
              ) : null}
              <div
                key={`in-${activeDraft.value}-${voiceTransition.tick}`}
                className={clsx(
                  styles.ttsVoiceSlide,
                  voiceTransition.tick > 0 &&
                    (voiceTransition.dir === 'next' ? styles.ttsEnterNext : styles.ttsEnterPrev)
                )}
              >
                <div className={styles.ttsVoiceName}>{t(activeDraft.nameKey)}</div>
                <div className={styles.ttsVoiceDesc}>{t(activeDraft.descKey)}</div>
              </div>
            </div>
            <div role="tablist" aria-label={t('settingsTtsVoice')} className={styles.ttsDots}>
              {mobileTtsVoices.map((item, idx) => {
                const selected = item.value === draftVoice
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-label={t(item.nameKey)}
                    className={clsx(styles.ttsDot, selected && styles.ttsDotActive)}
                    onClick={() =>
                      switchDraftVoice(item.value, idx >= draftIndex ? 'next' : 'prev')
                    }
                  />
                )
              })}
            </div>
          </div>
          <button
            type="button"
            className={styles.ttsSheetConfirm}
            onClick={() => {
              setTtsVoice(draftVoice)
              setSheetOpen(false)
            }}
          >
            {t('confirm')}
          </button>
        </Modal>
      ) : null}
    </>
  )
}

/** 移动端自动朗读：开关行，置于语音播报子页面内 */
const MobileAutoReadAloudSetting = () => {
  const t = useTranslate()
  const autoReadAloud = useSettings((state) => state.autoReadAloud)
  return (
    <div className={clsx(styles.cell, styles.switchHeader)}>
      <div className={styles.labelRow}>
        <span className={styles.label}>{t('settingsAutoReadAloud')}</span>
        <InfoModalButton
          ariaLabel={t('settingsAutoReadAloud')}
          description={t('settingsAutoReadAloudDesc')}
        />
      </div>
      <Switch
        checked={autoReadAloud}
        ariaLabel={t('settingsAutoReadAloud')}
        onChange={setAutoReadAloud}
      />
    </div>
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 自动朗读：回答完成后自动朗读回复内容 */
const AutoReadAloudSetting = () => {
  const t = useTranslate()
  const autoReadAloud = useSettings((state) => state.autoReadAloud)
  return (
    <SettingCell
      label={t('settingsAutoReadAloud')}
      description={t('settingsAutoReadAloudDesc')}
      status={null}
      action={
        <Switch
          checked={autoReadAloud}
          ariaLabel={t('settingsAutoReadAloud')}
          onChange={setAutoReadAloud}
        />
      }
    />
  )
}

const VideoSettings = () => {
  const t = useTranslate()
  const allowVideoUpload = useSettings((state) => state.allowVideoUpload)
  const videoAudioEnabled = useSettings((state) => state.videoAudioEnabled)
  const label = t('settingsAllowVideoUpload')
  const audioLabel = t('settingsVideoAudio')
  return (
    <>
      <div className={clsx(styles.cell, styles.switchHeader)}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{label}</span>
          <InfoModalButton
            ariaLabel={t('videoQuickModeOnly')}
            description={t('videoQuickModeOnly')}
          />
        </div>
        <Switch checked={allowVideoUpload} ariaLabel={label} onChange={setAllowVideoUpload} />
      </div>
      {hasVideoAudioSupport() ? (
        <SettingCell
          label={audioLabel}
          description={t('settingsVideoAudioDesc')}
          infoAsModal
          status={null}
          action={
            <Switch
              checked={videoAudioEnabled}
              disabled={!allowVideoUpload}
              ariaLabel={audioLabel}
              onChange={setVideoAudioEnabled}
            />
          }
        />
      ) : null}
    </>
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const presence = usePresence(historyImport.file !== null, 220)
  if (!presence.mounted) {
    return null
  }
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      visible={presence.visible}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus={!isMobile} onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button
            variant="dangerOutlined"
            size="m"
            disabled={!historyImport.file}
            onClick={() => void historyImport.confirm()}
          >
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

const mobileLocaleOptions: { value: Locale; label: TranslationKey; lang: string }[] = [
  { value: 'zh-CN', label: 'settingsLocaleZhCN', lang: 'zh-CN' },
  { value: 'en-US', label: 'settingsLocaleEnUS', lang: 'en' },
]

const mobileThemeOptions: { value: ThemePreference; label: TranslationKey }[] = [
  { value: 'system', label: 'avatarMenuSettingsDialogThemeSelectSystemOption' },
  { value: 'light', label: 'avatarMenuSettingsDialogThemeSelectLightOption' },
  { value: 'dark', label: 'avatarMenuSettingsDialogThemeSelectDarkOption' },
]

/** 移动端单选设置项：点击行弹出居中单选确认框，供语言与主题共用 */
function MobileRadioSetting<T extends string>({
  title,
  value,
  options,
  onConfirm,
}: {
  title: string
  value: T
  options: { value: T; label: TranslationKey; lang?: string }[]
  onConfirm: (next: T) => void
}) {
  const t = useTranslate()
  const [modalOpen, setModalOpen] = useState(false)
  const modalPresence = usePresence(modalOpen, 220)
  const [draft, setDraft] = useState<T>(value)
  const currentOption = options.find((item) => item.value === value) ?? options[0]

  return (
    <>
      <button
        type="button"
        className={styles.mobileNavRow}
        onClick={() => {
          setDraft(value)
          setModalOpen(true)
        }}
      >
        <span className={styles.label}>{title}</span>
        <span className={styles.mobileNavRight}>
          <span className={styles.mobileNavValue} lang={currentOption?.lang}>
            {currentOption ? t(currentOption.label) : ''}
          </span>
          <IconChevronRightOutline14 />
        </span>
      </button>
      {modalPresence.mounted ? (
        <Modal
          title={title}
          visible={modalPresence.visible}
          className={clsx(styles.themeModal, modalPresence.visible && styles.themeModalVisible)}
          onClose={() => setModalOpen(false)}
        >
          <div role="radiogroup" aria-label={title} className={styles.themeRadioList}>
            {options.map((option) => {
              const checked = draft === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  lang={option.lang}
                  className={styles.themeRadioRow}
                  onClick={() => setDraft(option.value)}
                >
                  <span
                    className={clsx(styles.radioCircle, checked && styles.radioCircleChecked)}
                  />
                  <span className={styles.themeRadioLabel}>{t(option.label)}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className={styles.themeModalConfirm}
            onClick={() => {
              onConfirm(draft)
              setModalOpen(false)
            }}
          >
            {t('confirm')}
          </button>
        </Modal>
      ) : null}
    </>
  )
}

/** 移动端语言设置：左侧标题，右侧当前语言 + 箭头，点击弹出单选确认框 */
const MobileLocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <MobileRadioSetting
      title={t('settingsLocalePreference')}
      value={locale}
      options={mobileLocaleOptions}
      onConfirm={setLocale}
    />
  )
}

/** 移动端外观设置：左侧标题，右侧当前值 + 箭头，点击弹出单选确认框 */
const MobileThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  return (
    <MobileRadioSetting
      title={t('avatarMenuSettingsDialogThemeItemLabel')}
      value={themePreference}
      options={mobileThemeOptions}
      onConfirm={setThemePreference}
    />
  )
}

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  infoAsModal = false,
  status,
  statusAction,
  action,
  className,
}: {
  label: string
  description?: ReactNode
  infoAsModal?: boolean
  status: Status
  statusAction?: ReactNode
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  const inlineDescription = infoAsModal ? undefined : description
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{label}</span>
          {infoAsModal && description ? (
            <InfoModalButton ariaLabel={label} description={description} />
          ) : null}
        </div>
        {status || inlineDescription ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status ? (
              <>
                <span>
                  {t(status.key, status.reason ? { message: t(status.reason) } : status.params)}
                </span>
                {statusAction}
              </>
            ) : (
              inlineDescription
            )}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

const formatFileImportStatus = (progress: HistoryImportProgress): Status => {
  if (progress.stage === 'preparing') {
    return { key: 'historyImportingPreparing' }
  }
  const { sessionCount } = progress
  if (progress.stage === 'saving') {
    if (sessionCount === 1) {
      return { key: 'historyImportingSavingWithCountOne' }
    }
    if (sessionCount > 1) {
      return { key: 'historyImportingSavingWithCount', params: { count: sessionCount } }
    }
    return { key: 'historyImportingSaving' }
  }
  const { percent } = progress
  if (sessionCount === 1) {
    return { key: 'historyImportingProgressWithCountOne', params: { percent } }
  }
  if (sessionCount > 1) {
    return {
      key: 'historyImportingProgressWithCount',
      params: { percent, count: sessionCount },
    }
  }
  return { key: 'historyImportingProgress', params: { percent } }
}

const renderStatusText = (t: ReturnType<typeof useTranslate>, status: Status): string | null =>
  status ? t(status.key, status.reason ? { message: t(status.reason) } : status.params) : null

/** 跨弹窗挂载保留正在进行中的 ZIP 导入进度，防止关掉设置页后重开丢失进度展示 */
const useHistoryImportState = create(() => ({
  busy: false,
  status: null as Status,
}))

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，实时汇报读取与保存进度。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const busy = useHistoryImportState((state) => state.busy)
  const status = useHistoryImportState((state) => state.status)

  const confirm = async () => {
    if (!file || useHistoryImportState.getState().busy) {
      return
    }
    const targetFile = file
    setFile(null)
    useHistoryImportState.setState({
      busy: true,
      status: { key: 'historyImportingPreparing' },
    })

    let lastStage: HistoryImportProgress['stage'] | null = null
    let lastPercent = -1
    let lastSessionCount = -1
    let lastEmitAt = 0

    try {
      const count = await importHistory(targetFile, (progress) => {
        if (progress.stage === 'reading') {
          const now = performance.now()
          const stageChanged = lastStage !== 'reading'
          const percentChanged = progress.percent !== lastPercent
          const countChangedDue =
            progress.sessionCount !== lastSessionCount && now - lastEmitAt >= 100
          if (!stageChanged && !percentChanged && !countChangedDue) {
            return
          }
          lastStage = 'reading'
          lastPercent = progress.percent
          lastSessionCount = progress.sessionCount
          lastEmitAt = now
        } else {
          lastStage = progress.stage
          lastEmitAt = performance.now()
        }
        useHistoryImportState.setState({ status: formatFileImportStatus(progress) })
      })
      useHistoryImportState.setState({
        status: { key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } },
      })
    } catch {
      useHistoryImportState.setState({
        status: { key: 'historyImportFailed', error: true },
      })
    } finally {
      useHistoryImportState.setState({ busy: false })
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件；导入进度与结果展示在卡片/标题下方。 */
const ImportHistory = ({
  historyImport,
  disabled,
  embedded = false,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
  embedded?: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".zip,application/zip,application/x-zip-compressed"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) {
          historyImport.select(file)
        }
      }}
    />
  )

  if (isMobile) {
    const hintText = renderStatusText(t, historyImport.status)

    if (embedded) {
      return (
        <>
          <MobileActionCard
            embedded
            label={t('historyImport')}
            description={t('historyImportDescription')}
            disabled={disabled}
            onAction={() => inputRef.current?.click()}
          >
            {fileInput}
          </MobileActionCard>
          {hintText ? (
            <div
              role="status"
              aria-live="polite"
              className={clsx(
                styles.mobileEmbeddedHint,
                historyImport.status?.error && styles.mobileCardHintError
              )}
            >
              {hintText}
            </div>
          ) : null}
        </>
      )
    }

    return (
      <div className={styles.mobileActionGroup}>
        <MobileActionCard
          label={t('historyImport')}
          description={t('historyImportDescription')}
          disabled={disabled}
          onAction={() => inputRef.current?.click()}
        >
          {fileInput}
        </MobileActionCard>
        {hintText ? (
          <div
            role="status"
            aria-live="polite"
            className={clsx(
              styles.mobileCardHint,
              historyImport.status?.error && styles.mobileCardHintError
            )}
          >
            {hintText}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      infoAsModal
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          {fileInput}
        </>
      }
    />
  )
}

/** 通过粘贴 DeepSeek 历史导出下载链接直接下载并覆盖导入 */
const useHistoryUrlImport = () => {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [progress, setProgress] = useState<HistoryUrlImportProgress | null>(null)
  const importing = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const openModal = () => {
    setUrl('')
    setOpen(true)
  }

  const closeModal = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setOpen(false)
  }

  const submit = async () => {
    if (importing.current) {
      return
    }
    try {
      parseArchiveDownloadUrl(url)
    } catch (error) {
      showToast(
        { key: error instanceof BackupError ? error.key : 'historyUrlInvalid' },
        { placement: 'center' }
      )
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    importing.current = true
    setProgress({ percent: 0 })
    try {
      const count = await importHistoryFromUrl(url, controller.signal, (nextProgress) => {
        if (!controller.signal.aborted) {
          setProgress(nextProgress)
        }
      })
      setOpen(false)
      setUrl('')
      showToast(
        {
          key: count === 1 ? 'historyImportedOne' : 'historyImported',
          params: { count },
        },
        { placement: 'center' }
      )
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }
      if (error instanceof BackupError) {
        showToast({ key: error.key, params: error.params }, { placement: 'center' })
      } else {
        showToast({ key: 'historyUrlDownloadFailed' }, { placement: 'center' })
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
      importing.current = false
      setProgress(null)
    }
  }

  return { open, url, setUrl, busy: progress !== null, progress, openModal, closeModal, submit }
}

/** 从 DeepSeek 链接导入历史会话入口（数据管理卡片 / 桌面设置行） */
const ImportHistoryFromUrl = ({
  urlImport,
  disabled,
  embedded = false,
}: {
  urlImport: ReturnType<typeof useHistoryUrlImport>
  disabled: boolean
  embedded?: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <MobileActionCard
        embedded={embedded}
        label={t('historyImportFromUrl')}
        description={t('historyImportFromUrlDescription')}
        disabled={disabled}
        onAction={urlImport.openModal}
      />
    )
  }

  return (
    <SettingCell
      label={t('historyImportFromUrl')}
      description={t('historyImportFromUrlDescription')}
      infoAsModal
      status={null}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled}
          onClick={urlImport.openModal}
        >
          {t('historyImportFromUrlAction')}
        </Button>
      }
    />
  )
}

/** 填入 URL 菜单：移动端复用朗读音色底部圆角抽屉风格，桌面端使用居中弹窗 */
const UrlImportDialog = ({ urlImport }: { urlImport: ReturnType<typeof useHistoryUrlImport> }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const sheetPresence = usePresence(urlImport.open && isMobile, 280)
  const modalPresence = usePresence(urlImport.open && !isMobile, 220)
  const { progress } = urlImport
  const confirmLabel =
    progress === null
      ? t('confirm')
      : 'percent' in progress
        ? t('historyUrlImporting', { percent: progress.percent })
        : t('historyUrlDownloaded', { size: formatSize(progress.downloadedBytes) })

  const inputNode = (
    <textarea
      aria-label={t('historyUrlModalTitle')}
      className={styles.urlInput}
      placeholder={t('historyUrlPlaceholder')}
      rows={4}
      spellCheck={false}
      // 移动端不自动聚焦：抽屉滑入与软键盘同时进行会整段掉帧，交给用户点
      autoFocus={!isMobile}
      disabled={urlImport.busy}
      value={urlImport.url}
      onChange={(event) => urlImport.setUrl(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          void urlImport.submit()
        }
      }}
    />
  )

  if (isMobile) {
    if (!sheetPresence.mounted) {
      return null
    }
    return (
      <Modal
        title={t('historyUrlModalTitle')}
        closable
        visible={sheetPresence.visible}
        className={clsx(styles.urlSheet, sheetPresence.visible && styles.sheetVisible)}
        mainClassName={styles.urlSheetMain}
        onClose={urlImport.closeModal}
      >
        <div className={styles.urlStage}>{inputNode}</div>
        <button
          type="button"
          className={styles.ttsSheetConfirm}
          disabled={urlImport.busy}
          onClick={() => void urlImport.submit()}
        >
          {confirmLabel}
        </button>
      </Modal>
    )
  }

  if (!modalPresence.mounted) {
    return null
  }

  return (
    <Modal
      title={t('historyUrlModalTitle')}
      visible={modalPresence.visible}
      className={styles.urlModal}
      onClose={urlImport.closeModal}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={urlImport.closeModal}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            size="m"
            disabled={urlImport.busy || !urlImport.open}
            onClick={() => void urlImport.submit()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {inputNode}
    </Modal>
  )
}

const formatExportTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const exportRecordStatus = (record: ExportRecord | null): Status => {
  if (!record) {
    return null
  }
  const time = formatExportTime(record.exportedAt)
  if (record.isAndroid && record.path) {
    return {
      key: 'historyExportSuccessWithPath',
      params: { time, path: record.path },
    }
  }
  return {
    key: 'historyExportSuccessBrowser',
    params: { time, fileName: record.fileName },
  }
}

/** 将全部会话及图片导出为 ZIP 文件并下载；导出结果与路径展示在卡片/标题下方 */
const ExportHistory = ({
  disabled,
  embedded = false,
}: {
  disabled: boolean
  embedded?: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(() => exportRecordStatus(getLastExportRecord()))
  const actionDisabled = disabled || busy || empty

  const onExport = async () => {
    setBusy(true)
    setStatus({ key: 'historyExporting' })
    try {
      const record = await exportAndSaveHistory()
      setStatus(exportRecordStatus(record))
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  const showOpenFolder = status?.key === 'historyExportSuccessWithPath' && canOpenExportFolder()

  const onOpenFolder = () => {
    if (!openExportFolder()) {
      showToast({ key: 'historyExportOpenFolderFailed' }, { placement: 'center' })
    }
  }

  const openFolderLink = showOpenFolder ? (
    <>
      {' '}
      <button type="button" className={styles.inlineActionLink} onClick={onOpenFolder}>
        <span>{t('historyExportOpenFolder')}</span>
        <span className={styles.inlineActionIcon} aria-hidden="true">
          <IconRightUpOutline14 />
        </span>
      </button>
    </>
  ) : null

  if (isMobile) {
    const hintText = status
      ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
      : null

    if (embedded) {
      return (
        <>
          <MobileActionCard
            embedded
            label={t('exportAllLabel')}
            description={t('historyExportDescription')}
            disabled={actionDisabled}
            onAction={() => void onExport()}
          />
          {hintText ? (
            <div
              className={clsx(
                styles.mobileEmbeddedHint,
                status?.error && styles.mobileCardHintError
              )}
            >
              <span>{hintText}</span>
              {openFolderLink}
            </div>
          ) : null}
        </>
      )
    }

    return (
      <div className={styles.mobileActionGroup}>
        <MobileActionCard
          label={t('exportAllLabel')}
          description={t('historyExportDescription')}
          disabled={actionDisabled}
          onAction={() => void onExport()}
        />
        {hintText ? (
          <div className={clsx(styles.mobileCardHint, status?.error && styles.mobileCardHintError)}>
            <span>{hintText}</span>
            {openFolderLink}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      infoAsModal
      status={status}
      statusAction={openFolderLink}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={actionDisabled}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
