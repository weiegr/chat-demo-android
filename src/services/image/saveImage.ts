/**
 * 保存生成的像素画：Android 走系统下载目录，Web 走浏览器下载。
 * Android 侧复用导出桥的 saveExportFile，写完会回传真实路径。
 */

import { dataUrlToBase64, upscaleDataUrl } from './pixelRender.js'

interface AndroidSaveBridge {
  saveExportFile?: (
    requestId: number,
    base64: string,
    fileName: string,
    mimeType: string
  ) => void
}

interface AndroidSaveResult {
  requestId?: number
  ok?: boolean
  fileName?: string
  path?: string
  message?: string
}

const getAndroidBridge = (): AndroidSaveBridge | undefined =>
  (window as Window & { AndroidHost?: AndroidSaveBridge }).AndroidHost

/** 从 900001 起，避开会话导出的请求号，避免两个监听器互相串台 */
let nextRequestId = 900_001

const pad = (value: number) => String(value).padStart(2, '0')

/** 文件名带时间戳，连续保存不会互相覆盖 */
export const pixelFileName = (now = new Date()): string =>
  `abyss-pixel-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`

const saveOnAndroid = (
  bridge: AndroidSaveBridge & Required<Pick<AndroidSaveBridge, 'saveExportFile'>>,
  base64: string,
  fileName: string
): Promise<string> =>
  new Promise((resolve, reject) => {
    const requestId = nextRequestId
    nextRequestId += 1
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('android-export-result', onResult)
    }
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AndroidSaveResult | undefined>).detail
      if (!detail || detail.requestId !== requestId) {
        return
      }
      cleanup()
      if (detail.ok) {
        resolve(detail.path ?? detail.fileName ?? fileName)
      } else {
        reject(new Error(detail.message || 'save failed'))
      }
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('save timed out'))
    }, 20_000)
    window.addEventListener('android-export-result', onResult)
    try {
      bridge.saveExportFile(requestId, base64, fileName, 'image/png')
    } catch (error) {
      cleanup()
      reject(error instanceof Error ? error : new Error('save failed'))
    }
  })

const saveInBrowser = async (dataUrl: string, fileName: string): Promise<string> => {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  return fileName
}

/**
 * 保存一张 64×64 的像素画：放大到 512×512 后写入下载目录。
 * 返回落盘路径（Web 端返回文件名）。
 */
export const savePixelImage = async (dataUrl: string): Promise<string> => {
  const fileName = pixelFileName()
  const scaled = await upscaleDataUrl(dataUrl)
  const bridge = getAndroidBridge()
  if (bridge?.saveExportFile) {
    return saveOnAndroid(
      bridge as AndroidSaveBridge & Required<Pick<AndroidSaveBridge, 'saveExportFile'>>,
      dataUrlToBase64(scaled),
      fileName
    )
  }
  return saveInBrowser(scaled, fileName)
}
