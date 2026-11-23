import { TTS_SAMPLE_RATE } from '../api/speech.js'

const START_DELAY = 0.1

const toFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

/** 播放 DeepSeek TTS 的 24 kHz PCM，并提供实际输出的频谱。 */
export const createSpeechOutput = () => {
  const context = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })
  const analyser = context.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.5
  analyser.connect(context.destination)
  if (context.state === 'suspended') {
    void context.resume().catch(() => {})
  }

  const play = async (
    stream: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    onPlaying: () => void
  ) => {
    const reader = stream.getReader()
    const scheduled = new Set<AudioBufferSourceNode>()
    let nextTime = context.currentTime
    let receivedAudio = false
    let rest = new Uint8Array(0)
    let onDrained: (() => void) | undefined

    const cancel = () => {
      void reader.cancel().catch(() => {})
      for (const source of scheduled) {
        source.onended = null
        source.stop()
        source.disconnect()
      }
      scheduled.clear()
      onDrained?.()
    }

    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        signal.throwIfAborted()
        const bytes = new Uint8Array(rest.length + value.length)
        bytes.set(rest)
        bytes.set(value, rest.length)
        const samples = toFloat32(bytes)
        rest = bytes.slice(samples.length * 2)
        if (samples.length === 0) {
          continue
        }
        const buffer = context.createBuffer(1, samples.length, TTS_SAMPLE_RATE)
        buffer.copyToChannel(samples, 0)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(analyser)
        nextTime = Math.max(nextTime, context.currentTime + (receivedAudio ? 0 : START_DELAY))
        source.start(nextTime)
        scheduled.add(source)
        source.onended = () => {
          source.disconnect()
          scheduled.delete(source)
          if (scheduled.size === 0) {
            onDrained?.()
          }
        }
        nextTime += buffer.duration
        if (!receivedAudio) {
          receivedAudio = true
          onPlaying()
        }
      }
      if (scheduled.size > 0) {
        await new Promise<void>((resolve) => {
          onDrained = resolve
        })
      }
      signal.throwIfAborted()
    } catch (error) {
      cancel()
      throw error
    } finally {
      signal.removeEventListener('abort', cancel)
      reader.releaseLock()
    }
  }

  return {
    analyser,
    play,
    close: () => {
      if (context.state !== 'closed') {
        void context.close().catch(() => {})
      }
    },
  }
}

export type SpeechOutput = ReturnType<typeof createSpeechOutput>
