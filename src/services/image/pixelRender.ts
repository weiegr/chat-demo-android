/**
 * 把像素缓冲区编码成 PNG。
 * 画布只有 64×64，直接 putImageData 后导出即可，不需要任何图形库。
 */

import type { PixelBuffer } from './pixelPaint.js'

/** 保存到设备时放大到 512×512，最近邻缩放保持像素边缘锐利 */
export const SAVE_SCALE = 8

export const toPngDataUrl = (buffer: PixelBuffer): string => {
  const canvas = document.createElement('canvas')
  canvas.width = buffer.width
  canvas.height = buffer.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('canvas is not available')
  }
  const image = context.createImageData(buffer.width, buffer.height)
  image.data.set(buffer.data)
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('failed to decode image'))
    image.src = src
  })

/** 最近邻放大：像素画放大后仍然是一块块方像素，不会糊成渐变 */
export const upscaleDataUrl = async (dataUrl: string, scale = SAVE_SCALE): Promise<string> => {
  if (scale <= 1) {
    return dataUrl
  }
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth * scale
  canvas.height = image.naturalHeight * scale
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('canvas is not available')
  }
  context.imageSmoothingEnabled = false
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

/** data URL 去掉前缀，得到 Android 桥需要的裸 base64 */
export const dataUrlToBase64 = (dataUrl: string): string => {
  const index = dataUrl.indexOf(',')
  return index >= 0 ? dataUrl.slice(index + 1) : dataUrl
}
