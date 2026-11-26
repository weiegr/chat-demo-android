import { API_ORIGIN, ApiError, request } from './client.js'

/** 账户余额中的单币种条目，金额保留接口返回的十进制字符串，避免浮点误差。 */
export type BalanceEntry = {
  currency: string
  total: string
  granted: string
  toppedUp: string
}

export type AccountBalance = {
  /** 当前账户是否有余额可供 API 调用 */
  available: boolean
  entries: BalanceEntry[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** 接口文档写的是字符串，这里也兼容数字，避免网关改写类型时整次查询失败。 */
const readAmount = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim()
  }
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

/**
 * 查询 API Key 的账户余额（GET /user/balance）。
 * 与 /models 一样使用 Bearer 鉴权；响应字段全部按字符串处理，由调用方决定展示精度。
 */
export const fetchAccountBalance = async (
  apiKey: string,
  signal?: AbortSignal
): Promise<AccountBalance> => {
  const response = await request(`${API_ORIGIN}/user/balance`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
  const body: unknown = await response.json().catch(() => null)
  if (
    !isRecord(body) ||
    typeof body.is_available !== 'boolean' ||
    !Array.isArray(body.balance_infos)
  ) {
    throw new ApiError('protocol', 'Malformed balance response')
  }
  const entries = body.balance_infos.flatMap((item): BalanceEntry[] => {
    if (!isRecord(item)) {
      return []
    }
    const currency = readString(item.currency)
    const total = readAmount(item.total_balance)
    if (!currency || !total) {
      return []
    }
    return [
      {
        currency,
        total,
        granted: readAmount(item.granted_balance),
        toppedUp: readAmount(item.topped_up_balance),
      },
    ]
  })
  if (entries.length === 0) {
    throw new ApiError('protocol', 'Balance response has no entries')
  }
  return { available: body.is_available, entries }
}

const currencySymbol = (currency: string) => {
  switch (currency.toUpperCase()) {
    case 'CNY':
      return '¥'
    case 'USD':
      return '$'
    default:
      return `${currency} `
  }
}

/** 时间线摘要：多币种时用「 / 」连接，例如「¥110.00 / $2.50」。 */
export const formatBalanceSummary = (balance: AccountBalance): string =>
  balance.entries
    .map((entry) => `${currencySymbol(entry.currency)}${entry.total}`)
    .join(' / ')
