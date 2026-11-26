import { getAbortReason } from '../../utils/abort.js'
import { transcribe } from '../api/speech.js'
import { encodeWav } from '../speech/recorder.js'
import { MAX_AUDIO_SECONDS } from './format.js'
import type { AudioAnalysis, AudioSegment } from './metadata.js'
import { drawSpectrogram } from './spectrogram.js'

const SAMPLE_RATE = 24_000
const FRAME_MS = 20
const FRAME_SIZE = (SAMPLE_RATE * FRAME_MS) / 1000
const MAX_FRAMES_PER_SEGMENT = 16_000 / FRAME_MS
const TARGET_FRAMES_PER_SEGMENT = 12_000 / FRAME_MS
const MIN_FRAMES_PER_SEGMENT = 8_000 / FRAME_MS
const MAX_TRANSCRIPT_LENGTH = 2_000
const CHARACTERS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu

export type AudioInputErrorCode = 'audioTooLong' | 'audioDecodeFailed' | 'audioTranscriptionFailed'

export class AudioInputError extends Error {
  constructor(readonly code: AudioInputErrorCode) {
    super(code)
    this.name = 'AudioInputError'
  }
}

export type PreparedAudio = { analysis: AudioAnalysis; spectrogram: Blob }
export type AudioProgress =
  | { phase: 'analyzing' }
  | { phase: 'transcribing'; completed: number; total: number }

const probeDuration = (blob: Blob, signal: AbortSignal) =>
  new Promise<number>((resolve, reject) => {
    const media = document.createElement('audio')
    const url = URL.createObjectURL(blob)
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      media.onloadedmetadata = null
      media.onerror = null
      media.removeAttribute('src')
      media.load()
      URL.revokeObjectURL(url)
    }
    const complete = (duration: number) => {
      cleanup()
      resolve(duration)
    }
    const abort = () => {
      cleanup()
      reject(getAbortReason(signal))
    }
    const timer = setTimeout(() => complete(NaN), 2_000)
    signal.addEventListener('abort', abort, { once: true })
    media.preload = 'metadata'
    media.onloadedmetadata = () => complete(media.duration)
    media.onerror = () => complete(NaN)
    media.src = url
  })

const toMono = (audio: AudioBuffer) => {
  const first = audio.getChannelData(0)
  if (audio.numberOfChannels === 1) {
    return first
  }
  const mono = new Float32Array(audio.length)
  let loudest = first
  let loudestEnergy = 0
  for (let index = 0; index < audio.numberOfChannels; index++) {
    const channel = audio.getChannelData(index)
    let energy = 0
    for (let sample = 0; sample < channel.length; sample++) {
      const value = channel[sample]
      mono[sample] += value / audio.numberOfChannels
      energy += value * value
    }
    if (energy > loudestEnergy) {
      loudest = channel
      loudestEnergy = energy
    }
  }
  let monoEnergy = 0
  for (const sample of mono) {
    monoEnergy += sample * sample
  }
  // 反相声道混合可能抵消对白；混合能量严重下降时改用能量最高的一路。
  return monoEnergy < loudestEnergy * 0.1 ? loudest : mono
}

const decodeAudio = async (blob: Blob, signal: AbortSignal) => {
  signal.throwIfAborted()
  const duration = await probeDuration(blob, signal)
  if (Number.isFinite(duration) && duration > MAX_AUDIO_SECONDS + 0.1) {
    throw new AudioInputError('audioTooLong')
  }
  const bytes = await blob.arrayBuffer()
  signal.throwIfAborted()
  let decoded: AudioBuffer
  try {
    const OfflineContext =
      window.OfflineAudioContext ??
      (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext
    if (!OfflineContext) {
      throw new Error('OfflineAudioContext unavailable')
    }
    const context = new OfflineContext(1, 1, SAMPLE_RATE)
    decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const pending = context.decodeAudioData(bytes, resolve, reject)
      if (pending && typeof pending.then === 'function') {
        pending.then(resolve, reject)
      }
    })
  } catch {
    signal.throwIfAborted()
    throw new AudioInputError('audioDecodeFailed')
  }
  signal.throwIfAborted()
  if (decoded.duration > MAX_AUDIO_SECONDS) {
    throw new AudioInputError('audioTooLong')
  }
  if (decoded.length === 0) {
    throw new AudioInputError('audioDecodeFailed')
  }
  return toMono(decoded)
}

const toDbfs = (amplitude: number) =>
  Math.round(10 * Math.max(-96, Math.min(0, 20 * Math.log10(amplitude)))) / 10

const measure = (samples: Float32Array) => {
  const rms = new Float32Array(Math.ceil(samples.length / FRAME_SIZE))
  let squares = 0
  let peak = 0
  let clipped = 0
  for (let frame = 0; frame < rms.length; frame++) {
    const start = frame * FRAME_SIZE
    const end = Math.min(samples.length, start + FRAME_SIZE)
    let energy = 0
    for (let index = start; index < end; index++) {
      const magnitude = Math.abs(samples[index])
      energy += magnitude * magnitude
      peak = Math.max(peak, magnitude)
      if (magnitude >= 0.999) {
        clipped++
      }
    }
    rms[frame] = Math.sqrt(energy / (end - start))
    squares += energy
  }
  const sorted = rms.slice().sort()
  const noise = sorted[Math.floor(sorted.length * 0.2)]
  const threshold = Math.max(0.001, Math.min(noise * 3, sorted[sorted.length - 1] * 0.18))
  // 前缀和便于按实际样本数统计任意分段的能量活跃时长。
  const active = new Uint32Array(rms.length + 1)
  for (let frame = 0; frame < rms.length; frame++) {
    const length = Math.min(FRAME_SIZE, samples.length - frame * FRAME_SIZE)
    active[frame + 1] = active[frame] + (rms[frame] >= threshold ? length : 0)
  }
  return {
    rms,
    active,
    rmsDbfs: toDbfs(Math.sqrt(squares / samples.length)),
    peakDbfs: toDbfs(peak),
    clippedPercent: Math.round((clipped * 10_000) / samples.length) / 100,
  }
}

const toMs = (sample: number) => Math.round((sample * 1000) / SAMPLE_RATE)

const segmentAudio = (samples: Float32Array, rms: Float32Array, active: Uint32Array) => {
  const segments: { start: number; end: number; activeMs: number }[] = []
  const window = 5
  for (let start = 0; start < rms.length; ) {
    let end = rms.length
    if (end - start > MAX_FRAMES_PER_SEGMENT) {
      const target = start + TARGET_FRAMES_PER_SEGMENT
      const limit = Math.min(
        start + MAX_FRAMES_PER_SEGMENT,
        rms.length - MIN_FRAMES_PER_SEGMENT / 2
      )
      let bestScore = Infinity
      for (let cut = start + MIN_FRAMES_PER_SEGMENT; cut <= limit; cut++) {
        let energy = 0
        for (let index = cut - window; index < cut + window; index++) {
          energy += rms[index] ** 2
        }
        const score = Math.log(1e-9 + energy) + Math.abs(cut - target) / TARGET_FRAMES_PER_SEGMENT
        if (score < bestScore) {
          bestScore = score
          end = cut
        }
      }
    }
    // 只跳过近乎全静音的分段；能量门限本身不用于判定有没有人说话。
    if (rms.subarray(start, end).some((level) => level >= 0.0001)) {
      segments.push({
        start: start * FRAME_SIZE,
        end: Math.min(end * FRAME_SIZE, samples.length),
        activeMs: toMs(active[end] - active[start]),
      })
    }
    start = end
  }
  return segments
}

const countSpeechUnits = (text: string) => {
  const characters = text.match(CHARACTERS)?.length ?? 0
  const rest = text.replace(CHARACTERS, ' ')
  const words =
    typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(rest)).filter(
          (token) => token.isWordLike
        ).length
      : (rest.match(/[\p{L}\p{N}]+/gu)?.length ?? 0)
  return { characters, words }
}

const transcribeSegment = async (pcm: Float32Array, apiKey: string, signal: AbortSignal) => {
  const request = new AbortController()
  const cancel = () => request.abort(getAbortReason(signal))
  signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => request.abort(), 75_000)
  try {
    return (await transcribe(apiKey, encodeWav([pcm], pcm.length, SAMPLE_RATE), request.signal))
      .trim()
      .slice(0, MAX_TRANSCRIPT_LENGTH)
  } catch {
    signal.throwIfAborted()
    throw new AudioInputError('audioTranscriptionFailed')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
  }
}

export const analyzeAudio = async (
  blob: Blob,
  apiKey: string,
  signal: AbortSignal,
  onProgress: (progress: AudioProgress) => void,
  transcripts: Map<number, string>
): Promise<PreparedAudio> => {
  onProgress({ phase: 'analyzing' })
  const samples = await decodeAudio(blob, signal)
  const features = measure(samples)
  const spectrogram = await drawSpectrogram(samples, SAMPLE_RATE, signal)
  const windows = segmentAudio(samples, features.rms, features.active)
  const segments: AudioSegment[] = []
  let characters = 0
  let words = 0
  let speechMs = 0
  for (const [index, window] of windows.entries()) {
    signal.throwIfAborted()
    onProgress({ phase: 'transcribing', completed: index, total: windows.length })
    const text =
      transcripts.get(window.start) ??
      (await transcribeSegment(samples.subarray(window.start, window.end), apiKey, signal))
    signal.throwIfAborted()
    transcripts.set(window.start, text)
    if (!text) {
      continue
    }
    const startMs = toMs(window.start)
    const endMs = Math.max(startMs + 1, toMs(window.end))
    const units = countSpeechUnits(text)
    characters += units.characters
    words += units.words
    speechMs += Math.max(window.activeMs, Math.min(500, endMs - startMs))
    segments.push({ startMs, endMs, text })
  }
  return {
    spectrogram,
    analysis: {
      durationMs: Math.max(1, toMs(samples.length)),
      rmsDbfs: features.rmsDbfs,
      peakDbfs: features.peakDbfs,
      activeMs: toMs(features.active.at(-1) ?? 0),
      clippedPercent: features.clippedPercent,
      charactersPerMinute: speechMs ? Math.round((characters * 60_000) / speechMs) : 0,
      wordsPerMinute: speechMs ? Math.round((words * 60_000) / speechMs) : 0,
      segments,
    },
  }
}
