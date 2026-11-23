import { useRef, useState } from 'react'
import { ApiError, verifyApiKey } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import { setApiKey } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'

/** 输入 API Key 后先用 GET /models 校验，通过才保存 */
export const useApiKeyForm = (onSaved?: () => void) => {
  const t = useTranslate()
  const [value, setValue] = useState('')
  const [pending, setPending] = useState<'save' | 'clear' | null>(null)
  const busy = useRef(false)
  const [failure, setFailure] = useState<
    { kind: 'storage' } | { kind: 'verify'; cause: unknown } | null
  >(null)
  let error = null
  if (failure?.kind === 'storage') {
    error = t('apiKeyStorageWriteFailed')
  } else if (failure?.kind === 'verify') {
    const { cause } = failure
    const kind = classifyApiError(cause)
    error =
      kind === 'unauthorized'
        ? t('apiKeyInvalid')
        : kind === 'network'
          ? t('commonNetworkErrorToast')
          : t('apiKeyVerificationFailed', {
              message:
                cause instanceof ApiError && cause.localMessage
                  ? t(cause.localMessage.key, cause.localMessage.params)
                  : cause instanceof Error
                    ? cause.message
                    : String(cause),
            })
  }

  const reset = () => {
    setValue('')
    setFailure(null)
  }

  const save = async (apiKey: string | null) => {
    if (busy.current) {
      return false
    }
    busy.current = true
    setPending(apiKey === null ? 'clear' : 'save')
    setFailure(null)
    try {
      if (apiKey !== null) {
        try {
          await verifyApiKey(apiKey)
        } catch (cause) {
          setFailure({ kind: 'verify', cause })
          return false
        }
      }
      try {
        await setApiKey(apiKey)
      } catch {
        setFailure({ kind: 'storage' })
        return false
      }
      reset()
      return true
    } finally {
      busy.current = false
      setPending(null)
    }
  }

  const submit = async () => {
    const apiKey = value.trim()
    if (apiKey && (await save(apiKey))) {
      onSaved?.()
    }
  }

  return { value, setValue, reset, pending, error, submit, clear: () => save(null) }
}
