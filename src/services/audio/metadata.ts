export type AudioSegment = { startMs: number; endMs: number; text: string }

export type AudioAnalysis = {
  durationMs: number
  rmsDbfs: number
  peakDbfs: number
  activeMs: number
  clippedPercent: number
  /** 两种书写系统分开计量，分母为有对白的分段中的活跃时长。 */
  charactersPerMinute: number
  wordsPerMinute: number
  segments: AudioSegment[]
}

export type AudioAttachmentData = {
  spectrogramId: string
  analysis: AudioAnalysis
}

export const getAudioSpectrogramIds = (files: ReadonlyArray<{ audio?: AudioAttachmentData }>) =>
  new Set(files.flatMap((file) => (file.audio ? [file.audio.spectrogramId] : [])))

export const formatAudioTime = (ms: number) => {
  const tenths = Math.round(ms / 100)
  const minutes = Math.floor(tenths / 600)
  const seconds = String(Math.floor(tenths / 10) % 60).padStart(2, '0')
  return `${minutes}:${seconds}.${tenths % 10}`
}

export const audioContextText = (name: string, audio: AudioAnalysis, hasSpectrogram: boolean) => {
  const { durationMs, rmsDbfs, peakDbfs, activeMs, clippedPercent, segments } = audio
  const activity = Math.round((100 * activeMs) / durationMs)
  const rate = [
    audio.charactersPerMinute && `约 ${audio.charactersPerMinute} 汉字/假名每分钟`,
    audio.wordsPerMinute && `约 ${audio.wordsPerMinute} 词每分钟`,
  ]
    .filter(Boolean)
    .join('、')
  return [
    `【音频：${name}】`,
    `时长 ${formatAudioTime(durationMs)}，整体 RMS ${rmsDbfs} dBFS，样本峰值 ${peakDbfs} dBFS，能量活跃占比 ${activity}%，接近满幅的样本占比 ${clippedPercent}%。`,
    rate && `对白语速（按识别片段中的能量活跃时长估算）：${rate}。`,
    segments.length ? '【音频对白】时间为本地送识片段的起止范围。' : '【音频对白】未识别到对白。',
    ...segments.map(
      ({ startMs, endMs, text }) =>
        `[${formatAudioTime(startMs)}–${formatAudioTime(endMs)}] ${text}`
    ),
    hasSpectrogram &&
      '【音频频谱】紧随此段的图为单声道对数频率声谱图。横轴是时间，纵轴是频率，颜色表示相对满幅的频谱幅度；结合对白和指标描述有依据的声音特征。',
  ]
    .filter(Boolean)
    .join('\n')
}
