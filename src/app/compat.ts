/**
 * 面向老旧 Android WebView（Chromium 61~109，覆盖 Android 8.0~13 出厂内核，
 * 如 Magic UI 3.1 / EMUI 10.1 的 Chromium 74~79 与 OriginOS 3 / HarmonyOS 的 Chromium 99~103）
 * 的轻量运行时补丁，需在主入口与 Worker 入口最先执行。
 */

const globalObj: Record<string, unknown> =
  typeof globalThis !== 'undefined'
    ? (globalThis as unknown as Record<string, unknown>)
    : typeof self !== 'undefined'
      ? (self as unknown as Record<string, unknown>)
      : typeof window !== 'undefined'
        ? (window as unknown as Record<string, unknown>)
        : {}

if (typeof globalObj.globalThis === 'undefined') {
  Object.defineProperty(globalObj, 'globalThis', {
    value: globalObj,
    configurable: true,
    writable: true,
  })
}

if (typeof globalObj.queueMicrotask !== 'function') {
  const resolved = Promise.resolve()
  Object.defineProperty(globalObj, 'queueMicrotask', {
    value(callback: VoidFunction): void {
      resolved.then(callback).catch((error: unknown) => {
        setTimeout(() => {
          throw error
        }, 0)
      })
    },
    configurable: true,
    writable: true,
  })
}

if (typeof Promise.prototype.finally !== 'function') {
  Object.defineProperty(Promise.prototype, 'finally', {
    value<T>(this: Promise<T>, onFinally?: (() => unknown) | null): Promise<T> {
      if (typeof onFinally !== 'function') {
        return this.then(onFinally, onFinally)
      }
      return this.then(
        (value) => Promise.resolve(onFinally()).then(() => value),
        (reason) =>
          Promise.resolve(onFinally()).then(() => {
            throw reason
          })
      )
    },
    configurable: true,
    writable: true,
  })
}

if (typeof Promise.allSettled !== 'function') {
  Object.defineProperty(Promise, 'allSettled', {
    value<T>(values: Iterable<T | PromiseLike<T>>): Promise<PromiseSettledResult<T>[]> {
      return Promise.all(
        Array.from(values, (item) =>
          Promise.resolve(item).then(
            (value): PromiseFulfilledResult<T> => ({ status: 'fulfilled', value }),
            (reason: unknown): PromiseRejectedResult => ({ status: 'rejected', reason })
          )
        )
      )
    },
    configurable: true,
    writable: true,
  })
}

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

if (typeof Object.fromEntries !== 'function') {
  Object.defineProperty(Object, 'fromEntries', {
    value<T = unknown>(entries: Iterable<readonly [PropertyKey, T]>): Record<string, T> {
      const result: Record<PropertyKey, T> = {}
      for (const entry of entries) {
        result[entry[0]] = entry[1]
      }
      return result as Record<string, T>
    },
    configurable: true,
    writable: true,
  })
}

if (typeof Array.prototype.flat !== 'function') {
  const flatten = (source: ArrayLike<unknown>, depth: number, out: unknown[]) => {
    const length = source.length >>> 0
    for (let i = 0; i < length; i++) {
      if (!(i in source)) {
        continue
      }
      const item = source[i]
      if (depth > 0 && Array.isArray(item)) {
        flatten(item, depth - 1, out)
      } else {
        out.push(item)
      }
    }
  }
  Object.defineProperty(Array.prototype, 'flat', {
    value(this: ArrayLike<unknown>, depth = 1): unknown[] {
      const out: unknown[] = []
      const safeDepth = Number.isNaN(depth) ? 0 : Math.floor(depth)
      flatten(this, safeDepth, out)
      return out
    },
    configurable: true,
    writable: true,
  })
}

if (typeof Array.prototype.flatMap !== 'function') {
  Object.defineProperty(Array.prototype, 'flatMap', {
    value<T, U>(
      this: readonly T[],
      callback: (value: T, index: number, array: readonly T[]) => U | readonly U[],
      thisArg?: unknown
    ): U[] {
      const out: U[] = []
      const length = this.length >>> 0
      for (let i = 0; i < length; i++) {
        if (!(i in this)) {
          continue
        }
        const mapped = callback.call(thisArg, this[i], i, this)
        if (Array.isArray(mapped)) {
          for (let j = 0; j < mapped.length; j++) {
            out.push(mapped[j] as U)
          }
        } else {
          out.push(mapped as U)
        }
      }
      return out
    },
    configurable: true,
    writable: true,
  })
}

if (typeof String.prototype.matchAll !== 'function') {
  Object.defineProperty(String.prototype, 'matchAll', {
    value(this: string, matcher: RegExp | string): IterableIterator<RegExpExecArray> {
      const str = String(this)
      if (matcher instanceof RegExp && !matcher.global) {
        throw new TypeError('String.prototype.matchAll called with a non-global RegExp argument')
      }
      const flags = matcher instanceof RegExp ? matcher.flags : 'g'
      const regex = new RegExp(matcher instanceof RegExp ? matcher.source : matcher, flags)
      if (matcher instanceof RegExp) {
        regex.lastIndex = matcher.lastIndex
      }
      function* iterate(): IterableIterator<RegExpExecArray> {
        let match = regex.exec(str)
        while (match !== null) {
          yield match
          if (match[0] === '') {
            regex.lastIndex += 1
          }
          match = regex.exec(str)
        }
      }
      return iterate()
    },
    configurable: true,
    writable: true,
  })
}

if (typeof String.prototype.replaceAll !== 'function') {
  Object.defineProperty(String.prototype, 'replaceAll', {
    value(
      this: string,
      searchValue: string | RegExp,
      replaceValue: string | ((substring: string, ...args: unknown[]) => string)
    ): string {
      const str = String(this)
      if (searchValue instanceof RegExp) {
        if (!searchValue.global) {
          throw new TypeError('String.prototype.replaceAll called with a non-global RegExp')
        }
        return typeof replaceValue === 'function'
          ? str.replace(searchValue, replaceValue)
          : str.replace(searchValue, replaceValue)
      }
      const needle = String(searchValue)
      if (typeof replaceValue === 'function') {
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return str.replace(new RegExp(escaped, 'g'), replaceValue)
      }
      return str.split(needle).join(replaceValue)
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
  typeof AbortController !== 'undefined' &&
  typeof AbortSignal !== 'undefined' &&
  !('reason' in AbortSignal.prototype)
) {
  const reasons = new WeakMap<AbortSignal, unknown>()
  const nativeAbort = AbortController.prototype.abort
  Object.defineProperty(AbortSignal.prototype, 'reason', {
    get(this: AbortSignal): unknown {
      if (!this.aborted) {
        return undefined
      }
      return reasons.has(this)
        ? reasons.get(this)
        : new DOMException('The operation was aborted.', 'AbortError')
    },
    configurable: true,
  })
  Object.defineProperty(AbortController.prototype, 'abort', {
    value(this: AbortController, reason?: unknown): void {
      if (!this.signal.aborted) {
        reasons.set(
          this.signal,
          reason !== undefined
            ? reason
            : new DOMException('The operation was aborted.', 'AbortError')
        )
      }
      nativeAbort.call(this)
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
        const reason = this.reason
        throw reason !== undefined
          ? reason
          : new DOMException('The operation was aborted.', 'AbortError')
      }
    },
    configurable: true,
    writable: true,
  })
}

if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    value(this: Blob): Promise<ArrayBuffer> {
      if (typeof FileReader !== 'undefined') {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'))
          reader.readAsArrayBuffer(this)
        })
      }
      return new Response(this).arrayBuffer()
    },
    configurable: true,
    writable: true,
  })
}

// Blob.text / Blob.stream 在 Chromium 76 才加入；旧内核的会话导入与分片导出依赖它们。
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Object.defineProperty(Blob.prototype, 'text', {
    value(this: Blob): Promise<string> {
      return this.arrayBuffer().then((buffer) => new TextDecoder().decode(buffer))
    },
    configurable: true,
    writable: true,
  })
}

if (typeof Blob !== 'undefined' && typeof Blob.prototype.stream !== 'function') {
  Object.defineProperty(Blob.prototype, 'stream', {
    value(this: Blob): ReadableStream<Uint8Array> {
      let offset = 0
      const chunkSize = 64 * 1024
      return new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          if (offset >= this.size) {
            controller.close()
            return
          }
          const chunk = this.slice(offset, offset + chunkSize)
          const buffer = await chunk.arrayBuffer()
          offset += chunk.size
          controller.enqueue(new Uint8Array(buffer))
          if (offset >= this.size) {
            controller.close()
          }
        },
      })
    },
    configurable: true,
    writable: true,
  })
}

if (typeof globalObj.structuredClone !== 'function') {
  const cloneValue = (value: unknown, seen: WeakMap<object, unknown>): unknown => {
    if (value === null || typeof value !== 'object') {
      return value
    }
    if (seen.has(value)) {
      return seen.get(value)
    }
    if (value instanceof Date) {
      return new Date(value.getTime())
    }
    if (value instanceof RegExp) {
      return new RegExp(value.source, value.flags)
    }
    if (value instanceof ArrayBuffer) {
      return value.slice(0)
    }
    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(value.byteLength)
      bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      if (value instanceof DataView) {
        return new DataView(bytes.buffer)
      }
      const TypedCtor = value.constructor as new (
        buffer: ArrayBuffer,
        byteOffset: number,
        length: number
      ) => ArrayBufferView
      const typed = value as Uint8Array
      return new TypedCtor(bytes.buffer, 0, typed.length)
    }
    if (Array.isArray(value)) {
      const copy: unknown[] = []
      seen.set(value, copy)
      for (let i = 0; i < value.length; i++) {
        copy[i] = cloneValue(value[i], seen)
      }
      return copy
    }
    if (value instanceof Map) {
      const copy = new Map<unknown, unknown>()
      seen.set(value, copy)
      value.forEach((v, k) => {
        copy.set(cloneValue(k, seen), cloneValue(v, seen))
      })
      return copy
    }
    if (value instanceof Set) {
      const copy = new Set<unknown>()
      seen.set(value, copy)
      value.forEach((v) => {
        copy.add(cloneValue(v, seen))
      })
      return copy
    }
    const copy: Record<string, unknown> = {}
    seen.set(value, copy)
    for (const key of Object.keys(value)) {
      copy[key] = cloneValue((value as Record<string, unknown>)[key], seen)
    }
    return copy
  }
  Object.defineProperty(globalObj, 'structuredClone', {
    value<T>(value: T): T {
      return cloneValue(value, new WeakMap()) as T
    },
    configurable: true,
    writable: true,
  })
}
