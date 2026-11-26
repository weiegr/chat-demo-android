import { create } from 'zustand'

export type MockAccountProfile = {
  /** 可选邮箱，昵称为空时作为展示名称 */
  email: string
  /** 可选昵称（优先作为展示名称；未设置时界面显示「未设置」） */
  nickname: string
  /** 是否在快速模式与专家模式对话时将昵称拼接到提示词中 */
  useNicknameInReply: boolean
  /** 自定义头像 DataURL（256x256 居中裁切压缩）；null 时使用默认头像 */
  avatarDataUrl: string | null
  /** 预留自定义背景图 DataURL；null 时使用内置氛围背景 */
  coverDataUrl: string | null
}

const STORAGE_KEY = 'chat-demo:mock-account-profile'
const AVATAR_SIZE = 256
const COVER_MAX_SIDE = 1080
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024
export const MAX_ACCOUNT_NICKNAME_LENGTH = 32

const normalizeNickname = (value: string): string =>
  value
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_ACCOUNT_NICKNAME_LENGTH)

export const DEFAULT_MOCK_ACCOUNT: MockAccountProfile = {
  email: '',
  nickname: '',
  useNicknameInReply: false,
  avatarDataUrl: null,
  coverDataUrl: null,
}

const readStoredProfile = (): MockAccountProfile => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_MOCK_ACCOUNT
    }
    const parsed = JSON.parse(raw) as Partial<MockAccountProfile> | null
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_MOCK_ACCOUNT
    }
    return {
      email: typeof parsed.email === 'string' ? parsed.email.trim() : '',
      nickname: typeof parsed.nickname === 'string' ? normalizeNickname(parsed.nickname) : '',
      useNicknameInReply: parsed.useNicknameInReply === true,
      avatarDataUrl:
        typeof parsed.avatarDataUrl === 'string' && parsed.avatarDataUrl.startsWith('data:image/')
          ? parsed.avatarDataUrl
          : null,
      coverDataUrl:
        typeof parsed.coverDataUrl === 'string' && parsed.coverDataUrl.startsWith('data:image/')
          ? parsed.coverDataUrl
          : null,
    }
  } catch {
    return DEFAULT_MOCK_ACCOUNT
  }
}

const persistProfile = (profile: MockAccountProfile): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
    return true
  } catch {
    return false
  }
}

/** 模拟账号本地资料状态，供侧边栏与设置页共享 */
export const useMockAccount = create<MockAccountProfile>(() => readStoredProfile())

/** 返回已设置的展示名称（昵称优先，其次邮箱）；都未设置时返回空字符串，由界面显示「未设置」 */
export const getAccountDisplayLabel = (profile: MockAccountProfile): string =>
  profile.nickname.trim() || profile.email.trim()

export const updateMockAccount = (patch: Partial<MockAccountProfile>): boolean => {
  const next: MockAccountProfile = { ...useMockAccount.getState(), ...patch }
  const saved = persistProfile(next)
  useMockAccount.setState(next)
  return saved
}

export const setMockAccountNickname = (nickname: string): boolean =>
  updateMockAccount({ nickname: normalizeNickname(nickname) })

export const setMockAccountUseNicknameInReply = (useNicknameInReply: boolean): boolean =>
  updateMockAccount({ useNicknameInReply })

export const setMockAccountAvatar = (avatarDataUrl: string | null): boolean =>
  updateMockAccount({ avatarDataUrl })

export const setMockAccountCover = (coverDataUrl: string | null): boolean =>
  updateMockAccount({ coverDataUrl })

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

const encodeCanvasImage = (canvas: HTMLCanvasElement, quality: number): string => {
  const webp = canvas.toDataURL('image/webp', quality)
  if (webp.startsWith('data:image/webp')) {
    return webp
  }
  return canvas.toDataURL('image/jpeg', Math.min(0.9, quality + 0.02))
}

/** 将用户选择的图片居中裁切为正方形并压缩为轻量 DataURL（兼容 Chromium 61+） */
export const processAvatarImage = async (file: File): Promise<string> => {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error('Avatar image is too large')
  }
  const image = await loadImageFromFile(file)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions')
  }

  const side = Math.min(width, height)
  const sx = Math.floor((width - side) / 2)
  const sy = Math.floor((height - side) / 2)

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.width = 0
    canvas.height = 0
    throw new Error('Canvas context unavailable')
  }

  try {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
    return encodeCanvasImage(canvas, 0.85)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** 将用户选择的背景图按长边上限等比缩放并压缩为轻量 DataURL（兼容 Chromium 61+） */
export const processCoverImage = async (file: File): Promise<string> => {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error('Cover image is too large')
  }
  const image = await loadImageFromFile(file)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions')
  }

  const scale = Math.min(1, COVER_MAX_SIDE / Math.max(width, height))
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
    return encodeCanvasImage(canvas, 0.82)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
