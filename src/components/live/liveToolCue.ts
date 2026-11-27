import { synthesize, type TtsVoice } from '../../services/api/speech.js'
import type { LiveToolActivity } from '../../services/chat/store.js'
import type { Locale } from '../../services/settings.js'
import type { SpeechOutput } from '../../services/speech/pcmPlayback.js'

const MAX_CACHED_PCM_BYTES = 512 * 1024

const TOOL_CUES: Record<Locale, Record<LiveToolActivity, string>> = {
  'zh-CN': {
    memory: '稍等，我翻一下之前的记录。',
    search: '稍等，我帮你查一下。',
    read_link: '稍等，我帮你看一下这个链接。',
    location: '稍等，我获取一下你的位置。',
    balance: '稍等，我查一下你的账户余额。',
    guide: '稍等，我查一下功能说明。',
    image: '稍等，我画一下。',
  },
  'en-US': {
    memory: 'One moment, let me check our earlier chats.',
    search: 'One moment, let me look that up.',
    read_link: 'One moment, let me check that link.',
    location: 'One moment, let me check your location.',
    balance: 'One moment, let me check your account balance.',
    guide: 'One moment, let me check the app guide.',
    image: 'One moment, let me draw that.',
  },
}

const cuePcmCache = new Map<string, Uint8Array>()

const pcmToStream = (pcm: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(pcm)
      controller.close()
    },
  })

const capturePcmStream = (
  source: ReadableStream<Uint8Array>,
  onComplete: (pcm: Uint8Array) => void
): ReadableStream<Uint8Array> => {
  const reader = source.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let cacheable = true

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          reader.releaseLock()
          controller.close()
          if (cacheable && totalBytes > 0) {
            const merged = new Uint8Array(totalBytes)
            let offset = 0
            for (const chunk of chunks) {
              merged.set(chunk, offset)
              offset += chunk.length
            }
            onComplete(merged)
          }
          return
        }
        if (cacheable) {
          if (totalBytes + value.length <= MAX_CACHED_PCM_BYTES) {
            chunks.push(value.slice())
            totalBytes += value.length
          } else {
            cacheable = false
            chunks.length = 0
          }
        }
        controller.enqueue(value)
      } catch (error) {
        cacheable = false
        chunks.length = 0
        reader.releaseLock()
        throw error
      }
    },
    async cancel(reason) {
      cacheable = false
      chunks.length = 0
      try {
        await reader.cancel(reason)
      } finally {
        reader.releaseLock()
      }
    },
  })
}

export const playLiveToolCue = async (
  output: SpeechOutput,
  {
    apiKey,
    voice,
    locale,
    activity,
  }: {
    apiKey: string
    voice: TtsVoice
    locale: Locale
    activity: LiveToolActivity
  },
  signal: AbortSignal,
  onPlaying: () => void
) => {
  const cacheKey = `${voice}:${locale}:${activity}`
  const cached = cuePcmCache.get(cacheKey)
  if (cached) {
    await output.play(pcmToStream(cached), signal, onPlaying)
    return
  }
  const stream = await synthesize(apiKey, TOOL_CUES[locale][activity], voice, signal)
  const tee = capturePcmStream(stream, (pcm) => {
    cuePcmCache.set(cacheKey, pcm)
  })
  await output.play(tee, signal, onPlaying)
}
