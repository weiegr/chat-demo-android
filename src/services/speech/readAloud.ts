import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { ApiError } from '../api/client.js'
import { classifyApiError } from '../api/errors.js'
import { synthesize } from '../api/speech.js'
import { useSettings } from '../settings.js'
import { createSpeechOutput, type SpeechOutput } from './pcmPlayback.js'

/**
 * 朗读：同一时间只读一条回复。
 * 请求 TTS 的裸 PCM 流，边收边用 AudioContext 按顺序排程播放，首帧到达即出声。
 * 状态：loading（已请求、未出声）→ playing → 结束回到 idle。
 */
export type ReadAloudStatus = 'idle' | 'loading' | 'playing'

type ReadAloudState = {
  /** 正在朗读的回复 id */
  messageId: string | null
  status: ReadAloudStatus
}

export const useReadAloud = create<ReadAloudState>(() => ({ messageId: null, status: 'idle' }))

let current: { controller: AbortController; output: SpeechOutput } | null = null

const finish = (controller: AbortController) => {
  if (current?.controller !== controller) {
    return
  }
  current.output.close()
  current = null
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

/** 停止当前朗读（发送、停止生成、切换会话等场景调用） */
export const stopReadAloud = () => {
  if (current) {
    const { controller } = current
    controller.abort()
    finish(controller)
  }
}

export const describeReadAloudError = (error: unknown): TranslationMessage | string => {
  if (error instanceof ApiError && error.kind === 'protocol') {
    return error.message
  }
  // 400 表示这段正文服务端无法合成，与其余失败区分开
  if (error instanceof ApiError && error.status === 400) {
    return { key: 'ttsUnavailable' }
  }
  switch (classifyApiError(error)) {
    case 'unauthorized':
      return { key: 'apiKeyInvalidRetry' }
    case 'insufficientBalance':
      return { key: 'insufficientBalance' }
    case 'rateLimited':
      return { key: 'rateLimited' }
    default:
      return { key: 'ttsFailed' }
  }
}

/**
 * 启动朗读一条回复的正文；由手动按钮与自动朗读共用。
 * 浏览器内需用户手势才能出声，APK 的 WebView 已设置免手势自动播放。
 */
export const startReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void
) => {
  stopReadAloud()
  const controller = new AbortController()
  let output: SpeechOutput
  try {
    output = createSpeechOutput()
  } catch (error) {
    onError(error)
    return
  }
  current = { controller, output }
  useReadAloud.setState({ messageId, status: 'loading' })
  const { apiKey, ttsVoice } = useSettings.getState()

  void (async () => {
    try {
      const stream = await synthesize(apiKey ?? '', text, ttsVoice, controller.signal)
      await output.play(stream, controller.signal, () => {
        useReadAloud.setState({ status: 'playing' })
      })
    } catch (error) {
      if (!controller.signal.aborted) {
        onError(error)
      }
    } finally {
      finish(controller)
    }
  })()
}

/** 自动朗读：开关开启、无进行中的朗读且正文非空时启动；失败静默交给 onError 调用方 */
export const autoStartReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void
) => {
  if (!useSettings.getState().autoReadAloud || !text.trim()) {
    return
  }
  if (useReadAloud.getState().status !== 'idle') {
    // 不打断正在播放或加载中的手动朗读
    return
  }
  startReadAloud(messageId, text, onError)
}

/**
 * 开始朗读一条回复的正文；同一条正在朗读时调用等于停止。
 * 必须在点击事件中同步调用：浏览器内 AudioContext 需要用户手势才能出声。
 */
export const toggleReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void
) => {
  if (useReadAloud.getState().messageId === messageId) {
    stopReadAloud()
    return
  }
  startReadAloud(messageId, text, onError)
}
