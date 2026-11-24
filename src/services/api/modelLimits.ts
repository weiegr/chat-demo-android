import { API_ORIGIN, request } from './client.js'
import type { ChatModel } from './types.js'

export type ModelLimits = { context: number; output: number }

export const DEFAULT_MODEL_LIMITS: ModelLimits = { context: 1_048_576, output: 393_216 }

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const fetchLimits = async (apiKey: string) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3_000)
  try {
    const response = await request(`${API_ORIGIN}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      cache: 'no-store',
    })
    const body = (await response.json()) as { data?: unknown[] } | null
    const limits = new Map<ChatModel, ModelLimits>()
    for (const value of Array.isArray(body?.data) ? body.data : []) {
      if (typeof value !== 'object' || value === null || !('id' in value)) {
        continue
      }
      const { id, context_window, max_output_tokens } = value as {
        id: unknown
        context_window?: unknown
        max_output_tokens?: unknown
      }
      if (id === 'deepseek-flash' || id === 'deepseek-v4-pro') {
        limits.set(id, {
          context: positiveInteger(context_window) ? context_window : DEFAULT_MODEL_LIMITS.context,
          output: positiveInteger(max_output_tokens)
            ? max_output_tokens
            : DEFAULT_MODEL_LIMITS.output,
        })
      }
    }
    return limits
  } finally {
    clearTimeout(timer)
  }
}

const TTL_MS = 15 * 60_000
let cached: { apiKey: string; expires: number; limits: ReturnType<typeof fetchLimits> } | undefined

export const getModelLimits = async (
  apiKey: string | null,
  model: ChatModel
): Promise<ModelLimits> => {
  if (!apiKey) {
    return DEFAULT_MODEL_LIMITS
  }
  if (apiKey !== cached?.apiKey || cached.expires <= Date.now()) {
    const limits = fetchLimits(apiKey)
    cached = { apiKey, expires: Date.now() + TTL_MS, limits }
    void limits.catch(() => {
      if (cached?.limits === limits) {
        cached.expires = Date.now() + 30_000
      }
    })
  }
  return (await cached.limits.catch(() => undefined))?.get(model) ?? DEFAULT_MODEL_LIMITS
}
