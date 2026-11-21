import clsx from 'clsx'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
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

const LIVE_TITLE = 'DeepSeek Live'

export const LiveCallView = ({ call, onHangUp }: { call: LiveCall; onHangUp: () => void }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const [text, setText] = useState('')
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const orbRef = useRef<HTMLSpanElement>(null)
  const { mic, analyser, hearing, phase, toggleMic, submit, interrupt, close } = useLiveCall(call)
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
  const status = phase !== 'idle' ? PHASE_LABELS[phase] : hearing ? 'liveHearing' : MIC_LABELS[mic]

  return (
    <section
      ref={rootRef}
      className={clsx(styles.call, transcriptOpen && styles.historyOpen)}
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

      <div className={styles.stage}>
        <div className={styles.orbGroup}>
          <button
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
