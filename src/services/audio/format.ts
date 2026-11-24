export const MAX_AUDIO_MB = 32
export const MAX_AUDIO_SECONDS = 120

const MIME_BY_EXTENSION = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
} as const

const AUDIO_EXTENSIONS = Object.keys(MIME_BY_EXTENSION)
const AUDIO_TYPES = new Set<string>(Object.values(MIME_BY_EXTENSION))

export const AUDIO_ACCEPT = [...AUDIO_EXTENSIONS.map((ext) => `.${ext}`), ...AUDIO_TYPES].join(',')

export const canAttachAudio = (mode: string) => __BETA__ && mode === 'fast'

export const getAudioMimeType = (file: Pick<File, 'name' | 'type'>): string | undefined => {
  const ext = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase()
  if (ext && Object.hasOwn(MIME_BY_EXTENSION, ext)) {
    return MIME_BY_EXTENSION[ext as keyof typeof MIME_BY_EXTENSION]
  }
  return AUDIO_TYPES.has(file.type) ? file.type : undefined
}
