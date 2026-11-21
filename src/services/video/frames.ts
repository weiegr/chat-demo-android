const MAX_SECONDS = 20
const FRAMES_PER_SHEET = 4
const FRAME_COUNT = 16
const LONG_SIDE = 1600
const MEDIA_TIMEOUT_MS = 8000
const FRAME_SETTLE_MS = 80

export class VideoTooLongError extends Error {}

/** 让暂停的视频显示开头画面，避免 WebView 显示默认海报。 */
export const seekVideoCover = (video: HTMLVideoElement) => {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    video.currentTime = Math.min(0.1, video.duration / 2)
  }
}

const waitForMedia = (
  video: HTMLVideoElement,
  signal: AbortSignal,
  event: 'loadedmetadata' | 'seeked',
  start: () => void
) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const finish = (error?: unknown) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      video.removeEventListener(event, onReady)
      video.removeEventListener('error', onError)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const onReady = () => finish()
    const onError = () => finish(new Error('Video could not be decoded'))
    const onAbort = () => finish(signal.reason)
    const timer = setTimeout(() => finish(new Error('Video decoding timed out')), MEDIA_TIMEOUT_MS)
    signal.addEventListener('abort', onAbort, { once: true })
    video.addEventListener(event, onReady, { once: true })
    video.addEventListener('error', onError, { once: true })
    try {
      start()
    } catch (error) {
      finish(error)
    }
  })

const encodeJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob?.type === 'image/jpeg') {
          resolve(blob)
        } else {
          reject(new Error('Could not encode JPEG'))
        }
      },
      'image/jpeg',
      0.86
    )
  })

// Android WebView 有时先派发 seeked，再让 canvas 读到解码后的画面。
const waitForFrame = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, FRAME_SETTLE_MS)
    signal.addEventListener('abort', onAbort, { once: true })
  })

export const extractVideoSheets = async (
  file: File,
  signal: AbortSignal,
  onProgress: (percent: number) => void
): Promise<File[]> => {
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  const url = URL.createObjectURL(file)
  const canvas = document.createElement('canvas')
  try {
    await waitForMedia(video, signal, 'loadedmetadata', () => {
      video.src = url
    })
    const { duration, videoWidth, videoHeight } = video
    if (!Number.isFinite(duration) || duration <= 0 || !videoWidth || !videoHeight) {
      throw new Error('Invalid video metadata')
    }
    if (duration > MAX_SECONDS) {
      throw new VideoTooLongError()
    }

    const scale = LONG_SIDE / (2 * Math.max(videoWidth, videoHeight))
    const width = Math.max(1, Math.round(videoWidth * scale))
    const height = Math.max(1, Math.round(videoHeight * scale))
    const cellWidth = Math.max(160, width)
    const cellHeight = Math.max(80, height)
    canvas.width = cellWidth * 2
    canvas.height = cellHeight * 2
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      throw new Error('Could not create frame canvas')
    }
    context.font = 'bold 26px sans-serif'
    context.textBaseline = 'middle'
    const sheets: File[] = []
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      // 取各区间的中点，避免定位到视频结束位置。
      const time = ((index + 0.5) * duration) / FRAME_COUNT
      await waitForMedia(video, signal, 'seeked', () => {
        video.currentTime = time
      })
      await waitForFrame(signal)
      signal.throwIfAborted()
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        throw new Error('Video frame is unavailable')
      }
      const cell = index % FRAMES_PER_SHEET
      const x = (cell % 2) * cellWidth
      const y = Math.floor(cell / 2) * cellHeight
      context.fillStyle = '#000'
      context.fillRect(x, y, cellWidth, cellHeight)
      context.drawImage(
        video,
        x + (cellWidth - width) / 2,
        y + (cellHeight - height) / 2,
        width,
        height
      )

      const timestamp = `${time.toFixed(2)} s`
      context.fillStyle = 'rgba(0, 0, 0, 0.8)'
      context.fillRect(x + 8, y + 8, Math.ceil(context.measureText(timestamp).width) + 20, 36)
      context.fillStyle = '#fff'
      context.fillText(timestamp, x + 18, y + 27)

      if (cell === FRAMES_PER_SHEET - 1) {
        const blob = await encodeJpeg(canvas)
        signal.throwIfAborted()
        sheets.push(new File([blob], `video-frames-${sheets.length + 1}.jpg`, { type: blob.type }))
      }
      onProgress(Math.round(((index + 1) / FRAME_COUNT) * 100))
    }
    return sheets
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
    canvas.width = 0
    canvas.height = 0
  }
}
