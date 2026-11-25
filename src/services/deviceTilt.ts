export type DeviceTilt = {
  /** 归一化横向倾斜强度（-1 ~ 1），向右倾斜为正 */
  x: number
  /** 归一化纵向倾斜强度（-1 ~ 1），底部下倾（向后仰）为正，与横向重力倾向一致 */
  y: number
}

type TiltListener = (tilt: DeviceTilt) => void

interface AndroidTiltHost {
  supportsTiltSensor?: () => boolean
  setTiltSensorEnabled?: (enabled: boolean) => void
}

type TiltWindow = Window & {
  AndroidHost?: AndroidTiltHost
  __tiltBridge?: (rollRad: number, pitchRad: number) => void
}

const DEG_TO_RAD = Math.PI / 180
/** 约 18°（0.31 rad）时接近饱满视差幅度，配合 tanh 软限幅避免生硬撞边 */
const ROLL_SENSITIVITY_RAD = 0.31
const PITCH_SENSITIVITY_RAD = 0.29
/** 基准握持角度自适应回中时间常数（秒）：换姿势后柔和归正，主动晃动时保持充足视差 */
const RECENTER_TAU_SECONDS = 4.5

const listeners = new Set<TiltListener>()
let active = false
let nativeActive = false
let nativeReceived = false
let webActive = false
let fallbackTimer: number | undefined
let baseRoll: number | null = null
let basePitch: number | null = null
let lastSampleAt = 0

const wrapRad = (angle: number) => {
  let result = angle
  while (result > Math.PI) {
    result -= Math.PI * 2
  }
  while (result < -Math.PI) {
    result += Math.PI * 2
  }
  return result
}

const getScreenAngle = () => {
  if (typeof window === 'undefined') {
    return 0
  }
  const orientationAngle = window.screen?.orientation?.angle
  if (typeof orientationAngle === 'number' && Number.isFinite(orientationAngle)) {
    return ((orientationAngle % 360) + 360) % 360
  }
  const legacy = (window as Window & { orientation?: number }).orientation
  return typeof legacy === 'number' && Number.isFinite(legacy) ? ((legacy % 360) + 360) % 360 : 0
}

const resetBaseline = () => {
  baseRoll = null
  basePitch = null
  lastSampleAt = 0
}

const emitTilt = (tilt: DeviceTilt) => {
  for (const listener of listeners) {
    listener(tilt)
  }
}

const handleRawAngles = (rollRad: number, pitchRad: number) => {
  if (!Number.isFinite(rollRad) || !Number.isFinite(pitchRad)) {
    return
  }
  const now = performance.now()
  if (baseRoll === null || basePitch === null) {
    baseRoll = rollRad
    basePitch = pitchRad
    lastSampleAt = now
    emitTilt({ x: 0, y: 0 })
    return
  }

  const dt = Math.min(Math.max((now - lastSampleAt) / 1000, 0), 0.25)
  lastSampleAt = now

  const dRoll = wrapRad(rollRad - baseRoll)
  const dPitch = wrapRad(pitchRad - basePitch)

  // 慢速自适应回中：用户稳定切换握持角度后柔和归零，晃动时保持立体偏移
  if (dt > 0) {
    const recenterAlpha = 1 - Math.exp(-dt / RECENTER_TAU_SECONDS)
    baseRoll = wrapRad(baseRoll + dRoll * recenterAlpha)
    basePitch = wrapRad(basePitch + dPitch * recenterAlpha)
  }

  const x = Math.tanh(dRoll / ROLL_SENSITIVITY_RAD)
  const y = -Math.tanh(dPitch / PITCH_SENSITIVITY_RAD)
  emitTilt({ x, y })
}

const onWebDeviceOrientation = (event: DeviceOrientationEvent) => {
  if (nativeReceived) {
    return
  }
  const { beta, gamma } = event
  if (typeof beta !== 'number' || typeof gamma !== 'number') {
    return
  }
  const angle = getScreenAngle()
  let rollDeg = gamma
  let pitchDeg = -beta
  if (angle === 90) {
    rollDeg = beta
    pitchDeg = gamma
  } else if (angle === 270) {
    rollDeg = -beta
    pitchDeg = -gamma
  } else if (angle === 180) {
    rollDeg = -gamma
    pitchDeg = beta
  }
  handleRawAngles(rollDeg * DEG_TO_RAD, pitchDeg * DEG_TO_RAD)
}

const attachWebOrientation = () => {
  if (webActive || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
    return
  }
  // iOS 13+ 需要用户手势触发 requestPermission，不在此处静默触发报错
  const ctor = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<string>
  }
  if (typeof ctor?.requestPermission === 'function') {
    return
  }
  webActive = true
  window.addEventListener('deviceorientation', onWebDeviceOrientation, true)
}

const detachWebOrientation = () => {
  if (!webActive || typeof window === 'undefined') {
    return
  }
  webActive = false
  window.removeEventListener('deviceorientation', onWebDeviceOrientation, true)
}

const onVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    resetBaseline()
    emitTilt({ x: 0, y: 0 })
  }
}

const startTracking = () => {
  if (active || typeof window === 'undefined') {
    return
  }
  active = true
  nativeActive = false
  nativeReceived = false
  resetBaseline()
  document.addEventListener('visibilitychange', onVisibilityChange)

  const win = window as TiltWindow
  const host = win.AndroidHost
  const canUseNative =
    typeof host?.setTiltSensorEnabled === 'function' &&
    (typeof host.supportsTiltSensor !== 'function' || host.supportsTiltSensor())

  if (canUseNative) {
    nativeActive = true
    win.__tiltBridge = (rollRad: number, pitchRad: number) => {
      if (!active) {
        return
      }
      if (!nativeReceived) {
        nativeReceived = true
        window.clearTimeout(fallbackTimer)
        fallbackTimer = undefined
        detachWebOrientation()
      }
      handleRawAngles(rollRad, pitchRad)
    }
    try {
      host?.setTiltSensorEnabled?.(true)
    } catch {
      nativeActive = false
      delete win.__tiltBridge
      attachWebOrientation()
      return
    }
    // 极端模拟器环境若无原生传感器样本，1 秒后自动尝试 Web deviceorientation 兜底
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = undefined
      if (active && !nativeReceived) {
        attachWebOrientation()
      }
    }, 1000)
    return
  }

  attachWebOrientation()
}

const stopTracking = () => {
  if (!active || typeof window === 'undefined') {
    return
  }
  active = false
  window.clearTimeout(fallbackTimer)
  fallbackTimer = undefined
  document.removeEventListener('visibilitychange', onVisibilityChange)
  detachWebOrientation()

  const win = window as TiltWindow
  if (nativeActive) {
    nativeActive = false
    nativeReceived = false
    delete win.__tiltBridge
    try {
      win.AndroidHost?.setTiltSensorEnabled?.(false)
    } catch {
      // 忽略宿主销毁期的桥接异常
    }
  }
  resetBaseline()
}

/**
 * 订阅设备陀螺仪/方向倾斜状态：
 * - Android 宿主下优先使用原生 GAME_ROTATION_VECTOR / GRAVITY 融合桥接（零磁场漂移、无万向锁）；
 * - 其余环境自动回退到标准 Web `deviceorientation`；
 * - 无订阅者时立即停止底层传感器监听，不产生额外耗电。
 */
export const subscribeDeviceTilt = (listener: TiltListener): (() => void) => {
  listeners.add(listener)
  if (listeners.size === 1) {
    startTracking()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopTracking()
    }
  }
}
