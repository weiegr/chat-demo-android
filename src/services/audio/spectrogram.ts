const FFT_SIZE = 1024
const BINS = FFT_SIZE / 2
const MIN_DB = -90
const PLOT = { x: 76, y: 29, width: 936, height: 344 }
const FREQUENCY_SCALE = 250
const COLORS = [
  [12, 10, 32],
  [63, 34, 121],
  [42, 94, 156],
  [29, 158, 142],
  [113, 203, 97],
  [251, 233, 114],
]

const palette = Array.from({ length: 256 }, (_, index) => {
  const position = (index / 255) * (COLORS.length - 1)
  const left = Math.min(COLORS.length - 2, Math.floor(position))
  const fraction = position - left
  return COLORS[left].map((value, channel) =>
    Math.round(value + (COLORS[left + 1][channel] - value) * fraction)
  )
})

const createSpectrum = (samples: Float32Array) => {
  const real = new Float32Array(FFT_SIZE)
  const imag = new Float32Array(FFT_SIZE)
  const cos = Float32Array.from({ length: BINS }, (_, i) => Math.cos((-2 * Math.PI * i) / FFT_SIZE))
  const sin = Float32Array.from({ length: BINS }, (_, i) => Math.sin((-2 * Math.PI * i) / FFT_SIZE))
  const hann = Float32Array.from(
    { length: FFT_SIZE },
    (_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / FFT_SIZE))
  )
  const reverse = new Uint16Array(FFT_SIZE)
  for (let i = 1; i < FFT_SIZE; i++) {
    reverse[i] = (reverse[i >> 1] >> 1) | ((i & 1) * BINS)
  }

  return (center: number, peakPower: Float32Array) => {
    const offset = center - BINS
    for (let i = 0; i < FFT_SIZE; i++) {
      real[reverse[i]] = (samples[offset + i] ?? 0) * hann[i]
    }
    imag.fill(0)
    for (let span = 2; span <= FFT_SIZE; span *= 2) {
      const half = span / 2
      const step = FFT_SIZE / span
      for (let start = 0; start < FFT_SIZE; start += span) {
        for (let bin = 0; bin < half; bin++) {
          const left = start + bin
          const right = left + half
          const angle = bin * step
          const r = cos[angle] * real[right] - sin[angle] * imag[right]
          const i = sin[angle] * real[right] + cos[angle] * imag[right]
          real[right] = real[left] - r
          imag[right] = imag[left] - i
          real[left] += r
          imag[left] += i
        }
      }
    }
    for (let bin = 0; bin <= BINS; bin++) {
      const power = (real[bin] ** 2 + imag[bin] ** 2) * (bin === 0 || bin === BINS ? 0.25 : 1)
      peakPower[bin] = Math.max(peakPower[bin], power)
    }
  }
}

/** 时域 Hann 窗的短时傅里叶变换；每列汇集时间范围内的峰值以保留瞬态。 */
export const drawSpectrogram = async (
  samples: Float32Array,
  rate: number,
  signal: AbortSignal
): Promise<Blob> => {
  const canvas = document.createElement('canvas')
  canvas.width = 1072
  canvas.height = 432
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is unavailable')
  }
  const { x, y, width, height } = PLOT
  const pixels = context.createImageData(width, height)
  const peakPower = new Float32Array(BINS + 1)
  const spectrum = createSpectrum(samples)
  const nyquist = rate / 2
  const logRange = Math.log1p(nyquist / FREQUENCY_SCALE)
  const toFrequency = (ratio: number) => FREQUENCY_SCALE * Math.expm1(ratio * logRange)
  const bins = Uint16Array.from({ length: height + 1 }, (_, row) =>
    Math.min(BINS, Math.round((toFrequency(1 - row / height) * FFT_SIZE) / rate))
  )
  const samplesPerColumn = samples.length / width
  const windowsPerColumn = Math.ceil(samplesPerColumn / BINS)
  let timeSlice = performance.now()
  for (let col = 0; col < width; col++) {
    peakPower.fill(0)
    for (let index = 0; index < windowsPerColumn; index++) {
      const position = col + (index + 0.5) / windowsPerColumn
      spectrum(Math.floor(position * samplesPerColumn), peakPower)
    }
    for (let row = 0; row < height; row++) {
      let power = 0
      for (let bin = bins[row + 1]; bin <= bins[row]; bin++) {
        power = Math.max(peakPower[bin], power)
      }
      // Hann 的相干增益为 0.5；单边谱再乘 2，使满幅正弦的峰为 0 dBFS。
      const db = Math.max(MIN_DB, Math.min(0, 10 * Math.log10(power * (4 / FFT_SIZE) ** 2)))
      const [red, green, blue] = palette[Math.round(255 * (1 - db / MIN_DB))]
      const offset = (row * width + col) * 4
      pixels.data[offset] = red
      pixels.data[offset + 1] = green
      pixels.data[offset + 2] = blue
      pixels.data[offset + 3] = 255
    }
    if (performance.now() - timeSlice >= 10) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      signal.throwIfAborted()
      timeSlice = performance.now()
    }
  }

  context.fillStyle = '#101425'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.putImageData(pixels, x, y)
  context.font = '14px sans-serif'
  context.fillStyle = '#e7ecfa'
  context.fillText('Frequency (Hz)', 8, 19)
  context.textAlign = 'right'
  context.textBaseline = 'middle'
  for (const hz of [0, 250, 500, 1000, 2000, 4000, 8000, nyquist]) {
    const top = y + height * (1 - Math.log1p(hz / FREQUENCY_SCALE) / logRange)
    context.fillText(hz < 1000 ? String(hz) : `${hz / 1000}k`, x - 9, top)
    context.fillRect(x - 5, top, 5, 1)
  }
  context.textAlign = 'center'
  const seconds = samples.length / rate
  const step = seconds >= 30 ? 10 : seconds >= 10 ? 5 : seconds >= 3 ? 1 : seconds >= 1 ? 0.5 : 0.2
  const ticks = [0]
  for (let time = step; time < seconds - step * 0.5; time += step) {
    ticks.push(time)
  }
  ticks.push(seconds)
  for (const time of ticks) {
    const left = x + (time / seconds) * width
    const label = String(Number(time.toFixed(seconds < 1 ? 3 : 1)))
    context.fillRect(left, y + height, 1, 5)
    context.fillText(label, left, y + height + 16)
  }
  context.fillText('Time (s)', x + width / 2, canvas.height - 15)
  for (let row = 0; row < height; row++) {
    const color = palette[255 - Math.floor((row * 255) / (height - 1))]
    context.fillStyle = `rgb(${color.join(',')})`
    context.fillRect(x + width + 9, y + row, 12, 1)
  }
  context.fillStyle = '#e7ecfa'
  context.textAlign = 'left'
  context.fillText('dBFS', x + width + 8, 15)
  context.fillText('0', x + width + 25, y + 6)
  context.fillText(String(MIN_DB), x + width + 25, y + height - 6)

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => {
      if (result) {
        resolve(result)
      } else {
        reject(new Error('Could not encode the spectrogram'))
      }
    }, 'image/png')
  )
  signal.throwIfAborted()
  return blob
}
