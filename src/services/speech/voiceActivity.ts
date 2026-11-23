import { encodeWav, MAX_SECONDS, SAMPLE_RATE } from './recorder.js'

const PRE_ROLL_SAMPLES = 0.32 * SAMPLE_RATE
const VOICE_START_SAMPLES = 0.12 * SAMPLE_RATE
const INTERRUPT_START_SAMPLES = 0.18 * SAMPLE_RATE
const END_SILENCE_SAMPLES = 0.68 * SAMPLE_RATE
const KEEP_SILENCE_SAMPLES = 0.2 * SAMPLE_RATE

export const getAudioLevel = (samples: Float32Array) => {
  let squares = 0
  for (const sample of samples) {
    squares += sample * sample
  }
  return Math.sqrt(squares / samples.length)
}

/** 只在检测到持续人声后开始一轮，保留起音前的样本并裁去多余停顿。 */
export const createVoiceActivity = (onStart: () => void, onEnd: (wav: Blob) => void) => {
  let chunks: Float32Array[] = []
  let length = 0
  let loudSamples = 0
  let quietSamples = 0
  let listening = false
  let noise = 0.003

  const reset = () => {
    chunks = []
    length = 0
    loudSamples = 0
    quietSamples = 0
    listening = false
  }

  const push = (samples: Float32Array, playing: boolean) => {
    const level = getAudioLevel(samples)
    chunks.push(new Float32Array(samples))
    length += samples.length
    if (listening) {
      quietSamples = level > Math.max(0.006, noise * 2) ? 0 : quietSamples + samples.length
      if (quietSamples >= END_SILENCE_SAMPLES || length >= MAX_SECONDS * SAMPLE_RATE) {
        const wav = encodeWav(chunks, length - Math.max(0, quietSamples - KEEP_SILENCE_SAMPLES))
        reset()
        onEnd(wav)
      }
      return
    }

    const threshold = Math.max(playing ? 0.025 : 0.011, noise * (playing ? 5 : 3))
    if (level >= threshold) {
      loudSamples += samples.length
      if (loudSamples >= (playing ? INTERRUPT_START_SAMPLES : VOICE_START_SAMPLES)) {
        listening = true
        onStart()
      }
    } else {
      loudSamples = 0
      if (!playing) {
        noise += (level - noise) * 0.08
      }
    }
    while (length > PRE_ROLL_SAMPLES && !listening && chunks[0]) {
      length -= chunks[0].length
      chunks.shift()
    }
  }

  return { push, reset }
}
