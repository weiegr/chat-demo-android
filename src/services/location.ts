import { cityNames, regionCodes, regionNameOverrides, provinceNames } from './locationData.js'

export { regionCodes } from './locationData.js'

export const provinces = Object.entries(provinceNames).map(([code, name]) => ({
  code,
  name,
  cities: Object.entries(cityNames)
    .filter(([city]) => city.startsWith(code.slice(0, 2)))
    .map(([code, name]) => ({ code, name })),
}))

export type UserLocation = {
  region: string
  province?: string
  city?: string
}

const regions = new Set(regionCodes)
/** Intl.DisplayNames 需要 Chromium 81+，低版本 WebView 退回内置地区名表。 */
const createRegionNames = (locale: 'zh-CN' | 'en-US'): Intl.DisplayNames | null =>
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames([locale], { type: 'region' })
    : null

const regionNames = {
  'zh-CN': createRegionNames('zh-CN'),
  'en-US': createRegionNames('en-US'),
}

export const getRegionName = (code: string, locale: 'zh-CN' | 'en-US'): string =>
  regions.has(code)
    ? (regionNameOverrides[locale][code] ?? regionNames[locale]?.of(code) ?? code)
    : ''

export const normalizeLocation = (value: unknown): UserLocation | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const location = value as Record<string, unknown>
  const { region, province, city } = location
  if (typeof region !== 'string' || !regions.has(region)) {
    return null
  }
  if (region !== 'CN') {
    return { region }
  }
  if (province === undefined) {
    return city === undefined ? { region } : null
  }
  const selectedProvince = provinces.find((item) => item.code === province)
  if (!selectedProvince) {
    return null
  }
  if (city === undefined) {
    return { region, province: selectedProvince.code }
  }
  const selectedCity = selectedProvince.cities.find((item) => item.code === city)
  return selectedCity ? { region, province: selectedProvince.code, city: selectedCity.code } : null
}
