import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { create } from 'zustand'
import { createId } from '../utils/id.js'
import { isEphemeralStorage } from './chat/db.js'

const DB_NAME = 'chat-demo-backgrounds'
const DB_VERSION = 1
const STORE_NAME = 'customBackgrounds'
const SELECTED_KEY = 'chat-demo:chat-background-id'

const IMAGE_MAX_SIDE = 1600
const THUMB_MAX_SIDE = 360
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024

interface StoredChatBackground {
  id: string
  imageBlob: Blob
  thumbBlob: Blob
  createdAt: number
}

interface ChatBackgroundDB extends DBSchema {
  customBackgrounds: {
    key: string
    value: StoredChatBackground
  }
}

export interface ChatBackgroundItem {
  id: string
  imageUrl: string
  thumbUrl: string
  createdAt: number
}

interface ChatBackgroundState {
  ready: boolean
  /** 当前选中的自定义背景 ID；null 表示使用默认背景 */
  selectedId: string | null
  /** 按创建时间倒序排列的自定义背景列表 */
  customs: ChatBackgroundItem[]
}

const readStoredSelectedId = (): string | null => {
  try {
    const saved = localStorage.getItem(SELECTED_KEY)
    return saved && saved.trim() ? saved.trim() : null
  } catch {
    return null
  }
}

const persistSelectedId = (id: string | null) => {
  try {
    if (id === null) {
      localStorage.removeItem(SELECTED_KEY)
    } else {
      localStorage.setItem(SELECTED_KEY, id)
    }
  } catch {
    // 存储不可用时仅在内存中生效
  }
}

export const useChatBackground = create<ChatBackgroundState>(() => ({
  ready: false,
  selectedId: readStoredSelectedId(),
  customs: [],
}))

let dbPromise: Promise<IDBPDatabase<ChatBackgroundDB> | null> | null = null
let initPromise: Promise<void> | null = null

const openBackgroundDB = (): Promise<IDBPDatabase<ChatBackgroundDB> | null> => {
  if (isEphemeralStorage || typeof indexedDB === 'undefined') {
    return Promise.resolve(null)
  }
  return openDB<ChatBackgroundDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    },
    blocking() {
      void dbPromise?.then((db) => db?.close())
      dbPromise = null
    },
    terminated() {
      dbPromise = null
    },
  }).catch(() => null)
}

const getBackgroundDB = () => (dbPromise ??= openBackgroundDB())

const toItem = (record: StoredChatBackground): ChatBackgroundItem => ({
  id: record.id,
  imageUrl: URL.createObjectURL(record.imageBlob),
  thumbUrl: URL.createObjectURL(record.thumbBlob),
  createdAt: record.createdAt,
})

const revokeItemUrls = (item: ChatBackgroundItem) => {
  URL.revokeObjectURL(item.imageUrl)
  URL.revokeObjectURL(item.thumbUrl)
}

/** 初始化读取 IndexedDB 中已保存的自定义聊天背景，并校准当前选中 ID */
export const initChatBackgrounds = (): Promise<void> => {
  if (initPromise) {
    return initPromise
  }
  initPromise = (async () => {
    try {
      const db = await getBackgroundDB()
      if (!db) {
        const current = useChatBackground.getState()
        const valid =
          current.selectedId !== null &&
          current.customs.some((item) => item.id === current.selectedId)
        if (!valid && current.selectedId !== null) {
          persistSelectedId(null)
        }
        useChatBackground.setState({
          ready: true,
          selectedId: valid ? current.selectedId : null,
        })
        return
      }
      const records = await db.getAll(STORE_NAME)
      records.sort((a, b) => b.createdAt - a.createdAt)
      const existing = useChatBackground.getState().customs
      const existingById = new Map(existing.map((item) => [item.id, item]))
      const loaded = records.map((record) => existingById.get(record.id) ?? toItem(record))
      // 保留初始化前刚刚在内存中添加但尚未出现在快照中的条目
      const loadedIds = new Set(loaded.map((item) => item.id))
      const merged = [...existing.filter((item) => !loadedIds.has(item.id)), ...loaded].sort(
        (a, b) => b.createdAt - a.createdAt
      )
      const currentSelected = useChatBackground.getState().selectedId
      const validSelected =
        currentSelected !== null && merged.some((item) => item.id === currentSelected)
          ? currentSelected
          : null
      if (validSelected !== currentSelected) {
        persistSelectedId(validSelected)
      }
      useChatBackground.setState({
        ready: true,
        customs: merged,
        selectedId: validSelected,
      })
    } catch {
      useChatBackground.setState({ ready: true })
    }
  })()
  return initPromise
}

/** 选择聊天背景：传入 null 切回默认背景，传入自定义背景 ID 启用对应背景 */
export const selectChatBackground = (id: string | null) => {
  const { customs } = useChatBackground.getState()
  const resolved = id !== null && customs.some((item) => item.id === id) ? id : null
  persistSelectedId(resolved)
  useChatBackground.setState({ selectedId: resolved })
}

const loadImageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      URL.revokeObjectURL(url)
    }
    image.onload = () => {
      cleanup()
      resolve(image)
    }
    image.onerror = () => {
      cleanup()
      reject(new Error('Failed to decode image'))
    }
    image.src = url
  })

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Blob | null> =>
  new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => resolve(blob), mime, quality)
      return
    }
    try {
      const dataUrl = canvas.toDataURL(mime, quality)
      const parts = dataUrl.split(',')
      const header = parts[0] ?? ''
      const base64 = parts[1] ?? ''
      const match = /data:([^;]+);base64/.exec(header)
      const resolvedMime = match?.[1] ?? mime
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      resolve(new Blob([bytes], { type: resolvedMime }))
    } catch {
      resolve(null)
    }
  })

const encodeScaledBlob = async (
  image: HTMLImageElement,
  maxSide: number,
  quality: number
): Promise<Blob> => {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.width = 0
    canvas.height = 0
    throw new Error('Canvas context unavailable')
  }

  try {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, width, height, 0, 0, targetWidth, targetHeight)
    const webp = await canvasToBlob(canvas, 'image/webp', quality)
    if (webp && webp.type === 'image/webp') {
      return webp
    }
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', Math.min(0.9, quality + 0.03))
    if (jpeg) {
      return jpeg
    }
    throw new Error('Failed to encode image')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** 处理并保存一张新的自定义聊天背景，同时设为当前选中背景 */
export const addCustomChatBackground = async (file: File): Promise<ChatBackgroundItem> => {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error('Background image is too large')
  }
  await initChatBackgrounds()
  const image = await loadImageFromFile(file)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions')
  }

  const [imageBlob, thumbBlob] = await Promise.all([
    encodeScaledBlob(image, IMAGE_MAX_SIDE, 0.85),
    encodeScaledBlob(image, THUMB_MAX_SIDE, 0.8),
  ])

  const record: StoredChatBackground = {
    id: createId(),
    imageBlob,
    thumbBlob,
    createdAt: Date.now(),
  }

  const db = await getBackgroundDB()
  if (db) {
    await db.put(STORE_NAME, record)
  }

  const item = toItem(record)
  persistSelectedId(item.id)
  useChatBackground.setState((state) => ({
    ready: true,
    selectedId: item.id,
    customs: [item, ...state.customs],
  }))
  return item
}

/** 删除指定自定义聊天背景；若删除的是当前生效背景，则自动切回默认背景 */
export const removeCustomChatBackground = async (id: string): Promise<void> => {
  const db = await getBackgroundDB()
  if (db) {
    await db.delete(STORE_NAME, id)
  }
  const state = useChatBackground.getState()
  const target = state.customs.find((item) => item.id === id)
  const nextCustoms = state.customs.filter((item) => item.id !== id)
  const nextSelectedId = state.selectedId === id ? null : state.selectedId
  if (nextSelectedId !== state.selectedId) {
    persistSelectedId(nextSelectedId)
  }
  useChatBackground.setState({
    customs: nextCustoms,
    selectedId: nextSelectedId,
  })
  if (target) {
    revokeItemUrls(target)
  }
}

/** 返回当前生效的自定义聊天背景原图 URL；使用默认背景时返回 null */
export const useActiveChatBackgroundUrl = (): string | null =>
  useChatBackground((state) => {
    if (state.selectedId === null) {
      return null
    }
    return state.customs.find((item) => item.id === state.selectedId)?.imageUrl ?? null
  })
