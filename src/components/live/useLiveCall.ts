import { useCallback, useEffect, useRef, useState } from 'react'
import { synthesize, transcribe } from '../../services/api/speech.js'
import { describeReply } from '../../services/chat/describe.js'
import { sendLiveMessage } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { buildReplyView } from '../../services/chat/view.js'
import { useSettings } from '../../services/settings.js'
import type { SpeechOutput } from '../../services/speech/pcmPlayback.js'
import { describeReadAloudError } from '../../services/speech/readAloud.js'
import { startMicrophone } from '../../services/speech/recorder.js'
import { createVoiceActivity } from '../../services/speech/voiceActivity.js'
import { showToast } from '../base/toastState.js'

export type LiveCall = {
  session: Session
  output: SpeechOutput | null
}

type MicStatus = 'opening' | 'on' | 'off' | 'unavailable'
type Phase = 'idle' | 'transcribing' | 'answering' | 'speaking'
type Capture = {
  controller: AbortController
  detector: ReturnType<typeof createVoiceActivity>
}

export const useLiveCall = (call: LiveCall) => {
  const [mic, setMic] = useState<MicStatus>('opening')
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [hearing, setHearing] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const capture = useRef<Capture | null>(null)
  const turn = useRef<AbortController | null>(null)
  const playing = useRef(false)

  const interrupt = useCallback(() => {
    turn.current?.abort()
    turn.current = null
    playing.current = false
    setPhase('idle')
  }, [])

  const submit = useCallback(
    async (input: string | Blob) => {
      interrupt()
      const controller = new AbortController()
      const { signal } = controller
      const { apiKey, ttsVoice } = useSettings.getState()
      turn.current = controller
      try {
        let text: string
        if (typeof input === 'string') {
          capture.current?.detector.reset()
          setHearing(false)
          text = input.trim()
        } else {
          setPhase('transcribing')
          try {
            text = (await transcribe(apiKey ?? '', input, signal)).trim()
          } catch {
            if (!signal.aborted) {
              showToast({ key: 'voiceInputFailed' })
            }
            return
          }
          if (!signal.aborted && !text) {
            showToast({ key: 'voiceInputEmpty' })
          }
        }
        if (!text || signal.aborted) {
          return
        }
        setPhase('answering')
        const reply = await sendLiveMessage(call.session, text, controller)
        if (!reply || signal.aborted) {
          return
        }
        if (reply.status === 'error') {
          showToast(describeReply(reply, 'fast')?.text || { key: 'liveReplyFailed' })
          return
        }
        const answer = buildReplyView(reply, false).answer?.text.trim()
        if (!answer || reply.stopReason === 'refusal') {
          return
        }
        if (!call.output) {
          showToast({ key: 'ttsFailed' })
          return
        }
        try {
          const stream = await synthesize(apiKey ?? '', answer, ttsVoice, signal)
          await call.output.play(stream, signal, () => {
            playing.current = true
            setPhase('speaking')
          })
        } catch (error) {
          if (!signal.aborted) {
            showToast(describeReadAloudError(error))
          }
        }
      } catch {
        if (!signal.aborted) {
          showToast({ key: 'liveReplyFailed' })
        }
      } finally {
        if (turn.current === controller) {
          turn.current = null
          playing.current = false
          setPhase('idle')
        }
      }
    },
    [call, interrupt]
  )

  const enableMic = useCallback(async () => {
    if (capture.current) {
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMic('unavailable')
      return
    }
    const controller = new AbortController()
    const { signal } = controller
    const detector = createVoiceActivity(
      () => {
        interrupt()
        setHearing(true)
      },
      (wav) => {
        setHearing(false)
        void submit(wav)
      }
    )
    capture.current = { controller, detector }
    setMic('opening')
    try {
      const { analyser } = await startMicrophone(
        (samples) => {
          if (!signal.aborted) {
            detector.push(samples, playing.current)
          }
        },
        { bufferSize: 1024, signal }
      )
      if (!signal.aborted) {
        setAnalyser(analyser)
        setMic('on')
      }
    } catch {
      if (!signal.aborted) {
        capture.current = null
        setMic('unavailable')
      }
    }
  }, [interrupt, submit])

  const releaseMic = useCallback(() => {
    capture.current?.controller.abort()
    capture.current = null
  }, [])

  const mute = useCallback(() => {
    releaseMic()
    setAnalyser(null)
    setHearing(false)
    setMic('off')
  }, [releaseMic])

  const close = useCallback(() => {
    releaseMic()
    turn.current?.abort()
    turn.current = null
    call.output?.close()
  }, [call, releaseMic])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        mute()
        interrupt()
      }
    }
    if (document.hidden) {
      mute()
    } else {
      void enableMic()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      close()
    }
  }, [close, enableMic, interrupt, mute])

  return {
    mic,
    analyser,
    hearing,
    phase,
    interrupt,
    close,
    submit,
    toggleMic: mic === 'on' || mic === 'opening' ? mute : enableMic,
  }
}
