import { useCallback, useEffect, useRef, useState } from 'react'
import { synthesize, transcribe } from '../../services/api/speech.js'
import { describeReply } from '../../services/chat/describe.js'
import { noteMemoryActivity } from '../../services/chat/globalMemory.js'
import { sendLiveMessage, type LiveToolActivity } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { buildReplyView } from '../../services/chat/view.js'
import { useSettings } from '../../services/settings.js'
import type { SpeechOutput } from '../../services/speech/pcmPlayback.js'
import { describeReadAloudError } from '../../services/speech/readAloud.js'
import { startMicrophone } from '../../services/speech/recorder.js'
import { createVoiceActivity } from '../../services/speech/voiceActivity.js'
import { showToast } from '../base/toastState.js'
import { playLiveToolCue } from './liveToolCue.js'

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
  const [toolActivity, setToolActivity] = useState<LiveToolActivity | null>(null)
  const capture = useRef<Capture | null>(null)
  const turn = useRef<AbortController | null>(null)
  const playing = useRef(false)

  const interrupt = useCallback(() => {
    turn.current?.abort()
    turn.current = null
    playing.current = false
    setToolActivity(null)
    setPhase('idle')
  }, [])

  const submit = useCallback(
    async (input: string | Blob) => {
      interrupt()
      const controller = new AbortController()
      const { signal } = controller
      const { apiKey, ttsVoice, locale } = useSettings.getState()
      turn.current = controller
      const filler: {
        controller: AbortController | null
        task: Promise<void> | null
        triggered: boolean
        audible: boolean
      } = {
        controller: null,
        task: null,
        triggered: false,
        audible: false,
      }
      let answerPlaying = false
      const abortFiller = () => {
        filler.controller?.abort()
      }
      signal.addEventListener('abort', abortFiller, { once: true })
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
        const onLiveTool = (activity: LiveToolActivity | null) => {
          if (!__BETA__ || signal.aborted) {
            return
          }
          setToolActivity(activity)
          if (!activity || filler.triggered || !call.output || !apiKey) {
            return
          }
          filler.triggered = true
          const cueController = new AbortController()
          filler.controller = cueController
          filler.task = playLiveToolCue(
            call.output,
            { apiKey, voice: ttsVoice, locale, activity },
            cueController.signal,
            () => {
              if (signal.aborted || cueController.signal.aborted) {
                return
              }
              filler.audible = true
              playing.current = true
              setPhase('speaking')
            }
          )
            .catch(() => {
              // 过渡语失败静默跳过，不影响主回答
            })
            .finally(() => {
              if (turn.current !== controller || signal.aborted || answerPlaying) {
                return
              }
              playing.current = false
              setPhase('answering')
            })
        }
        const reply = await sendLiveMessage(
          call.session,
          text,
          controller,
          __BETA__ ? onLiveTool : undefined
        )
        setToolActivity(null)
        if (!reply || signal.aborted) {
          abortFiller()
          return
        }
        if (reply.status === 'error') {
          abortFiller()
          showToast(describeReply(reply, 'fast')?.text || { key: 'liveReplyFailed' })
          return
        }
        const answer = buildReplyView(reply, false).answer?.text.trim()
        if (!answer || reply.stopReason === 'refusal') {
          abortFiller()
          return
        }
        if (!call.output) {
          showToast({ key: 'ttsFailed' })
          return
        }
        if (filler.task && !filler.audible) {
          abortFiller()
        }
        try {
          const streamPromise = synthesize(apiKey ?? '', answer, ttsVoice, signal)
          void streamPromise.catch(() => {})
          if (filler.task) {
            await filler.task
            signal.throwIfAborted()
          }
          const stream = await streamPromise
          await call.output.play(stream, signal, () => {
            answerPlaying = true
            playing.current = true
            setPhase('speaking')
          })
        } catch (error) {
          abortFiller()
          if (!signal.aborted) {
            showToast(describeReadAloudError(error))
          }
        }
      } catch {
        abortFiller()
        if (!signal.aborted) {
          showToast({ key: 'liveReplyFailed' })
        }
      } finally {
        signal.removeEventListener('abort', abortFiller)
        abortFiller()
        if (turn.current === controller) {
          turn.current = null
          playing.current = false
          setToolActivity(null)
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
    if (!__BETA__) {
      return
    }
    const activityKey = `live:${call.session.id}`
    noteMemoryActivity(activityKey, true)
    return () => noteMemoryActivity(activityKey, false)
  }, [call.session.id])

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
    toolActivity,
    interrupt,
    close,
    submit,
    toggleMic: mic === 'on' || mic === 'opening' ? mute : enableMic,
  }
}
