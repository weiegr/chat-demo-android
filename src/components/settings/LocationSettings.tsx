import clsx from 'clsx'
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  getDeviceLocationPermissionLevel,
  openDeviceLocationSettings,
  requestPreciseLocationPermission,
  subscribeLocationPermissionChange,
  type LocationPermissionLevel,
} from '../../services/geolocation.js'
import {
  getRegionName,
  provinces,
  regionCodes,
  type UserLocation,
} from '../../services/location.js'
import {
  isChineseBrowser,
  setAllowAiLocation,
  setLocation,
  setLocationEnabled,
  useSettings,
} from '../../services/settings.js'
import { IconChevronRightOutline14 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { usePresence } from '../base/usePresence.js'
import { InfoModalButton } from './InfoModalButton.js'
import styles from './Settings.module.css'

const WHEEL_ITEM_HEIGHT = 44

/** 格式化已选择的地区名称（中文模式为省+市，非中文模式为国家/地区）；未选择时返回 null */
const formatSelectedArea = (
  location: UserLocation | null,
  locale: 'zh-CN' | 'en-US'
): string | null => {
  if (!location) {
    return null
  }
  if (isChineseBrowser() && location.region === 'CN') {
    const province = provinces.find((item) => item.code === location.province)
    const city = province?.cities.find((item) => item.code === location.city)
    if (province && city) {
      return province.name === city.name ? province.name : `${province.name} ${city.name}`
    }
    return province?.name ?? null
  }
  return getRegionName(location.region, locale) || null
}

/** 订阅并控制 AI 主动定位与 Android 精确位置授权升级 */
const useAiLocationPermission = (t: ReturnType<typeof useTranslate>) => {
  const allowAiLocation = useSettings((state) => state.allowAiLocation)
  const [permissionLevel, setPermissionLevel] = useState<LocationPermissionLevel>(() =>
    getDeviceLocationPermissionLevel()
  )

  useEffect(() => {
    setPermissionLevel(getDeviceLocationPermissionLevel())
    return subscribeLocationPermissionChange((detail) => {
      setPermissionLevel(detail.level)
    })
  }, [])

  const requestOrOpenSettings = async () => {
    const result = await requestPreciseLocationPermission()
    setPermissionLevel(result.level)
    if (result.blockedUpgrade && !result.fineGranted) {
      openDeviceLocationSettings()
    }
  }

  const permissionMissingFine =
    allowAiLocation && (permissionLevel === 'coarse' || permissionLevel === 'none')

  return {
    allowAiLocation,
    permissionLevel,
    permissionMissingFine,
    permissionActionLabel: permissionMissingFine
      ? t(
          permissionLevel === 'coarse'
            ? 'settingsAiLocationUpgradeAction'
            : 'settingsAiLocationGrantAction'
        )
      : undefined,
    requestOrOpenSettings,
    toggleAllowAiLocation: (next: boolean) => {
      setAllowAiLocation(next)
      if (next) {
        void requestOrOpenSettings()
      }
    },
  }
}

const getAiLocationDescriptionKey = (
  allowAiLocation: boolean,
  permissionLevel: LocationPermissionLevel,
  toolsReady: boolean
): TranslationKey => {
  if (!allowAiLocation) {
    return 'settingsAiLocationDescription'
  }
  if (permissionLevel === 'none') {
    return toolsReady
      ? 'settingsAiLocationDeniedDescription'
      : 'settingsAiLocationDeniedRequiresDescription'
  }
  if (permissionLevel === 'coarse') {
    return toolsReady
      ? 'settingsAiLocationCoarseDescription'
      : 'settingsAiLocationCoarseRequiresDescription'
  }
  return toolsReady ? 'settingsAiLocationDescription' : 'settingsAiLocationRequiresDescription'
}

/** 共用的 AI 主动请求真实位置开关行：标题 + 感叹号提示弹窗 + 蓝色开关 */
export const AiLocationSetting = () => {
  const t = useTranslate()
  const thinking = useSettings((state) => state.thinking)
  const search = useSettings((state) => state.search)
  const {
    allowAiLocation,
    permissionLevel,
    permissionMissingFine,
    permissionActionLabel,
    requestOrOpenSettings,
    toggleAllowAiLocation,
  } = useAiLocationPermission(t)
  // 与 requestTools 的声明条件保持一致，统一整合进弹窗主说明文案
  const descriptionKey = getAiLocationDescriptionKey(
    allowAiLocation,
    permissionLevel,
    thinking && search
  )

  return (
    <div className={clsx(styles.cell, styles.switchHeader)}>
      <div className={styles.labelRow}>
        <span className={styles.label}>{t('settingsAiLocation')}</span>
        <InfoModalButton
          ariaLabel={t('settingsAiLocation')}
          description={t(descriptionKey)}
          actionLabel={permissionActionLabel}
          onAction={() => void requestOrOpenSettings()}
          warning={permissionMissingFine}
        />
      </div>
      <Switch
        checked={allowAiLocation}
        ariaLabel={t('settingsAiLocation')}
        onChange={toggleAllowAiLocation}
      />
    </div>
  )
}

/** 移动端主设置卡片里的「位置信息」导航行，点击进入单独的位置信息页面 */
export const MobileLocationNavRow = ({ onOpen }: { onOpen: () => void }) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const locationEnabled = useSettings((state) => state.locationEnabled)
  const allowAiLocation = useSettings((state) => state.allowAiLocation)
  const area = locationEnabled ? formatSelectedArea(location, locale) : null
  const summary =
    area ??
    (locationEnabled
      ? t('settingsLocationStatusOn')
      : allowAiLocation
        ? t('settingsLocationStatusAi')
        : t('settingsLocationStatusOff'))

  return (
    <button type="button" className={styles.mobileNavRow} onClick={onOpen}>
      <span className={styles.label}>{t('settingsLocation')}</span>
      <span className={styles.mobileNavRight}>
        <span className={styles.mobileNavValue}>{summary}</span>
        <IconChevronRightOutline14 />
      </span>
    </button>
  )
}

/** 单列上下滑动滚轮选择器，基于 scroll-snap 吸附中心选中项并实时同步 */
const WheelColumn = ({
  items,
  value,
  ariaLabel,
  liveIndexRef,
  onChange,
}: {
  items: { value: string; label: string }[]
  value: string
  ariaLabel: string
  liveIndexRef: MutableRefObject<number>
  onChange: (value: string) => void
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemsSignature = items.map((item) => item.value).join(',')
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value)
  )
  const initialIndexRef = useRef(selectedIndex)
  initialIndexRef.current = selectedIndex
  const [activeIndex, setActiveIndex] = useState(selectedIndex)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || items.length === 0) {
      return
    }
    const clamped = Math.max(0, Math.min(items.length - 1, initialIndexRef.current))
    el.scrollTop = clamped * WHEEL_ITEM_HEIGHT
    liveIndexRef.current = clamped
    setActiveIndex(clamped)
  }, [itemsSignature, items.length, liveIndexRef])

  const commitIndex = (idx: number) => {
    const target = items[idx]
    if (target && target.value !== value) {
      onChange(target.value)
    }
  }

  const handleScroll = () => {
    const el = containerRef.current
    if (!el || items.length === 0) {
      return
    }
    const idx = Math.max(
      0,
      Math.min(items.length - 1, Math.round(el.scrollTop / WHEEL_ITEM_HEIGHT))
    )
    liveIndexRef.current = idx
    if (idx !== activeIndex) {
      setActiveIndex(idx)
    }
    commitIndex(idx)
  }

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={ariaLabel}
      className={styles.wheelColumn}
      onScroll={handleScroll}
    >
      <div className={styles.wheelSpacer} aria-hidden="true" />
      {items.map((item, idx) => {
        const active = idx === activeIndex
        return (
          <button
            key={item.value}
            type="button"
            role="option"
            aria-selected={active}
            className={clsx(styles.wheelOption, active && styles.wheelOptionActive)}
            onClick={() => {
              const el = containerRef.current
              if (el) {
                el.scrollTo({ top: idx * WHEEL_ITEM_HEIGHT, behavior: 'smooth' })
              }
            }}
          >
            <span className={styles.wheelOptionText}>{item.label}</span>
          </button>
        )
      })}
      <div className={styles.wheelSpacer} aria-hidden="true" />
    </div>
  )
}

/** 手动设置位置的二级弹出菜单：中文环境左列选省、右列选市；英文环境单列选国家/地区 */
const MobileLocationPickerModal = ({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const chineseMode = isChineseBrowser()

  const initialProvinceCode =
    (location?.region === 'CN' && location.province
      ? provinces.find((item) => item.code === location.province)?.code
      : undefined) ??
    provinces[0]?.code ??
    ''
  const initialProvince = provinces.find((item) => item.code === initialProvinceCode)
  const initialCityCode =
    (location?.city && initialProvince?.cities.some((item) => item.code === location.city)
      ? location.city
      : initialProvince?.cities[0]?.code) ?? ''

  const [draftProvince, setDraftProvince] = useState(initialProvinceCode)
  const [draftCity, setDraftCity] = useState(initialCityCode)

  const regionOptions = regionCodes
    .map((code) => ({ value: code, label: getRegionName(code, locale) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale))
  const initialRegion =
    (location?.region && regionOptions.some((item) => item.value === location.region)
      ? location.region
      : regionOptions[0]?.value) ?? ''
  const [draftRegion, setDraftRegion] = useState(initialRegion)

  const activeProvince = provinces.find((item) => item.code === draftProvince) ?? provinces[0]
  const provinceItems = provinces.map((item) => ({ value: item.code, label: item.name }))
  const cityItems =
    activeProvince?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []

  const provinceIndexRef = useRef(
    Math.max(
      0,
      provinceItems.findIndex((item) => item.value === draftProvince)
    )
  )
  const cityIndexRef = useRef(
    Math.max(
      0,
      cityItems.findIndex((item) => item.value === draftCity)
    )
  )
  const regionIndexRef = useRef(
    Math.max(
      0,
      regionOptions.findIndex((item) => item.value === draftRegion)
    )
  )

  const handleConfirm = () => {
    if (chineseMode) {
      const pickedProvince = provinces[provinceIndexRef.current] ?? activeProvince
      if (!pickedProvince) {
        onClose()
        return
      }
      // 若省份刚好在确认瞬间切换，取新省首个城市，否则取右列当前对齐城市
      const pickedCity =
        pickedProvince.code === draftProvince
          ? (pickedProvince.cities[cityIndexRef.current] ?? pickedProvince.cities[0])
          : pickedProvince.cities[0]
      setLocation(
        pickedCity
          ? { region: 'CN', province: pickedProvince.code, city: pickedCity.code }
          : { region: 'CN', province: pickedProvince.code }
      )
      setLocationEnabled(true)
      onClose()
      return
    }
    const pickedRegion = regionOptions[regionIndexRef.current]?.value ?? draftRegion
    if (pickedRegion) {
      setLocation({ region: pickedRegion })
      setLocationEnabled(true)
    }
    onClose()
  }

  return (
    <Modal
      title={t('settingsLocationManual')}
      closable
      visible={visible}
      className={clsx(styles.locationSheet, visible && styles.sheetVisible)}
      mainClassName={styles.locationSheetMain}
      onClose={onClose}
    >
      <div className={styles.wheelStage}>
        <div className={styles.wheelHighlight} aria-hidden="true" />
        {chineseMode ? (
          <div className={styles.wheelColumns}>
            <WheelColumn
              ariaLabel={t('settingsLocationProvince')}
              items={provinceItems}
              value={draftProvince}
              liveIndexRef={provinceIndexRef}
              onChange={(nextProvince) => {
                setDraftProvince(nextProvince)
                const nextObj = provinces.find((item) => item.code === nextProvince)
                const nextFirstCity = nextObj?.cities[0]?.code ?? ''
                cityIndexRef.current = 0
                setDraftCity(nextFirstCity)
              }}
            />
            {cityItems.length > 0 ? (
              <WheelColumn
                key={draftProvince}
                ariaLabel={t('settingsLocationCity')}
                items={cityItems}
                value={draftCity}
                liveIndexRef={cityIndexRef}
                onChange={setDraftCity}
              />
            ) : (
              <div className={styles.wheelEmpty}>{t('settingsLocationNoCity')}</div>
            )}
          </div>
        ) : (
          <div className={styles.wheelColumns}>
            <WheelColumn
              ariaLabel={t('settingsLocationRegion')}
              items={regionOptions}
              value={draftRegion}
              liveIndexRef={regionIndexRef}
              onChange={setDraftRegion}
            />
          </div>
        )}
      </div>
      <button type="button" className={styles.ttsSheetConfirm} onClick={handleConfirm}>
        {t('confirm')}
      </button>
    </Modal>
  )
}

/** 移动端独立的「位置信息」子页面：分为 AI 主动请求开关与手动设置两部分，小提示统一收入感叹号弹窗 */
export const MobileLocationPage = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const locationEnabled = useSettings((state) => state.locationEnabled)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerPresence = usePresence(pickerOpen, 280)

  return (
    <div className={clsx(styles.content, styles.mobileLocationContent)}>
      <div className={styles.mobileCard}>
        <AiLocationSetting />
      </div>

      <div className={styles.mobileCard}>
        <div
          className={clsx(
            styles.cell,
            styles.locationSwitchCell,
            locationEnabled && styles.locationSwitchCellOpen
          )}
        >
          <div className={styles.switchHeader}>
            <div className={styles.labelRow}>
              <span className={styles.label}>{t('settingsLocationManual')}</span>
              <InfoModalButton
                ariaLabel={t('settingsLocationManual')}
                description={t('settingsLocationManualDescription')}
              />
            </div>
            <Switch
              checked={locationEnabled}
              ariaLabel={t('settingsLocationManual')}
              onChange={(next) => {
                setLocationEnabled(next)
                if (next && !location) {
                  setPickerOpen(true)
                }
              }}
            />
          </div>
          <div
            className={clsx(
              styles.locationCollapse,
              locationEnabled && styles.locationCollapseOpen
            )}
            aria-hidden={!locationEnabled}
          >
            <div className={styles.locationCollapseClip}>
              <button
                type="button"
                className={clsx(styles.mobileNavRow, styles.mobileSubActionRow)}
                onClick={() => setPickerOpen(true)}
              >
                <span className={styles.label}>{t('settingsLocationArea')}</span>
                <span className={styles.mobileNavRight}>
                  <span className={styles.mobileNavValue}>
                    {formatSelectedArea(location, locale) ?? t('settingsLocationSelectHint')}
                  </span>
                  <IconChevronRightOutline14 />
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {pickerPresence.mounted ? (
        <MobileLocationPickerModal
          visible={pickerPresence.visible}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  )
}

/** 桌面端位置信息设置（下拉选择器 + 蓝色开关） */
export const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const locationEnabled = useSettings((state) => state.locationEnabled)
  const [provinceOpen, setProvinceOpen] = useState(false)
  const [cityOpen, setCityOpen] = useState(false)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined
  const showCitySelect = !province || province.cities.length > 0

  return (
    <div className={clsx(styles.cell, styles.locationSwitchCell)}>
      <div className={styles.switchHeader}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{t('settingsLocationManual')}</span>
          <InfoModalButton
            ariaLabel={t('settingsLocationManual')}
            description={t('settingsLocationManualDescription')}
          />
        </div>
        <Switch
          checked={locationEnabled}
          ariaLabel={t('settingsLocationManual')}
          onChange={(next) => {
            if (!next) {
              setProvinceOpen(false)
              setCityOpen(false)
            }
            setLocationEnabled(next)
          }}
        />
      </div>
      <div
        className={clsx(styles.locationCollapse, locationEnabled && styles.locationCollapseOpen)}
        aria-hidden={!locationEnabled}
      >
        <div className={styles.locationCollapseClip}>
          <div className={styles.locationSelectors}>
            {isChineseBrowser() ? (
              <>
                <Select
                  ariaLabel={t('settingsLocationProvince')}
                  className={styles.provinceSelect}
                  value={province?.code ?? ''}
                  open={locationEnabled && provinceOpen}
                  onOpenChange={setProvinceOpen}
                  placeholder={t('settingsLocationProvince')}
                  options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                  onChange={(value) => {
                    if (value !== province?.code) {
                      const nextProvince = provinces.find((item) => item.code === value)
                      const defaultCity = nextProvince?.cities[0]?.code
                      setLocation(
                        defaultCity
                          ? { region: 'CN', province: value, city: defaultCity }
                          : { region: 'CN', province: value }
                      )
                    }
                  }}
                />
                {showCitySelect ? (
                  <Select
                    ariaLabel={t('settingsLocationCity')}
                    className={styles.citySelect}
                    value={province ? (location?.city ?? '') : ''}
                    open={locationEnabled && province ? cityOpen : false}
                    onOpenChange={(next) => {
                      if (!province) {
                        if (next) {
                          setProvinceOpen(true)
                        }
                        return
                      }
                      setCityOpen(next)
                    }}
                    placeholder={t('settingsLocationCity')}
                    options={
                      province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                    }
                    onChange={(value) => {
                      if (province) {
                        setLocation({ region: 'CN', province: province.code, city: value })
                      }
                    }}
                  />
                ) : null}
              </>
            ) : (
              <Select
                ariaLabel={t('settingsLocationRegion')}
                className={styles.regionSelect}
                value={location?.region ?? ''}
                placeholder={t('settingsLocationRegion')}
                options={regionCodes
                  .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                  .sort((a, b) => a.label.localeCompare(b.label, locale))}
                onChange={(value) => setLocation({ region: value })}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
