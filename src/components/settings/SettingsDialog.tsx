import clsx from 'clsx'
import { useRef, useState, type ReactNode } from 'react'
import {
  IconChevronRightOutline14,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  setLocale,
  setSystemPrompt,
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
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { InfoModalButton } from './InfoModalButton.js'
import {
  AiLocationSetting,
  LocationSetting,
  MobileLocationNavRow,
  MobileLocationPage,
} from './LocationSettings.js'
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
  const [mobilePage, setMobilePage] = useState<'main' | 'data' | 'location'>('main')
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  const inMobileSubPage = isMobile && mobilePage !== 'main'
  const mobileTitleKey =
    mobilePage === 'data'
      ? 'settingDialogAsideDataOptionLabel'
      : mobilePage === 'location'
        ? 'settingsLocation'
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
              <ExportHistory disabled={historyBusy} />
              <MobileActionCard
                danger
                label={t('deleteAllSessions')}
                status={null}
                disabled={historyBusy}
                onAction={historyDelete.open}
              />
            </div>
          ) : mobilePage === 'location' ? (
            <MobileLocationPage />
          ) : (
            <div className={styles.content}>
              <div className={styles.mobileGroupTitle}>
                {t('settingDialogAsideDataOptionLabel')}
              </div>
              <div className={styles.mobileCard}>
                <ApiKeyField editor={apiKeyEditor} />
                <ApiKeyConfirm editor={apiKeyEditor} />
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
                <SystemPromptSetting />
                <MobileTtsVoiceSetting />
              </div>
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
                  <LocationSetting />
                  <AiLocationSetting />
                  <SystemPromptSetting />
                </>
              ) : (
                <>
                  <ApiKeyField editor={apiKeyEditor} />
                  <ImportHistory historyImport={historyImport} disabled={historyBusy} />
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

/** 移动端朗读音色：点击弹出底部圆角抽屉，支持左右滑动与点击圆点切换，抛弃中央胶囊动画且不自动试听 */
const MobileTtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [draftVoice, setDraftVoice] = useState<TtsVoice>(ttsVoice)
  const touchStartX = useRef<number | null>(null)
  const currentVoice = mobileTtsVoices.find((item) => item.value === ttsVoice) ?? mobileTtsVoices[0]
  const draftIndex = Math.max(
    0,
    mobileTtsVoices.findIndex((item) => item.value === draftVoice)
  )
  const activeDraft = mobileTtsVoices[draftIndex] ?? mobileTtsVoices[0]

  return (
    <>
      <button
        type="button"
        className={styles.mobileNavRow}
        onClick={() => {
          setDraftVoice(ttsVoice)
          setSheetOpen(true)
        }}
      >
        <span className={styles.label}>{t('settingsTtsVoice')}</span>
        <span className={styles.mobileNavRight}>
          <span className={styles.mobileNavValue}>{t(currentVoice.nameKey)}</span>
          <IconChevronRightOutline14 />
        </span>
      </button>
      {sheetOpen ? (
        <Modal
          title={t('settingsTtsVoice')}
          closable
          className={styles.ttsSheet}
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
                const nextIndex =
                  dx < 0
                    ? (draftIndex + 1) % mobileTtsVoices.length
                    : (draftIndex - 1 + mobileTtsVoices.length) % mobileTtsVoices.length
                const next = mobileTtsVoices[nextIndex]
                if (next) {
                  setDraftVoice(next.value)
                }
              }
            }}
          >
            <div className={styles.ttsVoiceName}>{t(activeDraft.nameKey)}</div>
            <div className={styles.ttsVoiceDesc}>{t(activeDraft.descKey)}</div>
            <div role="tablist" aria-label={t('settingsTtsVoice')} className={styles.ttsDots}>
              {mobileTtsVoices.map((item) => {
                const selected = item.value === draftVoice
                return (
                  <button
                    key={item.value}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-label={t(item.nameKey)}
                    className={clsx(styles.ttsDot, selected && styles.ttsDotActive)}
                    onClick={() => setDraftVoice(item.value)}
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

/** 系统提示词：随每轮对话发给模型的自定义指令，与默认身份提示一起生效 */
const SystemPromptSetting = () => {
  const t = useTranslate()
  const systemPrompt = useSettings((state) => state.systemPrompt)
  return (
    <SettingCell
      label={t('settingsSystemPrompt')}
      description={t('settingsSystemPromptDescription')}
      status={null}
      className={styles.systemPromptCell}
      action={
        <textarea
          aria-label={t('settingsSystemPrompt')}
          className={styles.systemPromptInput}
          placeholder={t('settingsSystemPromptPlaceholder')}
          rows={3}
          spellCheck={false}
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
        />
      }
    />
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
  action,
  className,
}: {
  label: string
  description?: ReactNode
  infoAsModal?: boolean
  status: Status
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
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : inlineDescription}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 移动端数据管理单卡：整卡可点击触发动作，说明图标独立点击弹窗，避免交互按钮嵌套 */
const MobileActionCard = ({
  label,
  description,
  status,
  disabled,
  danger = false,
  onAction,
  children,
}: {
  label: string
  description?: string
  status: Status
  disabled: boolean
  danger?: boolean
  onAction: () => void
  children?: ReactNode
}) => {
  const t = useTranslate()

  return (
    <div className={styles.mobileActionCard}>
      <button
        type="button"
        className={styles.mobileActionHit}
        aria-label={label}
        disabled={disabled}
        onClick={onAction}
      />
      <div className={styles.mobileActionBody}>
        <div className={styles.labelRow}>
          <span
            className={clsx(
              styles.label,
              danger && styles.mobileActionDangerLabel,
              disabled && styles.mobileActionLabelDisabled
            )}
          >
            {label}
          </span>
          {description ? <InfoModalButton ariaLabel={label} description={description} /> : null}
        </div>
        {status ? (
          <div className={clsx(styles.description, status.error && styles.error)}>
            {t(status.key, status.reason ? { message: t(status.reason) } : status.params)}
          </div>
        ) : null}
      </div>
      {children}
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
    return (
      <MobileActionCard
        label={t('historyImport')}
        description={t('historyImportDescription')}
        status={historyImport.status}
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

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const actionDisabled = disabled || busy || empty

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  if (isMobile) {
    return (
      <MobileActionCard
        label={t('exportAllLabel')}
        description={t('historyExportDescription')}
        status={status}
        disabled={actionDisabled}
        onAction={() => void onExport()}
      />
    )
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      infoAsModal
      status={status}
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
