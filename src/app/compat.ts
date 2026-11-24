/**
 * 面向老旧 Android WebView（Chromium 80~109，例如部分 OriginOS 3 / HarmonyOS 内置内核）
 * 的轻量运行时补丁，需在主入口与 Worker 入口最先执行。
 */

const ownProperty = Object.prototype.hasOwnProperty

if (typeof Object.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    value(target: object, key: PropertyKey): boolean {
      return ownProperty.call(Object(target), key)
    },
    configurable: true,
    writable: true,
  })
}

const defineAt = (proto: object | null | undefined) => {
  if (!proto || 'at' in proto) {
    return
  }
  Object.defineProperty(proto, 'at', {
    value(this: ArrayLike<unknown>, index: number): unknown {
      const length = this.length >>> 0
      let relative = Math.trunc(index) || 0
      if (relative < 0) {
        relative += length
      }
      if (relative < 0 || relative >= length) {
        return undefined
      }
      return this[relative]
    },
    configurable: true,
    writable: true,
  })
}

defineAt(Array.prototype)
defineAt(String.prototype)
const typedArrayProto = Object.getPrototypeOf(Uint8Array.prototype) as object | null
if (typedArrayProto && typedArrayProto !== Object.prototype) {
  defineAt(typedArrayProto)
}

if (typeof Array.prototype.toSorted !== 'function') {
  Object.defineProperty(Array.prototype, 'toSorted', {
    value<T>(this: readonly T[], compareFn?: (a: T, b: T) => number): T[] {
      return Array.from(this).sort(compareFn)
    },
    configurable: true,
    writable: true,
  })
}

if (
  typeof AbortSignal !== 'undefined' &&
  typeof AbortSignal.prototype.throwIfAborted !== 'function'
) {
  Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', {
    value(this: AbortSignal): void {
      if (this.aborted) {
        throw this.reason ?? new DOMException('The operation was aborted.', 'AbortError')
      }
    },
    configurable: true,
    writable: true,
  })
}
