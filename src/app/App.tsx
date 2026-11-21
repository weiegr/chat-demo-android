import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
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
import { SessionView } from '../components/session/SessionView.js'
import { LiveCallView } from '../components/live/LiveCallView.js'
import type { LiveCall } from '../components/live/useLiveCall.js'
import { createSpeechOutput, type SpeechOutput } from '../services/speech/pcmPlayback.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
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
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider } from '../components/sider/Sider.js'
import { Sidebar } from '../components/sider/Sidebar.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const [liveCall, setLiveCall] = useState<LiveCall | null>(null)
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
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

  useEffect(() => {
    void initChat()
    // 首次打开先在设置里输入 API Key
    ensureApiKey()
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

  return (
    <>
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
            <main className={styles.main}>
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
              <div className={styles.content}>
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
                  <Welcome onStartCall={openLiveCall} />
                )}
              </div>
            </main>
          </>
        )}
        <SearchPanel />
      </div>
      <SettingsDialog />
      <ImagePreview />
      <Toast />
    </>
  )
}
