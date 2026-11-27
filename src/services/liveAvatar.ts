import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { create } from 'zustand'
import { createId } from '../utils/id.js'
import { isEphemeralStorage } from './chat/db.js'

export type LiveAvatarState = 'idle' | 'listening' | 'speaking' | 'thinking'

export const LIVE_AVATAR_STATES: readonly LiveAvatarState[] = [
  'idle',
  'listening',
  'speaking',
  'thinking',
]

const DB_NAME = 'chat-demo-live-avatars'
const DB_VERSION = 1
const STORE_NAME = 'customAvatarSets'
const SELECTED_KEY = 'chat-demo:live-avatar-id'

const IMAGE_MAX_SIDE = 960
const THUMB_MAX_SIDE = 240
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024
export const MAX_LIVE_AVATAR_NAME_LENGTH = 24

interface StoredLiveAvatarSet {
  id: string
  name?: string
  images: Record<LiveAvatarState, Blob>
  thumbs: Record<LiveAvatarState, Blob>
  createdAt: number
}

interface LiveAvatarDB extends DBSchema {
  customAvatarSets: {
    key: string
    value: StoredLiveAvatarSet
  }
}

export interface LiveAvatarSet {
  id: string
  name?: string
  images: Record<LiveAvatarState, string>
  thumbs: Record<LiveAvatarState, string>
  createdAt: number
}

interface LiveAvatarStoreState {
  ready: boolean
  /** 当前选中的自定义形象组 ID；null 表示使用默认形象 */
  selectedId: string | null
  /** 按创建时间升序排列的自定义形象组，确保「自定义 1 组 / 2 组…」编号稳定 */
  customs: LiveAvatarSet[]
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

export const useLiveAvatar = create<LiveAvatarStoreState>(() => ({
  ready: false,
  selectedId: readStoredSelectedId(),
  customs: [],
}))

let dbPromise: Promise<IDBPDatabase<LiveAvatarDB> | null> | null = null
let initPromise: Promise<void> | null = null
const storedRecordsCache = new Map<string, StoredLiveAvatarSet>()

const openAvatarDB = (): Promise<IDBPDatabase<LiveAvatarDB> | null> => {
  if (isEphemeralStorage || typeof indexedDB === 'undefined') {
    return Promise.resolve(null)
  }
  return openDB<LiveAvatarDB>(DB_NAME, DB_VERSION, {
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

const getAvatarDB = () => (dbPromise ??= openAvatarDB())

const normalizeGroupName = (name?: string): string | undefined => {
  const trimmed = name?.trim()
  if (!trimmed) {
    return undefined
  }
  return trimmed.slice(0, MAX_LIVE_AVATAR_NAME_LENGTH)
}

const toSet = (record: StoredLiveAvatarSet): LiveAvatarSet => ({
  id: record.id,
  name: normalizeGroupName(record.name),
  images: {
    idle: URL.createObjectURL(record.images.idle),
    listening: URL.createObjectURL(record.images.listening),
    speaking: URL.createObjectURL(record.images.speaking),
    thinking: URL.createObjectURL(record.images.thinking),
  },
  thumbs: {
    idle: URL.createObjectURL(record.thumbs.idle),
    listening: URL.createObjectURL(record.thumbs.listening),
    speaking: URL.createObjectURL(record.thumbs.speaking),
    thinking: URL.createObjectURL(record.thumbs.thinking),
  },
  createdAt: record.createdAt,
})

const revokeSetUrls = (item: LiveAvatarSet) => {
  for (const state of LIVE_AVATAR_STATES) {
    URL.revokeObjectURL(item.images[state])
    URL.revokeObjectURL(item.thumbs[state])
  }
}

const isValidStoredRecord = (
  record: StoredLiveAvatarSet | undefined
): record is StoredLiveAvatarSet => {
  if (!record || !record.id || !record.images || !record.thumbs) {
    return false
  }
  return LIVE_AVATAR_STATES.every(
    (state) => record.images[state] instanceof Blob && record.thumbs[state] instanceof Blob
  )
}

/** 初始化读取 IndexedDB 中已保存的自定义 Live 形象组，并校准当前选中 ID */
export const initLiveAvatars = (): Promise<void> => {
  if (initPromise) {
    return initPromise
  }
  initPromise = (async () => {
    try {
      const db = await getAvatarDB()
      if (!db) {
        const current = useLiveAvatar.getState()
        const valid =
          current.selectedId !== null &&
          current.customs.some((item) => item.id === current.selectedId)
        if (!valid && current.selectedId !== null) {
          persistSelectedId(null)
        }
        useLiveAvatar.setState({
          ready: true,
          selectedId: valid ? current.selectedId : null,
        })
        return
      }
      const records = (await db.getAll(STORE_NAME)).filter(isValidStoredRecord)
      records.sort((a, b) => a.createdAt - b.createdAt)
      const existing = useLiveAvatar.getState().customs
      const existingById = new Map(existing.map((item) => [item.id, item]))
      const loaded = records.map((record) => {
        storedRecordsCache.set(record.id, record)
        return existingById.get(record.id) ?? toSet(record)
      })
      const loadedIds = new Set(loaded.map((item) => item.id))
      const merged = [...loaded, ...existing.filter((item) => !loadedIds.has(item.id))].sort(
        (a, b) => a.createdAt - b.createdAt
      )
      const currentSelected = useLiveAvatar.getState().selectedId
      const validSelected =
        currentSelected !== null && merged.some((item) => item.id === currentSelected)
          ? currentSelected
          : null
      if (validSelected !== currentSelected) {
        persistSelectedId(validSelected)
      }
      useLiveAvatar.setState({
        ready: true,
        customs: merged,
        selectedId: validSelected,
      })
    } catch {
      useLiveAvatar.setState({ ready: true })
    }
  })()
  return initPromise
}

/** 选择 Live 形象：传入 null 切回默认形象，传入自定义组 ID 启用对应形象组 */
export const selectLiveAvatar = (id: string | null) => {
  const { customs } = useLiveAvatar.getState()
  const resolved = id !== null && customs.some((item) => item.id === id) ? id : null
  persistSelectedId(resolved)
  useLiveAvatar.setState({ selectedId: resolved })
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

const shouldPreserveAlpha = (file: File) =>
  file.type === 'image/png' ||
  file.type === 'image/webp' ||
  file.type === 'image/gif' ||
  file.type === 'image/svg+xml'

const encodeScaledBlob = async (
  image: HTMLImageElement,
  maxSide: number,
  quality: number,
  preserveAlpha: boolean
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
    if (preserveAlpha) {
      const png = await canvasToBlob(canvas, 'image/png', 1)
      if (png) {
        return png
      }
    }
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', Math.min(0.92, quality + 0.04))
    if (jpeg) {
      return jpeg
    }
    throw new Error('Failed to encode image')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

const encodeAvatarFile = async (file: File): Promise<{ imageBlob: Blob; thumbBlob: Blob }> => {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error('Avatar image is too large')
  }
  const image = await loadImageFromFile(file)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions')
  }
  const preserveAlpha = shouldPreserveAlpha(file)
  const [imageBlob, thumbBlob] = await Promise.all([
    encodeScaledBlob(image, IMAGE_MAX_SIDE, 0.88, preserveAlpha),
    encodeScaledBlob(image, THUMB_MAX_SIDE, 0.82, preserveAlpha),
  ])
  return { imageBlob, thumbBlob }
}

/** 处理并保存一组新的自定义 Live 形象（4 张状态图），同时设为当前选中形象 */
export const addCustomLiveAvatarSet = async (
  files: Record<LiveAvatarState, File>,
  name?: string
): Promise<LiveAvatarSet> => {
  await initLiveAvatars()
  const [idle, listening, speaking, thinking] = await Promise.all([
    encodeAvatarFile(files.idle),
    encodeAvatarFile(files.listening),
    encodeAvatarFile(files.speaking),
    encodeAvatarFile(files.thinking),
  ])

  const normalizedName = normalizeGroupName(name)
  const record: StoredLiveAvatarSet = {
    id: createId(),
    ...(normalizedName ? { name: normalizedName } : {}),
    images: {
      idle: idle.imageBlob,
      listening: listening.imageBlob,
      speaking: speaking.imageBlob,
      thinking: thinking.imageBlob,
    },
    thumbs: {
      idle: idle.thumbBlob,
      listening: listening.thumbBlob,
      speaking: speaking.thumbBlob,
      thinking: thinking.thumbBlob,
    },
    createdAt: Date.now(),
  }

  const db = await getAvatarDB()
  if (db) {
    await db.put(STORE_NAME, record)
  }
  storedRecordsCache.set(record.id, record)

  const item = toSet(record)
  persistSelectedId(item.id)
  useLiveAvatar.setState((state) => ({
    ready: true,
    selectedId: item.id,
    customs: [...state.customs, item].sort((a, b) => a.createdAt - b.createdAt),
  }))
  return item
}

/** 更新已有自定义 Live 形象组的名称和/或状态图 */
export const updateCustomLiveAvatarSet = async (
  id: string,
  files: Partial<Record<LiveAvatarState, File>>,
  name?: string
): Promise<LiveAvatarSet> => {
  await initLiveAvatars()
  const db = await getAvatarDB()
  const existingRecord =
    storedRecordsCache.get(id) ?? (db ? await db.get(STORE_NAME, id) : undefined)
  if (!isValidStoredRecord(existingRecord)) {
    throw new Error('Live avatar set not found')
  }

  const nextImages: Record<LiveAvatarState, Blob> = { ...existingRecord.images }
  const nextThumbs: Record<LiveAvatarState, Blob> = { ...existingRecord.thumbs }
  const changedStates = LIVE_AVATAR_STATES.filter((state) => Boolean(files[state]))

  await Promise.all(
    changedStates.map(async (state) => {
      const file = files[state]
      if (!file) {
        return
      }
      const encoded = await encodeAvatarFile(file)
      nextImages[state] = encoded.imageBlob
      nextThumbs[state] = encoded.thumbBlob
    })
  )

  const resolvedName =
    name !== undefined ? normalizeGroupName(name) : normalizeGroupName(existingRecord.name)
  const updatedRecord: StoredLiveAvatarSet = {
    id: existingRecord.id,
    ...(resolvedName ? { name: resolvedName } : {}),
    images: nextImages,
    thumbs: nextThumbs,
    createdAt: existingRecord.createdAt,
  }

  if (db) {
    await db.put(STORE_NAME, updatedRecord)
  }
  storedRecordsCache.set(updatedRecord.id, updatedRecord)

  const prevItem = useLiveAvatar.getState().customs.find((item) => item.id === id)
  const nextItem: LiveAvatarSet = prevItem
    ? {
        id: prevItem.id,
        name: resolvedName,
        createdAt: prevItem.createdAt,
        images: { ...prevItem.images },
        thumbs: { ...prevItem.thumbs },
      }
    : toSet(updatedRecord)

  const revokedUrls: string[] = []
  if (prevItem) {
    for (const state of changedStates) {
      revokedUrls.push(prevItem.images[state], prevItem.thumbs[state])
      nextItem.images[state] = URL.createObjectURL(updatedRecord.images[state])
      nextItem.thumbs[state] = URL.createObjectURL(updatedRecord.thumbs[state])
    }
  }

  useLiveAvatar.setState((state) => ({
    customs: state.customs.map((item) => (item.id === id ? nextItem : item)),
  }))

  for (const url of revokedUrls) {
    URL.revokeObjectURL(url)
  }
  return nextItem
}

/** 删除指定自定义 Live 形象组；若删除的是当前生效组，则自动切回默认形象 */
export const removeCustomLiveAvatarSet = async (id: string): Promise<void> => {
  const db = await getAvatarDB()
  if (db) {
    await db.delete(STORE_NAME, id)
  }
  storedRecordsCache.delete(id)
  const state = useLiveAvatar.getState()
  const target = state.customs.find((item) => item.id === id)
  const nextCustoms = state.customs.filter((item) => item.id !== id)
  const nextSelectedId = state.selectedId === id ? null : state.selectedId
  if (nextSelectedId !== state.selectedId) {
    persistSelectedId(nextSelectedId)
  }
  useLiveAvatar.setState({
    customs: nextCustoms,
    selectedId: nextSelectedId,
  })
  if (target) {
    revokeSetUrls(target)
  }
}

/** 返回当前生效的自定义 Live 形象组；使用默认形象时返回 null */
export const useActiveLiveAvatarSet = (): LiveAvatarSet | null =>
  useLiveAvatar((state) => {
    if (state.selectedId === null) {
      return null
    }
    return state.customs.find((item) => item.id === state.selectedId) ?? null
  })
