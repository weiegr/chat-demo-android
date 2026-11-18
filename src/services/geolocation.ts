export type ResolvedLocation = {
  latitude: number
  longitude: number
  accuracy?: number
  approximate?: boolean
  timestamp: number
  country?: string
  province?: string
  city?: string
  district?: string
  address?: string
  /** 供工具时间线展示的简短地点摘要（城市或经纬度） */
  summary: string
}

export type LocationErrorCode =
  | 'permission_denied'
  | 'precise_location_required'
  | 'location_disabled'
  | 'timeout'
  | 'unavailable'

export type LocationPermissionLevel = 'fine' | 'coarse' | 'none' | 'unknown'

export type LocationPermissionResult = {
  granted: boolean
  fineGranted: boolean
  level: LocationPermissionLevel
  /** 之前选过大致位置或拒绝后，系统已静默拦截弹窗时为 true */
  blockedUpgrade: boolean
}

export class GeolocationError extends Error {
  constructor(
    readonly code: LocationErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'GeolocationError'
  }
}

interface AndroidLocationBridge {
  hasLocationPermission?: () => boolean
  getLocationPermissionLevel?: () => LocationPermissionLevel
  openAppLocationSettings?: () => void
  requestLocationPermission?: () => void
  requestCurrentLocation?: (requestId: number) => void
}

interface AndroidLocationEventDetail {
  requestId?: number
  ok?: boolean
  latitude?: number
  longitude?: number
  accuracy?: number
  approximate?: boolean
  timestamp?: number
  country?: string
  province?: string
  city?: string
  district?: string
  address?: string
  errorCode?: LocationErrorCode
  message?: string
}

interface AndroidPermissionEventDetail {
  granted?: boolean
  fineGranted?: boolean
  level?: LocationPermissionLevel
  blockedUpgrade?: boolean
}

const getAndroidHost = (): AndroidLocationBridge | undefined =>
  (window as Window & { AndroidHost?: AndroidLocationBridge }).AndroidHost

let nextRequestId = 1

const formatCoords = (lat: number, lon: number) => {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lonDir = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(2)}°${latDir}, ${Math.abs(lon).toFixed(2)}°${lonDir}`
}

const buildSummary = (info: {
  latitude: number
  longitude: number
  province?: string
  city?: string
  district?: string
  country?: string
}) => {
  const parts = [info.city || info.province || info.country, info.district].filter(Boolean)
  if (parts.length > 0) {
    return parts.join(' · ')
  }
  return formatCoords(info.latitude, info.longitude)
}

/** 查询 Android 宿主当前的定位授权精度级别；网页环境返回 unknown */
export const getDeviceLocationPermissionLevel = (): LocationPermissionLevel => {
  const host = getAndroidHost()
  if (host?.getLocationPermissionLevel) {
    return host.getLocationPermissionLevel()
  }
  if (host?.hasLocationPermission) {
    return host.hasLocationPermission() ? 'fine' : 'none'
  }
  return 'unknown'
}

/** 在 Android 宿主中跳转系统应用权限设置页，供被系统锁定二次弹窗时开启精确位置 */
export const openDeviceLocationSettings = () => {
  getAndroidHost()?.openAppLocationSettings?.()
}

/** 订阅 Android 宿主定位权限等级变更（授权弹窗结果或从系统设置返回） */
export const subscribeLocationPermissionChange = (
  listener: (detail: LocationPermissionResult) => void
) => {
  const onPermission = (event: Event) => {
    const detail = (event as CustomEvent<AndroidPermissionEventDetail | undefined>).detail
    const level = detail?.level ?? getDeviceLocationPermissionLevel()
    listener({
      granted: Boolean(detail?.granted ?? (level === 'fine' || level === 'coarse')),
      fineGranted: Boolean(detail?.fineGranted ?? level === 'fine'),
      level,
      blockedUpgrade: Boolean(detail?.blockedUpgrade),
    })
  }
  window.addEventListener('android-location-permission', onPermission)
  return () => window.removeEventListener('android-location-permission', onPermission)
}

/** 请求精确位置权限：尚未拿到 fine 权限（含仅大致位置）时也会尝试向系统请求升级 */
export const requestPreciseLocationPermission = (): Promise<LocationPermissionResult> => {
  const host = getAndroidHost()
  if (!host?.requestLocationPermission) {
    return Promise.resolve({
      granted: true,
      fineGranted: true,
      level: 'unknown',
      blockedUpgrade: false,
    })
  }
  const currentLevel = getDeviceLocationPermissionLevel()
  if (currentLevel === 'fine') {
    return Promise.resolve({
      granted: true,
      fineGranted: true,
      level: 'fine',
      blockedUpgrade: false,
    })
  }
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer)
      unsubscribe()
    }
    const unsubscribe = subscribeLocationPermissionChange((detail) => {
      cleanup()
      resolve(detail)
    })
    const timer = setTimeout(() => {
      cleanup()
      const level = getDeviceLocationPermissionLevel()
      resolve({
        granted: level === 'fine' || level === 'coarse',
        fineGranted: level === 'fine',
        level,
        blockedUpgrade: false,
      })
    }, 30_000)
    host.requestLocationPermission?.()
  })
}

/** 请求系统位置权限（在 Android 宿主里预先向系统申请；网页环境无独立预授权 API 时直接返回 true）。 */
export const requestDeviceLocationPermission = (): Promise<boolean> =>
  requestPreciseLocationPermission().then((res) => res.granted)

const fetchViaAndroid = (
  host: Required<Pick<AndroidLocationBridge, 'requestCurrentLocation'>>,
  signal?: AbortSignal
): Promise<ResolvedLocation> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const requestId = nextRequestId++
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('android-location-result', onResult)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AndroidLocationEventDetail | undefined>).detail
      if (!detail || detail.requestId !== requestId) {
        return
      }
      cleanup()
      if (
        detail.ok &&
        typeof detail.latitude === 'number' &&
        typeof detail.longitude === 'number'
      ) {
        resolve({
          latitude: detail.latitude,
          longitude: detail.longitude,
          accuracy: detail.accuracy,
          approximate: detail.approximate,
          timestamp: detail.timestamp ?? Date.now(),
          country: detail.country,
          province: detail.province,
          city: detail.city,
          district: detail.district,
          address: detail.address,
          summary: buildSummary({
            latitude: detail.latitude,
            longitude: detail.longitude,
            province: detail.province,
            city: detail.city,
            district: detail.district,
            country: detail.country,
          }),
        })
      } else {
        reject(
          new GeolocationError(
            detail.errorCode ?? 'unavailable',
            detail.message ?? 'Failed to retrieve current location'
          )
        )
      }
    }
    // 预留 30 秒，覆盖用户初次响应系统定位权限弹窗的时间
    const timer = setTimeout(() => {
      cleanup()
      reject(new GeolocationError('timeout', 'Location request timed out'))
    }, 30_000)

    window.addEventListener('android-location-result', onResult)
    signal?.addEventListener('abort', onAbort, { once: true })
    host.requestCurrentLocation(requestId)
  })

const fetchViaBrowser = (signal?: AbortSignal): Promise<ResolvedLocation> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeolocationError('unavailable', 'Geolocation API is not supported'))
      return
    }
    let settled = false
    const onAbort = () => {
      if (settled) {
        return
      }
      settled = true
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (settled) {
          return
        }
        settled = true
        signal?.removeEventListener('abort', onAbort)
        const { latitude, longitude, accuracy } = position.coords
        resolve({
          latitude,
          longitude,
          accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
          timestamp: position.timestamp || Date.now(),
          summary: formatCoords(latitude, longitude),
        })
      },
      (error) => {
        if (settled) {
          return
        }
        settled = true
        signal?.removeEventListener('abort', onAbort)
        const code: LocationErrorCode =
          error.code === error.PERMISSION_DENIED
            ? 'permission_denied'
            : error.code === error.TIMEOUT
              ? 'timeout'
              : 'unavailable'
        reject(new GeolocationError(code, error.message || 'Location request failed'))
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    )
  })

/** 获取设备当前真实地理位置（Android 优先原生 LocationManager + Geocoder，网页兜底 navigator.geolocation） */
export const getCurrentPosition = (signal?: AbortSignal): Promise<ResolvedLocation> => {
  const host = getAndroidHost()
  if (host && typeof host.requestCurrentLocation === 'function') {
    return fetchViaAndroid(
      host as Required<Pick<AndroidLocationBridge, 'requestCurrentLocation'>>,
      signal
    )
  }
  return fetchViaBrowser(signal)
}
