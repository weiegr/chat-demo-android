import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useTranslate } from '../i18n/index.js'
import { initApiKey, useSettings } from '../services/settings.js'
import { initChatBackgrounds, useActiveChatBackgroundUrl } from '../services/chatBackground.js'
import { initLiveAvatars } from '../services/liveAvatar.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  createLiveSession,
  initChat,
  newChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { ChatSearchView } from '../components/search/ChatSearchView.js'
import { openChatSearch, useChatSearch } from '../components/search/chatSearchState.js'
import { SessionView } from '../components/session/SessionView.js'
import {
  ComposerSnapshotBridge,
  type ComposerViewKind,
} from '../components/session/composerTransition.js'
import { LiveCallView } from '../components/live/LiveCallView.js'
import type { LiveCall } from '../components/live/useLiveCall.js'
import { createSpeechOutput, type SpeechOutput } from '../services/speech/pcmPlayback.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { RpContextProgress } from '../components/session/RpContextProgress.js'
import { Welcome } from '../components/session/Welcome.js'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { ImagePreview } from '../components/messages/ImagePreview.js'
import { closeImagePreview } from '../components/messages/imagePreviewState.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { isEphemeralStorage } from '../services/chat/db.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import {
  bindSiderMain,
  clearSiderMainInline,
  closeMobileSider,
  useMobileSider,
} from '../components/sider/mobileSiderState.js'
import { MobileSider } from '../components/sider/Sider.js'
import { Sidebar } from '../components/sider/Sidebar.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const [liveCall, setLiveCall] = useState<LiveCall | null>(null)
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const chatMode = useSettings((state) => state.chatMode)
  const chatParallaxEnabled = useSettings((state) => state.chatParallaxEnabled)
  const activeChatBgUrl = useActiveChatBackgroundUrl()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const chatBgParallaxRef = useRef<HTMLDivElement | null>(null)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const mobileSiderOpen = useMobileSider((state) => state.open)
  const chatSearchOpen = useChatSearch((state) => state.open)
  const [siderSettling, setSiderSettling] = useState(false)
  const siderCardOpen = isMobile && (mobileSiderOpen || chatSearchOpen)
  const prevSiderCardOpenRef = useRef(false)

  // 侧边栏/搜索收起后的 320ms 过渡期内保留合成层，合拢完毕后自动释放离屏层
  useEffect(() => {
    const wasOpen = prevSiderCardOpenRef.current
    prevSiderCardOpenRef.current = siderCardOpen
    if (siderCardOpen) {
      setSiderSettling(false)
      return
    }
    if (!wasOpen) {
      return
    }
    setSiderSettling(true)
    const timer = window.setTimeout(() => setSiderSettling(false), 320)
    return () => window.clearTimeout(timer)
  }, [siderCardOpen])

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时收起图片预览
  useEffect(closeImagePreview, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  // 电脑端 Ctrl+J（macOS 上 ⌘J）开启新对话；有弹窗打开时不抢快捷键
  useEffect(() => {
    if (isMobile) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'j' ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        return
      }
      event.preventDefault()
      newChat()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMobile])

  // 电脑端 Ctrl+K（macOS 上 ⌘K）打开会话搜索，与侧边栏搜索框是同一个入口
  useEffect(() => {
    if (isMobile) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'k' ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        return
      }
      event.preventDefault()
      openChatSearch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMobile])

  useEffect(() => {
    void initChat()
    void initChatBackgrounds()
    void initLiveAvatars()
    // 等待读取或迁移完成，只有需要输入 API Key 时才打开设置。
    void initApiKey().then(ensureApiKey)
  }, [])

  // 不透明来源（content:// 等）下存储不可用，只在此次会话内有效，打开时说明一次
  const ephemeralNoticeShown = useRef(false)
  useEffect(() => {
    if (!isEphemeralStorage || ephemeralNoticeShown.current) {
      return
    }
    ephemeralNoticeShown.current = true
    showToast(t('storageEphemeral'))
  }, [t])

  const openLiveCall = useCallback(
    (sourceId: string | null) => {
      const session = createLiveSession(sourceId)
      if (!session || liveCall || !ensureApiKey()) {
        return
      }
      stopReadAloud()
      let output: SpeechOutput | null = null
      try {
        // 同步在点击事件内解锁输出，后续收到回复时可直接播放。
        output = createSpeechOutput()
      } catch {
        // 设备无法播放时仍可在通话界面发送和阅读文字。
      }
      newChat()
      setLiveCall({ session, output })
    },
    [liveCall]
  )

  const handleMainInputEngage = (target: EventTarget | null) => {
    if (
      !isMobile ||
      !mobileSiderOpen ||
      chatSearchOpen ||
      !(target instanceof Element) ||
      !target.closest('textarea, input:not([type="file"])')
    ) {
      return
    }
    clearSiderMainInline()
    closeMobileSider()
  }

  const currentChatMode = session ? (session.mode ?? 'fast') : chatMode
  const viewKind: ComposerViewKind | null =
    !ready || (activeId !== null && !session) ? null : session ? 'session' : 'welcome'
  const showChatBackground =
    Boolean(activeChatBgUrl) &&
    (currentChatMode === 'fast' || currentChatMode === 'expert' || currentChatMode === 'rp')

  return (
    <RpContextProgress>
      <div ref={frameRef} className={styles.frame}>
        {liveCall ? (
          <LiveCallView
            call={liveCall}
            onHangUp={() => {
              setLiveCall(null)
              selectSession(liveCall.session.id)
            }}
          />
        ) : (
          <>
            {isMobile ? <MobileSider /> : <Sidebar collapsed={siderCollapsed} />}
            <main
              ref={bindSiderMain}
              data-sider-active={siderCardOpen || siderSettling ? 'true' : undefined}
              className={clsx(
                styles.main,
                isMobile && mobileSiderOpen && styles.mainPushed,
                isMobile && chatSearchOpen && styles.mainSearchPushed
              )}
              onFocusCapture={(event) => handleMainInputEngage(event.target)}
              onClickCapture={(event) => handleMainInputEngage(event.target)}
            >
              {saveError ? (
                <div className={styles.saveError} role="alert">
                  <span>{t('sessionSaveFailed')}</span>
                  <Button
                    variant="outlined"
                    size="s"
                    disabled={importingHistory}
                    onClick={retrySaveSessions}
                  >
                    {t('retry')}
                  </Button>
                </div>
              ) : null}
              <div
                ref={contentRef}
                className={styles.content}
                data-chat-bg={showChatBackground ? 'true' : undefined}
              >
                <ComposerSnapshotBridge viewKind={viewKind} containerRef={contentRef} />
                {showChatBackground && activeChatBgUrl ? (
                  <div className={styles.chatBackgroundLayer} aria-hidden="true">
                    <div
                      ref={chatBgParallaxRef}
                      className={clsx(
                        styles.chatBackgroundParallax,
                        chatParallaxEnabled && styles.chatBackgroundParallaxBleed
                      )}
                    >
                      <img
                        src={activeChatBgUrl}
                        alt=""
                        draggable={false}
                        className={styles.chatBackgroundImage}
                      />
                      <div className={styles.chatBackgroundScrim} />
                    </div>
                  </div>
                ) : null}
                {isMobile ? null : <CollapsedSider collapsed={siderCollapsed} />}
                {!ready || (activeId !== null && !session) ? (
                  <div className={styles.loadingView}>
                    {isMobile ? <MobileHeader /> : null}
                    <div className={styles.loadingState} role="status" aria-live="polite">
                      <span>
                        {(!ready ? initError : sessionLoadError)
                          ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                          : t('sessionLoading')}
                      </span>
                      {(!ready ? initError : sessionLoadError) ? (
                        <Button
                          variant="outlined"
                          size="m"
                          onClick={() => {
                            if (!ready) {
                              void initChat()
                            } else if (activeId !== null) {
                              selectSession(activeId)
                            }
                          }}
                        >
                          {t('retry')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : session ? (
                  <SessionView
                    session={session}
                    streaming={streaming}
                    siderCollapsed={siderCollapsed}
                    onStartCall={openLiveCall}
                  />
                ) : (
                  <Welcome onStartCall={openLiveCall} bgParallaxRef={chatBgParallaxRef} />
                )}
              </div>
            </main>
          </>
        )}
        <SearchPanel />
        <ChatSearchView />
      </div>
      <SettingsDialog />
      <ImagePreview />
      <Toast />
    </RpContextProgress>
  )
}
