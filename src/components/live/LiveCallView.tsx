import clsx from 'clsx'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { getImeMotionState, hasNativeImeMotion, subscribeImeMotion } from '../../app/imeMotion.js'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { useChatStore, type LiveToolActivity } from '../../services/chat/store.js'
import { getAudioLevel } from '../../services/speech/voiceActivity.js'
import { IconButton } from '../base/IconButton.js'
import {
  IconMicOutline16,
  IconNotebookOutline20,
  IconPhoneOutline20,
  IconSendOutline16,
} from '../base/icons.js'
import { ChatModeToggles } from '../chatInput/ChatModeToggles.js'
import { ChatTextarea } from '../chatInput/ChatTextarea.js'
import inputStyles from '../chatInput/ChatInput.module.css'
import { Spectrum } from '../chatInput/Spectrum.js'
import { MessageList } from '../messages/MessageList.js'
import { closeSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import sessionStyles from '../session/SessionView.module.css'
import { useLiveCall, type LiveCall } from './useLiveCall.js'
import { createBetaLiveImeController } from './liveImeLayout.js'
import styles from './LiveCallView.module.css'

const MIC_LABELS = {
  opening: 'liveOpeningMic',
  on: 'liveListening',
  off: 'liveMicOff',
  unavailable: 'liveMicUnavailable',
} as const satisfies Record<string, TranslationKey>

const PHASE_LABELS = {
  transcribing: 'liveTranscribing',
  answering: 'liveAnswering',
  speaking: 'liveSpeaking',
} as const satisfies Record<string, TranslationKey>

const TOOL_LABELS = {
  memory: 'liveToolMemory',
  search: 'liveToolSearch',
  read_link: 'liveToolReadLink',
  location: 'liveToolLocation',
} as const satisfies Record<LiveToolActivity, TranslationKey>

const LIVE_TITLE = 'DeepSeek Live'

export const LiveCallView = ({ call, onHangUp }: { call: LiveCall; onHangUp: () => void }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [text, setText] = useState('')
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const orbGroupRef = useRef<HTMLDivElement>(null)
  const visualizerRef = useRef<HTMLButtonElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const orbRef = useRef<HTMLSpanElement>(null)
  const transcriptOpenRef = useRef(transcriptOpen)
  transcriptOpenRef.current = transcriptOpen
  const betaImeRef = useRef<ReturnType<typeof createBetaLiveImeController> | null>(null)
  const { mic, analyser, hearing, phase, toolActivity, toggleMic, submit, interrupt, close } =
    useLiveCall(call)
  const session = useChatStore((state) => state.sessionCache[call.session.id]) ?? call.session
  const streaming = useChatStore((state) => Object.hasOwn(state.streaming, call.session.id))
  const getOutputAnalyser = useCallback(() => call.output?.analyser ?? null, [call])
  const hangUp = useCallback(() => {
    closeSearchPanel()
    close()
    onHangUp()
  }, [close, onHangUp])

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  // Android 原生键盘动效：通话页底部输入框与主舞台纯 GPU 上移，不触发 WebView Resize
  useLayoutEffect(() => {
    const form = formRef.current
    const stage = stageRef.current
    if (!isMobile || !hasNativeImeMotion() || !form || !stage) {
      return
    }
    if (__BETA__) {
      const orbGroup = orbGroupRef.current
      const visualizer = visualizerRef.current
      if (!orbGroup || !visualizer) {
        return
      }
      const notebook = orbGroup.querySelector<HTMLButtonElement>(`.${styles.notebook}`)
      const controller = createBetaLiveImeController(
        { form, stage, orbGroup, visualizer, notebook },
        () => transcriptOpenRef.current
      )
      betaImeRef.current = controller
      const initial = getImeMotionState()
      controller.apply(initial.shift, initial.animating, 'none', !initial.animating)
      const unsubscribe = subscribeImeMotion((phase, ime) => {
        if (phase === 'prepare') {
          controller.prepare()
          return
        }
        controller.apply(
          ime.shift,
          ime.animating,
          phase === 'end' && ime.smoothSettle ? 'settle' : 'none',
          phase === 'end'
        )
      })
      const resizeObserver =
        typeof ResizeObserver === 'function'
          ? new ResizeObserver(() => {
              controller.syncMetrics('none')
            })
          : null
      resizeObserver?.observe(stage)
      return () => {
        resizeObserver?.disconnect()
        unsubscribe()
        controller.dispose()
        if (betaImeRef.current === controller) {
          betaImeRef.current = null
        }
      }
    }
    const SMOOTH_SETTLE_TRANSITION = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)'
    const reducedMotion = () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let smoothTimer: number | null = null

    const clearSmooth = () => {
      if (smoothTimer !== null) {
        window.clearTimeout(smoothTimer)
        smoothTimer = null
      }
      form.style.removeProperty('transition')
      stage.style.removeProperty('transition')
    }

    const apply = (shift: number, animating: boolean, smoothSettle = false) => {
      clearSmooth()
      if (smoothSettle && !reducedMotion()) {
        form.style.willChange = 'transform'
        stage.style.willChange = 'transform'
        form.style.transition = SMOOTH_SETTLE_TRANSITION
        stage.style.transition = SMOOTH_SETTLE_TRANSITION
        form.style.transform =
          shift > 0.05 ? `translate3d(0, ${(-shift).toFixed(2)}px, 0)` : 'translate3d(0, 0, 0)'
        stage.style.transform =
          shift > 0.05
            ? `translate3d(0, ${(-shift * 0.4).toFixed(2)}px, 0)`
            : 'translate3d(0, 0, 0)'
        smoothTimer = window.setTimeout(() => {
          smoothTimer = null
          form.style.removeProperty('transition')
          stage.style.removeProperty('transition')
          if (shift <= 0.05) {
            form.style.removeProperty('transform')
            stage.style.removeProperty('transform')
            form.style.removeProperty('will-change')
            stage.style.removeProperty('will-change')
          }
        }, 200)
        return
      }
      if (animating) {
        form.style.willChange = 'transform'
        stage.style.willChange = 'transform'
      } else if (shift <= 0.05) {
        form.style.removeProperty('will-change')
        stage.style.removeProperty('will-change')
      }
      if (shift > 0.05) {
        form.style.transform = `translate3d(0, ${(-shift).toFixed(2)}px, 0)`
        stage.style.transform = `translate3d(0, ${(-shift * 0.4).toFixed(2)}px, 0)`
      } else {
        form.style.removeProperty('transform')
        stage.style.removeProperty('transform')
      }
    }
    const initial = getImeMotionState()
    apply(initial.shift, initial.animating)
    const unsubscribe = subscribeImeMotion((phase, ime) => {
      if (phase === 'prepare') {
        clearSmooth()
        form.style.willChange = 'transform'
        stage.style.willChange = 'transform'
        return
      }
      apply(ime.shift, ime.animating, phase === 'end' && ime.smoothSettle)
    })
    return () => {
      unsubscribe()
      clearSmooth()
      form.style.removeProperty('transform')
      form.style.removeProperty('will-change')
      stage.style.removeProperty('transform')
      stage.style.removeProperty('will-change')
    }
  }, [isMobile])

  useLayoutEffect(() => {
    if (__BETA__) {
      betaImeRef.current?.syncMetrics('layout')
    }
  }, [transcriptOpen])

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) {
        return
      }
      event.preventDefault()
      if (useSearchPanel.getState().entry) {
        closeSearchPanel()
      } else if (transcriptOpen) {
        setTranscriptOpen(false)
      } else {
        hangUp()
      }
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [hangUp, transcriptOpen])

  useEffect(() => {
    const orb = orbRef.current
    if (!analyser || !orb || !hearing || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    const samples = new Float32Array(analyser.fftSize)
    let frame = 0
    let scale = 1
    let velocity = 0
    const tick = () => {
      analyser.getFloatTimeDomainData(samples)
      const target = 1 + Math.min(0.23, getAudioLevel(samples) * 3)
      velocity = (velocity + (target - scale) * 0.23) * 0.69
      scale += velocity
      orb.style.setProperty('--mic-scale', String(scale))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      orb.style.removeProperty('--mic-scale')
    }
  }, [analyser, hearing])

  const canSend = Boolean(text.trim())
  const send = () => {
    if (!canSend) {
      return
    }
    void submit(text)
    setText('')
    if (isMobile) {
      textareaRef.current?.blur()
    }
  }

  const thinking = phase === 'answering'
  const playing = phase === 'speaking'
  const micEnabled = mic === 'on' || mic === 'opening'
  const micLabel = t(micEnabled ? 'liveMute' : 'liveUnmute')
  const status =
    __BETA__ && (phase === 'answering' || phase === 'speaking') && toolActivity
      ? TOOL_LABELS[toolActivity]
      : phase !== 'idle'
        ? PHASE_LABELS[phase]
        : hearing
          ? 'liveHearing'
          : MIC_LABELS[mic]

  return (
    <section
      ref={rootRef}
      className={clsx(styles.call, transcriptOpen && styles.historyOpen)}
      {...(__BETA__ ? { 'data-beta-live-ime': '' } : {})}
      role="dialog"
      aria-modal="true"
      aria-label={LIVE_TITLE}
      tabIndex={-1}
    >
      <header className={styles.header}>
        <IconButton
          size="xl"
          tone="primary"
          className={clsx(styles.microphone, !micEnabled && styles.muted)}
          icon={<IconMicOutline16 />}
          aria-label={micLabel}
          onClick={() => void toggleMic()}
        />
        <div className={styles.heading}>
          <h1>{LIVE_TITLE}</h1>
          <span role="status">{t(status)}</span>
        </div>
        <IconButton
          size="xl"
          className={styles.hangUp}
          icon={<IconPhoneOutline20 />}
          aria-label={t('liveHangUp')}
          onClick={hangUp}
        />
      </header>

      <div ref={stageRef} className={styles.stage}>
        <div ref={orbGroupRef} className={styles.orbGroup}>
          <button
            ref={visualizerRef}
            type="button"
            className={clsx(
              styles.visualizer,
              thinking && styles.thinking,
              playing && styles.playing
            )}
            aria-label={t('liveTapToInterrupt')}
            title={phase !== 'idle' ? t('liveTapToInterrupt') : undefined}
            disabled={phase === 'idle'}
            onClick={interrupt}
          >
            <span ref={orbRef} className={styles.orbMotion} aria-hidden="true">
              <span className={styles.orb} />
            </span>
            {thinking ? <span className={styles.loadingRing} aria-hidden="true" /> : null}
            {playing ? (
              <Spectrum
                className={styles.wave}
                getAnalyser={getOutputAnalyser}
                barCount={5}
                dbFloor={-64}
                dbCeil={-14}
                smoothNeighbors={false}
              />
            ) : null}
          </button>

          <IconButton
            size="m"
            tone="primary"
            className={clsx(styles.notebook, transcriptOpen && styles.selected)}
            icon={<IconNotebookOutline20 />}
            aria-label={t('liveTranscript')}
            aria-expanded={transcriptOpen}
            aria-controls={panelId}
            onClick={() => {
              closeSearchPanel()
              setTranscriptOpen(!transcriptOpen)
            }}
          />
        </div>

        <div id={panelId} className={styles.history} aria-hidden={!transcriptOpen}>
          {transcriptOpen &&
            (session.messages.length > 0 ? (
              <MessageList session={session} streaming={streaming} readOnly />
            ) : (
              <div className={styles.empty}>{t('liveTranscriptEmpty')}</div>
            ))}
        </div>
      </div>

      <form
        ref={formRef}
        className={sessionStyles.inputContainer}
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <div className={clsx(inputStyles.wrapper, inputStyles.session, styles.composer)}>
          <ChatTextarea
            inputRef={textareaRef}
            value={text}
            ariaLabel={t('liveInputPlaceholder')}
            onTextChange={setText}
            onSend={send}
          />
          <div className={inputStyles.functionRow}>
            <ChatModeToggles mode="fast" />
            <div className={inputStyles.right}>
              <button
                type="submit"
                className={clsx(inputStyles.sendButton, !canSend && inputStyles.disabled)}
                aria-label={t('send')}
                disabled={!canSend}
              >
                <IconSendOutline16 />
              </button>
            </div>
          </div>
        </div>
      </form>
    </section>
  )
}
