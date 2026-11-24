/** WAV 输入固定为 16 kHz、单声道、16-bit PCM。 */
export const SAMPLE_RATE = 16000
export const MAX_SECONDS = 120

export const startMicrophone = async (
  onSamples: (samples: Float32Array) => void,
  { bufferSize = 4096, signal }: { bufferSize?: number; signal?: AbortSignal } = {}
) => {
  signal?.throwIfAborted()
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: ScriptProcessorNode | undefined
  let analyser: AnalyserNode | undefined
  let released = false

  const release = () => {
    if (released) {
      return
    }
    released = true
    signal?.removeEventListener('abort', release)
    if (processor) {
      processor.onaudioprocess = null
    }
    for (const node of [processor, analyser, source]) {
      try {
        node?.disconnect()
      } catch {
        // 一个节点断开失败时仍继续释放其他资源。
      }
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
    void context?.close().catch(() => {})
  }

  try {
    signal?.throwIfAborted()
    signal?.addEventListener('abort', release, { once: true })
    context = new AudioContext({ sampleRate: SAMPLE_RATE })
    source = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(bufferSize, 1, 1)
    analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.2
    processor.onaudioprocess = (event) => onSamples(event.inputBuffer.getChannelData(0))
    source.connect(analyser)
    analyser.connect(processor)
    // 保持处理节点运行，输出缓冲始终静音。
    processor.connect(context.destination)
    if (context.state === 'suspended') {
      void context.resume().catch(() => {})
    }
    return { analyser, release }
  } catch (error) {
    release()
    throw error
  }
}

export type Recording = {
  stop: () => Promise<Blob | null>
  cancel: () => void
  analyser: AnalyserNode
}

/** 开始一次录音；到达时长上限后由调用方决定何时提交。 */
export const startRecording = async (onLimit: () => void): Promise<Recording> => {
  const chunks: Float32Array[] = []
  let length = 0
  const microphone = await startMicrophone((samples) => {
    if (length < MAX_SECONDS * SAMPLE_RATE) {
      chunks.push(new Float32Array(samples))
      length += samples.length
      if (length >= MAX_SECONDS * SAMPLE_RATE) {
        onLimit()
      }
    }
  })
  return {
    stop: async () => {
      microphone.release()
      return length === 0 ? null : encodeWav(chunks, length)
    },
    cancel: microphone.release,
    analyser: microphone.analyser,
  }
}

export const encodeWav = (chunks: Float32Array[], length: number, sampleRate = SAMPLE_RATE) => {
  const samples = Math.min(length, MAX_SECONDS * sampleRate)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, samples * 2, true)
  let offset = 44
  let written = 0
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length && written < samples; i++, written++) {
      const sample = Math.max(-1, Math.min(1, chunk[i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
