import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronRightOutline14,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconRightUpOutline14,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  canOpenExportFolder,
  clearHistory,
  exportAndSaveHistory,
  getLastExportRecord,
  importHistory,
  importHistoryFromUrl,
  openExportFolder,
  parseArchiveDownloadUrl,
  type ExportRecord,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  setAutoReadAloud,
  setAllowVideoUpload,
  setLocale,
  setThemePreference,
  setTtsVoice,
  useSettings,
  type Locale,
  type ThemePreference,
} from '../../services/settings.js'
import type { TtsVoice } from '../../services/api/speech.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { showToast } from '../base/toastState.js'
import { usePresence } from '../base/usePresence.js'
import { ApiKeySetting } from './ApiKeyField.js'
import { InfoModalButton } from './InfoModalButton.js'
import {
  AiLocationSetting,
  LocationSetting,
  MobileLocationNavRow,
  MobileLocationPage,
} from './LocationSettings.js'
import { MobileActionCard } from './MobileActionCard.js'
import { MobileRpModeNavRow, MobileRpModePage, RpModeSetting } from './RpModeSettings.js'
import {
  MobileSystemPromptNavRow,
  MobileSystemPromptPage,
  SystemPromptSetting,
} from './SystemPromptSettings.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  const [mobilePage, setMobilePage] = useState<
    'main' | 'data' | 'location' | 'systemPrompt' | 'rpMode'
  >('main')
  // 切换分组不丢失导入状态
  const historyImport = useHistoryImport()
  const historyUrlImport = useHistoryUrlImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy =
    historyImport.busy || historyUrlImport.busy || historyDelete.busy || replacingHistory
  const inMobileSubPage = isMobile && mobilePage !== 'main'
  const mobileTitleKey: TranslationKey =
    mobilePage === 'data'
      ? 'settingDialogAsideDataOptionLabel'
      : mobilePage === 'location'
        ? 'settingsLocation'
        : mobilePage === 'systemPrompt'
          ? 'settingsSystemPrompt'
          : mobilePage === 'rpMode'
            ? 'settingsRpMode'
            : 'settings'
  return (
    <>
      <Modal
        title={
          isMobile ? (
            <div className={styles.mobileSubHeader}>
              <button
                type="button"
                className={styles.mobileBackButton}
                aria-label={t('close')}
                onClick={() => {
                  if (inMobileSubPage) {
                    setMobilePage('main')
                  } else if (!historyDelete.busy) {
                    closeSettings()
                  }
                }}
              >
                <IconChevronRightOutline14 />
              </button>
              <span>{t(mobileTitleKey)}</span>
            </div>
          ) : (
            t('settings')
          )
        }
        closable={!isMobile}
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (historyDelete.busy) {
            return
          }
          if (inMobileSubPage) {
            setMobilePage('main')
            return
          }
          closeSettings()
        }}
      >
        {isMobile ? (
          mobilePage === 'data' ? (
            <div className={clsx(styles.content, styles.mobileDataContent)}>
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ImportHistoryFromUrl urlImport={historyUrlImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <MobileActionCard
                danger
                label={t('deleteAllSessions')}
                disabled={historyBusy}
                onAction={historyDelete.open}
              />
            </div>
          ) : mobilePage === 'location' ? (
            <MobileLocationPage />
          ) : mobilePage === 'systemPrompt' ? (
            <MobileSystemPromptPage />
          ) : mobilePage === 'rpMode' ? (
            <MobileRpModePage />
          ) : (
            <div className={styles.content}>
              <div className={styles.mobileGroupTitle}>
                {t('settingDialogAsideDataOptionLabel')}
              </div>
              <div className={styles.mobileCard}>
                <ApiKeySetting />
                <button
                  type="button"
                  className={styles.mobileNavRow}
                  onClick={() => setMobilePage('data')}
                >
                  <span className={styles.label}>{t('settingDialogAsideDataOptionLabel')}</span>
                  <span className={styles.mobileNavRight}>
                    <IconChevronRightOutline14 />
                  </span>
                </button>
              </div>
              <div className={styles.mobileGroupTitle}>{t('settingGroupApp')}</div>
              <div className={styles.mobileCard}>
                <MobileLocaleSetting />
                <MobileThemeSetting />
                <MobileLocationNavRow onOpen={() => setMobilePage('location')} />
              </div>
              <div className={styles.mobileGroupTitle}>{t('settingGroupChat')}</div>
              <div className={styles.mobileCard}>
                <MobileSystemPromptNavRow onOpen={() => setMobilePage('systemPrompt')} />
                <MobileTtsVoiceSetting />
                <MobileAutoReadAloudSetting />
                <MobileRpModeNavRow onOpen={() => setMobilePage('rpMode')} />
              </div>
              {__BETA__ ? <BetaSettings isMobile /> : null}
            </div>
          )
        ) : (
          <>
            <div role="tablist" className={styles.navigation}>
              {sections.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={section === item.value}
                  className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
                  onClick={() => setSection(item.value)}
                >
                  {item.icon}
                  {t(item.label)}
                </button>
              ))}
            </div>
            <div role="tabpanel" className={styles.content}>
              {section === 'general' ? (
                <>
                  <ThemeSetting />
                  <LocaleSetting />
                  <TtsVoiceSetting />
                  <AutoReadAloudSetting />
                  <LocationSetting />
                  <AiLocationSetting />
                  <SystemPromptSetting />
                  <RpModeSetting />
                  {__BETA__ ? <BetaSettings /> : null}
                </>
              ) : (
                <>
                  <ApiKeySetting />
                  <ImportHistory historyImport={historyImport} disabled={historyBusy} />
                  <ImportHistoryFromUrl urlImport={historyUrlImport} disabled={historyBusy} />
                  <ExportHistory disabled={historyBusy} />
                  <SettingCell
                    label={t('deleteAllSessions')}
                    status={null}
                    action={
                      <Button
                        variant="dangerOutlined"
                        size="m"
                        className={styles.cellButton}
                        disabled={historyBusy}
                        onClick={historyDelete.open}
                      >
                        {t('delete')}
                      </Button>
                    }
                  />
                </>
              )}
            </div>
          </>
        )}
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      <UrlImportDialog urlImport={historyUrlImport} />
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

const mobileTtsVoices: {
  value: TtsVoice
  nameKey: TranslationKey
  descKey: TranslationKey
}[] = [
  {
    value: 'stella',
    nameKey: 'settingsTtsVoiceStellaName',
    descKey: 'settingsTtsVoiceStellaDesc',
  },
  {
    value: 'tide',
    nameKey: 'settingsTtsVoiceTideName',
    descKey: 'settingsTtsVoiceTideDesc',
  },
]

/** 移动端朗读音色：点击弹出底部圆角抽屉，支持左右滑动与点击圆点切换，切换时标题与说明随方向平滑移动 */
const MobileTtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetPresence = usePresence(sheetOpen, 280)
  const [draftVoice, setDraftVoice] = useState<TtsVoice>(ttsVoice)
  const [voiceTransition, setVoiceTransition] = useState<{
    prev: TtsVoice | null
    dir: 'next' | 'prev'
    tick: number
  }>({ prev: null, dir: 'next', tick: 0 })
  const touchStartX = useRef<number | null>(null)
  const currentVoice = mobileTtsVoices.find((item) => item.value === ttsVoice) ?? mobileTtsVoices[0]
  const draftIndex = Math.max(
    0,
    mobileTtsVoices.findIndex((item) => item.value === draftVoice)
  )
  const activeDraft = mobileTtsVoices[draftIndex] ?? mobileTtsVoices[0]
  const exitingDraft = voiceTransition.prev
    ? mobileTtsVoices.find((item) => item.value === voiceTransition.prev)
    : undefined

  const switchDraftVoice = (nextVoice: TtsVoice, dir: 'next' | 'prev') => {
    if (nextVoice === draftVoice) {
      return
    }
    setVoiceTransition((cur) => ({ prev: draftVoice, dir, tick: cur.tick + 1 }))
    setDraftVoice(nextVoice)
  }

  return (
    <>
      <button
        type="button"
        className={styles.mobileNavRow}
        onClick={() => {
          setDraftVoice(ttsVoice)
          setVoiceTransition({ prev: null, dir: 'next', tick: 0 })
          setSheetOpen(true)
        }}
      >
        <span className={styles.label}>{t('settingsTtsVoice')}</span>
        <span className={styles.mobileNavRight}>
          <span className={styles.mobileNavValue}>{t(currentVoice.nameKey)}</span>
          <IconChevronRightOutline14 />
        </span>
      </button>
      {sheetPresence.mounted ? (
        <Modal
          title={t('settingsTtsVoice')}
          closable
          visible={sheetPresence.visible}
          className={clsx(styles.ttsSheet, sheetPresence.visible && styles.sheetVisible)}
          mainClassName={styles.ttsSheetMain}
          onClose={() => setSheetOpen(false)}
        >
          <div
            className={styles.ttsStage}
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? null
            }}
            onTouchEnd={(event) => {
              const startX = touchStartX.current
              touchStartX.current = null
              const endX = event.changedTouches[0]?.clientX
              if (startX === null || endX === undefined) {
                return
              }
              const dx = endX - startX
              if (Math.abs(dx) > 36) {
                const dir = dx < 0 ? 'next' : 'prev'
                const nextIndex =
                  dx < 0
                    ? (draftIndex + 1) % mobileTtsVoices.length
                    : (draftIndex - 1 + mobileTtsVoices.length) % mobileTtsVoices.length
                const next = mobileTtsVoices[nextIndex]
                if (next) {
                  switchDraftVoice(next.value, dir)
                }
              }
            }}
          >
            <div className={styles.ttsVoiceViewport}>
              {exitingDraft ? (
                <div
                  key={`out-${exitingDraft.value}-${voiceTransition.tick}`}
                  aria-hidden="true"
                  className={clsx(
                    styles.ttsVoiceSlide,
                    voiceTransition.dir === 'next' ? styles.ttsExitNext : styles.ttsExitPrev
                  )}
                  onAnimationEnd={() =>
                    setVoiceTransition((cur) =>
                      cur.tick === voiceTransition.tick ? { ...cur, prev: null } : cur
                    )
                  }
                >
                  <div className={styles.ttsVoiceName}>{t(exitingDraft.nameKey)}</div>
                  <div className={styles.ttsVoiceDesc}>{t(exitingDraft.descKey)}</div>
                </div>
              ) : null}
              <div
                key={`in-${activeDraft.value}-${voiceTransition.tick}`}
                className={clsx(
                  styles.ttsVoiceSlide,
                  voiceTransition.tick > 0 &&
                    (voiceTransition.dir === 'next' ? styles.ttsEnterNext : styles.ttsEnterPrev)
                )}
              >
                <div className={styles.ttsVoiceName}>{t(activeDraft.nameKey)}</div>
                <div className={styles.ttsVoiceDesc}>{t(activeDraft.descKey)}</div>
              </div>
            </div>
            <div role="tablist" aria-label={t('settingsTtsVoice')} className={styles.ttsDots}>
              {mobileTtsVoices.map((item, idx) => {
                const selected = item.value === draftVoice
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-label={t(item.nameKey)}
                    className={clsx(styles.ttsDot, selected && styles.ttsDotActive)}
                    onClick={() =>
                      switchDraftVoice(item.value, idx >= draftIndex ? 'next' : 'prev')
                    }
                  />
                )
              })}
            </div>
          </div>
          <button
            type="button"
            className={styles.ttsSheetConfirm}
            onClick={() => {
              setTtsVoice(draftVoice)
              setSheetOpen(false)
            }}
          >
            {t('confirm')}
          </button>
        </Modal>
      ) : null}
    </>
  )
}

/** 移动端自动朗读：开关行，置于朗读音色下方 */
const MobileAutoReadAloudSetting = () => {
  const t = useTranslate()
  const autoReadAloud = useSettings((state) => state.autoReadAloud)
  return (
    <div className={styles.mobileNavRow}>
      <span className={styles.label}>{t('settingsAutoReadAloud')}</span>
      <Switch
        checked={autoReadAloud}
        ariaLabel={t('settingsAutoReadAloud')}
        onChange={setAutoReadAloud}
      />
    </div>
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 自动朗读：回答完成后自动朗读回复内容 */
const AutoReadAloudSetting = () => {
  const t = useTranslate()
  const autoReadAloud = useSettings((state) => state.autoReadAloud)
  return (
    <SettingCell
      label={t('settingsAutoReadAloud')}
      description={t('settingsAutoReadAloudDesc')}
      status={null}
      action={
        <Switch
          checked={autoReadAloud}
          ariaLabel={t('settingsAutoReadAloud')}
          onChange={setAutoReadAloud}
        />
      }
    />
  )
}

const BetaSettings = ({ isMobile = false }: { isMobile?: boolean }) => {
  const t = useTranslate()
  const allowVideoUpload = useSettings((state) => state.allowVideoUpload)
  const label = t('settingsAllowVideoUpload')
  return (
    <section aria-label="beta">
      <div className={isMobile ? styles.mobileGroupTitle : styles.betaGroupTitle}>beta</div>
      <div className={isMobile ? styles.mobileCard : undefined}>
        <div className={clsx(styles.cell, styles.switchHeader)}>
          <div className={styles.labelRow}>
            <span className={styles.label}>{label}</span>
            <InfoModalButton
              ariaLabel={t('videoQuickModeOnly')}
              description={t('videoQuickModeOnly')}
            />
          </div>
          <Switch checked={allowVideoUpload} ariaLabel={label} onChange={setAllowVideoUpload} />
        </div>
      </div>
    </section>
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

const mobileLocaleOptions: { value: Locale; label: TranslationKey; lang: string }[] = [
  { value: 'zh-CN', label: 'settingsLocaleZhCN', lang: 'zh-CN' },
  { value: 'en-US', label: 'settingsLocaleEnUS', lang: 'en' },
]

const mobileThemeOptions: { value: ThemePreference; label: TranslationKey }[] = [
  { value: 'system', label: 'avatarMenuSettingsDialogThemeSelectSystemOption' },
  { value: 'light', label: 'avatarMenuSettingsDialogThemeSelectLightOption' },
  { value: 'dark', label: 'avatarMenuSettingsDialogThemeSelectDarkOption' },
]

/** 移动端单选设置项：点击行弹出居中单选确认框，供语言与主题共用 */
function MobileRadioSetting<T extends string>({
  title,
  value,
  options,
  onConfirm,
}: {
  title: string
  value: T
  options: { value: T; label: TranslationKey; lang?: string }[]
  onConfirm: (next: T) => void
}) {
  const t = useTranslate()
  const [modalOpen, setModalOpen] = useState(false)
  const [draft, setDraft] = useState<T>(value)
  const currentOption = options.find((item) => item.value === value) ?? options[0]

  return (
    <>
      <button
        type="button"
        className={styles.mobileNavRow}
        onClick={() => {
          setDraft(value)
          setModalOpen(true)
        }}
      >
        <span className={styles.label}>{title}</span>
        <span className={styles.mobileNavRight}>
          <span className={styles.mobileNavValue} lang={currentOption?.lang}>
            {currentOption ? t(currentOption.label) : ''}
          </span>
          <IconChevronRightOutline14 />
        </span>
      </button>
      {modalOpen ? (
        <Modal title={title} className={styles.themeModal} onClose={() => setModalOpen(false)}>
          <div role="radiogroup" aria-label={title} className={styles.themeRadioList}>
            {options.map((option) => {
              const checked = draft === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  lang={option.lang}
                  className={styles.themeRadioRow}
                  onClick={() => setDraft(option.value)}
                >
                  <span
                    className={clsx(styles.radioCircle, checked && styles.radioCircleChecked)}
                  />
                  <span className={styles.themeRadioLabel}>{t(option.label)}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className={styles.themeModalConfirm}
            onClick={() => {
              onConfirm(draft)
              setModalOpen(false)
            }}
          >
            {t('confirm')}
          </button>
        </Modal>
      ) : null}
    </>
  )
}

/** 移动端语言设置：左侧标题，右侧当前语言 + 箭头，点击弹出单选确认框 */
const MobileLocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <MobileRadioSetting
      title={t('settingsLocalePreference')}
      value={locale}
      options={mobileLocaleOptions}
      onConfirm={setLocale}
    />
  )
}

/** 移动端外观设置：左侧标题，右侧当前值 + 箭头，点击弹出单选确认框 */
const MobileThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  return (
    <MobileRadioSetting
      title={t('avatarMenuSettingsDialogThemeItemLabel')}
      value={themePreference}
      options={mobileThemeOptions}
      onConfirm={setThemePreference}
    />
  )
}

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  infoAsModal = false,
  status,
  statusAction,
  action,
  className,
}: {
  label: string
  description?: ReactNode
  infoAsModal?: boolean
  status: Status
  statusAction?: ReactNode
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  const inlineDescription = infoAsModal ? undefined : description
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{label}</span>
          {infoAsModal && description ? (
            <InfoModalButton ariaLabel={label} description={description} />
          ) : null}
        </div>
        {status || inlineDescription ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status ? (
              <>
                <span>
                  {t(status.key, status.reason ? { message: t(status.reason) } : status.params)}
                </span>
                {statusAction}
              </>
            ) : (
              inlineDescription
            )}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const count = await importHistory(file)
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".zip,application/zip,application/x-zip-compressed"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) {
          historyImport.select(file)
        }
      }}
    />
  )

  if (isMobile) {
    const statusText = historyImport.status
      ? t(
          historyImport.status.key,
          historyImport.status.reason
            ? { message: t(historyImport.status.reason) }
            : historyImport.status.params
        )
      : null
    return (
      <MobileActionCard
        label={t('historyImport')}
        description={t('historyImportDescription')}
        statusText={statusText}
        statusError={historyImport.status?.error}
        disabled={disabled}
        onAction={() => inputRef.current?.click()}
      >
        {fileInput}
      </MobileActionCard>
    )
  }

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      infoAsModal
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          {fileInput}
        </>
      }
    />
  )
}

/** 通过粘贴 DeepSeek 历史导出下载链接直接下载并覆盖导入 */
const useHistoryUrlImport = () => {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const importing = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const openModal = () => {
    setUrl('')
    setOpen(true)
  }

  const closeModal = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setOpen(false)
  }

  const submit = async () => {
    if (importing.current) {
      return
    }
    try {
      parseArchiveDownloadUrl(url)
    } catch (error) {
      showToast(
        { key: error instanceof BackupError ? error.key : 'historyUrlInvalid' },
        { placement: 'center' }
      )
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    importing.current = true
    setBusy(true)
    try {
      const count = await importHistoryFromUrl(url, controller.signal)
      setOpen(false)
      setUrl('')
      showToast(
        {
          key: count === 1 ? 'historyImportedOne' : 'historyImported',
          params: { count },
        },
        { placement: 'center' }
      )
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }
      if (error instanceof BackupError) {
        showToast({ key: error.key, params: error.params }, { placement: 'center' })
      } else {
        showToast({ key: 'historyUrlDownloadFailed' }, { placement: 'center' })
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
      importing.current = false
      setBusy(false)
    }
  }

  return { open, url, setUrl, busy, openModal, closeModal, submit }
}

/** 从 DeepSeek 链接导入历史会话入口（数据管理卡片 / 桌面设置行） */
const ImportHistoryFromUrl = ({
  urlImport,
  disabled,
}: {
  urlImport: ReturnType<typeof useHistoryUrlImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <MobileActionCard
        label={t('historyImportFromUrl')}
        description={t('historyImportFromUrlDescription')}
        disabled={disabled}
        onAction={urlImport.openModal}
      />
    )
  }

  return (
    <SettingCell
      label={t('historyImportFromUrl')}
      description={t('historyImportFromUrlDescription')}
      infoAsModal
      status={null}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled}
          onClick={urlImport.openModal}
        >
          {t('historyImportFromUrlAction')}
        </Button>
      }
    />
  )
}

/** 填入 URL 菜单：移动端复用朗读音色底部圆角抽屉风格，桌面端使用居中弹窗 */
const UrlImportDialog = ({ urlImport }: { urlImport: ReturnType<typeof useHistoryUrlImport> }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const sheetPresence = usePresence(urlImport.open && isMobile, 280)

  const inputNode = (
    <textarea
      aria-label={t('historyUrlModalTitle')}
      className={styles.urlInput}
      placeholder={t('historyUrlPlaceholder')}
      rows={4}
      spellCheck={false}
      // 移动端不自动聚焦：抽屉滑入与软键盘同时进行会整段掉帧，交给用户点
      autoFocus={!isMobile}
      disabled={urlImport.busy}
      value={urlImport.url}
      onChange={(event) => urlImport.setUrl(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          void urlImport.submit()
        }
      }}
    />
  )

  if (isMobile) {
    if (!sheetPresence.mounted) {
      return null
    }
    return (
      <Modal
        title={t('historyUrlModalTitle')}
        closable
        visible={sheetPresence.visible}
        className={clsx(styles.urlSheet, sheetPresence.visible && styles.sheetVisible)}
        mainClassName={styles.urlSheetMain}
        onClose={urlImport.closeModal}
      >
        <div className={styles.urlStage}>{inputNode}</div>
        <button
          type="button"
          className={styles.ttsSheetConfirm}
          disabled={urlImport.busy}
          onClick={() => void urlImport.submit()}
        >
          {t(urlImport.busy ? 'historyUrlImporting' : 'confirm')}
        </button>
      </Modal>
    )
  }

  if (!urlImport.open) {
    return null
  }

  return (
    <Modal
      title={t('historyUrlModalTitle')}
      className={styles.urlModal}
      onClose={urlImport.closeModal}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={urlImport.closeModal}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            size="m"
            disabled={urlImport.busy}
            onClick={() => void urlImport.submit()}
          >
            {t(urlImport.busy ? 'historyUrlImporting' : 'confirm')}
          </Button>
        </>
      }
    >
      {inputNode}
    </Modal>
  )
}

const formatExportTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const exportRecordStatus = (record: ExportRecord | null): Status => {
  if (!record) {
    return null
  }
  const time = formatExportTime(record.exportedAt)
  if (record.isAndroid && record.path) {
    return {
      key: 'historyExportSuccessWithPath',
      params: { time, path: record.path },
    }
  }
  return {
    key: 'historyExportSuccessBrowser',
    params: { time, fileName: record.fileName },
  }
}

/** 将全部会话及图片导出为 ZIP 文件并下载；导出结果与路径展示在卡片/标题下方 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(() => exportRecordStatus(getLastExportRecord()))
  const actionDisabled = disabled || busy || empty

  const onExport = async () => {
    setBusy(true)
    setStatus({ key: 'historyExporting' })
    try {
      const record = await exportAndSaveHistory()
      setStatus(exportRecordStatus(record))
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  const showOpenFolder = status?.key === 'historyExportSuccessWithPath' && canOpenExportFolder()

  const onOpenFolder = () => {
    if (!openExportFolder()) {
      showToast({ key: 'historyExportOpenFolderFailed' }, { placement: 'center' })
    }
  }

  const openFolderLink = showOpenFolder ? (
    <>
      {' '}
      <button type="button" className={styles.inlineActionLink} onClick={onOpenFolder}>
        <span>{t('historyExportOpenFolder')}</span>
        <span className={styles.inlineActionIcon} aria-hidden="true">
          <IconRightUpOutline14 />
        </span>
      </button>
    </>
  ) : null

  if (isMobile) {
    const hintText = status
      ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
      : null

    return (
      <div className={styles.mobileActionGroup}>
        <MobileActionCard
          label={t('exportAllLabel')}
          description={t('historyExportDescription')}
          disabled={actionDisabled}
          onAction={() => void onExport()}
        />
        {hintText ? (
          <div className={clsx(styles.mobileCardHint, status?.error && styles.mobileCardHintError)}>
            <span>{hintText}</span>
            {openFolderLink}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      infoAsModal
      status={status}
      statusAction={openFolderLink}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={actionDisabled}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
