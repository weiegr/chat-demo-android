import { createId } from '../../utils/id.js'
import { transcribe } from '../api/speech.js'

interface AndroidVideoAudioBridge {
  supportsVideoAudio?: () => boolean
  prepareVideoAudioPicker: (selectionId: string) => boolean
  releaseVideoAudioSelection: (selectionId: string) => void
  prepareVideoAudioRequest: (selectionId: string, requestId: string) => boolean
  cancelVideoAudioRequest: (requestId: string) => void
}

const getBridge = () =>
  (window as Window & { AndroidHost?: AndroidVideoAudioBridge }).AndroidHost

export const hasVideoAudioSupport = () => Boolean(getBridge()?.supportsVideoAudio?.())

/** 原生端在系统选择器返回后把这个标识和实际选中的视频关联。 */
export const prepareVideoAudioPicker = (): string | undefined => {
  if (!hasVideoAudioSupport()) {
    return
  }
  const selectionId = createId()
  return getBridge()?.prepareVideoAudioPicker(selectionId) ? selectionId : undefined
}

export const releaseVideoAudioSelection = (selectionId: string | undefined) => {
  if (selectionId) {
    getBridge()?.releaseVideoAudioSelection(selectionId)
  }
}

export type VideoAudioPhase = 'extracting' | 'transcribing'

export const transcribeVideoAudio = async (
  selectionId: string | undefined,
  apiKey: string,
  signal: AbortSignal,
  onPhase: (phase: VideoAudioPhase) => void
): Promise<string> => {
  signal.throwIfAborted()
  const bridge = getBridge()
  const requestId = createId()
  if (!selectionId || !bridge?.prepareVideoAudioRequest(selectionId, requestId)) {
    throw new Error('Video audio source is unavailable')
  }

  // 提取与转写共享一个取消信号，任一阶段超时都能结束发送预处理。
  const operation = new AbortController()
  const abort = () => {
    operation.abort(signal.reason)
    bridge.cancelVideoAudioRequest(requestId)
  }
  signal.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(abort, 45_000)
  try {
    onPhase('extracting')
    const response = await fetch(`/__android_video_audio__/${requestId}`, {
      cache: 'no-store',
      signal: operation.signal,
    })
    if (response.status === 204) {
      return ''
    }
    if (!response.ok || response.headers.get('Content-Type') !== 'audio/wav') {
      throw new Error('Could not decode the video audio track')
    }
    const wav = await response.blob()
    operation.signal.throwIfAborted()
    onPhase('transcribing')
    const transcript = await transcribe(apiKey, wav, operation.signal)
    operation.signal.throwIfAborted()
    return transcript.trim()
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    bridge.cancelVideoAudioRequest(requestId)
  }
}
