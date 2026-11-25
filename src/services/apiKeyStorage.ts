import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { createId } from '../utils/id.js'

const LEGACY_API_KEY = 'chat-demo:api-key'
const KEY_RECORD = 'apiKey'

type EncryptedKey = { key: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer }
type ApiKeyStorageMode = 'ready' | 'temporary'

interface CredentialsDB extends DBSchema {
  credentials: { key: typeof KEY_RECORD; value: EncryptedKey | null }
}

interface AndroidApiKeyHost {
  connectApiKeyStorage(requestId: string): void
}

const getAndroidHost = () => {
  const host = (window as Window & { AndroidHost?: AndroidApiKeyHost }).AndroidHost
  return typeof host?.connectApiKeyStorage === 'function' ? host : undefined
}

const requestAndroidStorage = (
  host: AndroidApiKeyHost,
  operation: 'load' | 'save',
  apiKey: string | null
): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const requestId = createId()
    let port: MessagePort | undefined

    const cleanup = () => {
      window.clearTimeout(timeout)
      window.removeEventListener('message', connect)
      port?.close()
    }

    const fail = () => {
      cleanup()
      reject(new Error('Android API key storage request failed'))
    }

    const connect = (event: MessageEvent) => {
      if (
        !event.isTrusted ||
        event.source !== null ||
        event.data !== `chat-demo:api-key-storage:${requestId}` ||
        !event.ports[0]
      ) {
        return
      }
      window.removeEventListener('message', connect)
      port = event.ports[0]
      port.onmessage = ({ data }) => {
        try {
          const response = JSON.parse(data) as { ok: boolean; apiKey?: string | null }
          if (response.ok && (response.apiKey === null || typeof response.apiKey === 'string')) {
            cleanup()
            resolve(response.apiKey)
          } else {
            fail()
          }
        } catch {
          fail()
        }
      }
      port.onmessageerror = fail
      try {
        port.postMessage(JSON.stringify({ operation, apiKey }))
      } catch {
        fail()
      }
    }

    const timeout = window.setTimeout(fail, 10_000)
    window.addEventListener('message', connect)
    try {
      host.connectApiKeyStorage(requestId)
    } catch {
      fail()
    }
  })

let browserDB: Promise<IDBPDatabase<CredentialsDB> | null> | undefined

const getBrowserDB = async () => {
  if (!globalThis.crypto?.subtle || typeof indexedDB === 'undefined') {
    return null
  }
  try {
    return await (browserDB ??= openDB<CredentialsDB>('chat-demo-credentials', 1, {
      upgrade(db) {
        db.createObjectStore('credentials')
      },
    }))
  } catch (error) {
    browserDB = undefined
    if (
      error instanceof DOMException &&
      ['SecurityError', 'InvalidStateError'].includes(error.name)
    ) {
      return null
    }
    throw error
  }
}

const encrypt = async (apiKey: string): Promise<EncryptedKey> => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(apiKey)
  )
  return { key, iv, ciphertext }
}

const loadBrowserKey = async (db: IDBPDatabase<CredentialsDB>, legacyKey: string | null) => {
  let record = await db.get('credentials', KEY_RECORD)
  if (record === undefined && legacyKey) {
    const encrypted = await encrypt(legacyKey)
    try {
      await db.add('credentials', encrypted, KEY_RECORD)
      return legacyKey
    } catch (error) {
      // Another tab may have migrated, replaced or cleared the setting in the meantime.
      if (!(error instanceof DOMException && error.name === 'ConstraintError')) {
        throw error
      }
      record = await db.get('credentials', KEY_RECORD)
    }
  }
  if (!record) {
    return null
  }
  const { key, iv, ciphertext } = record
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}

const readLegacyKey = () => {
  try {
    return localStorage.getItem(LEGACY_API_KEY)
  } catch {
    return null
  }
}

const removeLegacyKey = () => {
  if (readLegacyKey() !== null) {
    localStorage.removeItem(LEGACY_API_KEY)
  }
}

export const loadStoredApiKey = async (): Promise<{
  apiKey: string | null
  apiKeyStorageMode: ApiKeyStorageMode
}> => {
  const legacyKey = readLegacyKey() || null
  const host = getAndroidHost()
  if (host) {
    const apiKey = await requestAndroidStorage(host, 'load', legacyKey)
    removeLegacyKey()
    return { apiKey, apiKeyStorageMode: 'ready' }
  }

  const db = await getBrowserDB()
  const apiKey = db ? await loadBrowserKey(db, legacyKey) : legacyKey
  removeLegacyKey()
  return { apiKey, apiKeyStorageMode: db ? 'ready' : 'temporary' }
}

export const saveStoredApiKey = async (apiKey: string | null): Promise<ApiKeyStorageMode> => {
  const host = getAndroidHost()
  if (host) {
    await requestAndroidStorage(host, 'save', apiKey)
    removeLegacyKey()
    return 'ready'
  }

  const db = await getBrowserDB()
  if (db) {
    // Keep an explicit empty record so delayed migrations from other tabs cannot restore a key.
    await db.put('credentials', apiKey === null ? null : await encrypt(apiKey), KEY_RECORD)
  }
  removeLegacyKey()
  return db ? 'ready' : 'temporary'
}
