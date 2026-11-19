import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  DEFAULT_IMAGE_SEARCH_TOOL_PROMPT,
  DEFAULT_LOCATION_TOOL_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  setImageSearchToolPrompt,
  setLocationToolPrompt,
  setSystemPrompt,
  setToolPromptsEnabled,
  useSettings,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconChevronRightOutline14 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { Switch } from '../base/Switch.js'
import { usePresence } from '../base/usePresence.js'
import { InfoModalButton } from './InfoModalButton.js'
import { MobileActionCard } from './MobileActionCard.js'
import styles from './Settings.module.css'

type PromptTarget = 'system' | 'imageSearch' | 'location'

type ToolPromptTarget = Exclude<PromptTarget, 'system'>

const PROMPT_TARGET_CONFIG: Record<
  PromptTarget,
  {
    titleKey: TranslationKey
    descKey: TranslationKey
    placeholderKey: TranslationKey
    defaultValue: string
    read: () => string
    save: (value: string) => void
  }
> = {
  system: {
    titleKey: 'settingsSystemPrompt',
    descKey: 'settingsSystemPromptDescription',
    placeholderKey: 'settingsSystemPromptPlaceholder',
    defaultValue: DEFAULT_SYSTEM_PROMPT,
    read: () => useSettings.getState().systemPrompt,
    save: setSystemPrompt,
  },
  imageSearch: {
    titleKey: 'settingsToolPromptSearchImage',
    descKey: 'settingsToolPromptSearchImageDesc',
    placeholderKey: 'settingsToolPromptPlaceholder',
    defaultValue: DEFAULT_IMAGE_SEARCH_TOOL_PROMPT,
    read: () => useSettings.getState().imageSearchToolPrompt,
    save: setImageSearchToolPrompt,
  },
  location: {
    titleKey: 'settingsToolPromptLocation',
    descKey: 'settingsToolPromptLocationDesc',
    placeholderKey: 'settingsToolPromptPlaceholder',
    defaultValue: DEFAULT_LOCATION_TOOL_PROMPT,
    read: () => useSettings.getState().locationToolPrompt,
    save: setLocationToolPrompt,
  },
}

const TOOL_PROMPT_TARGETS: ToolPromptTarget[] = ['imageSearch', 'location']

/** 二级提示词编辑弹窗/底部抽屉：供系统提示词与各工具提示词共用 */
const PromptEditorModal = ({
  target,
  onClose,
}: {
  target: PromptTarget | null
  onClose: () => void
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()

  const lastTargetRef = useRef<PromptTarget>('system')
  if (target) {
    lastTargetRef.current = target
  }
  const activeTarget = target ?? lastTargetRef.current
  const config = PROMPT_TARGET_CONFIG[activeTarget]

  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (target) {
      setDraft(PROMPT_TARGET_CONFIG[target].read())
    }
  }, [target])

  const sheetPresence = usePresence(target !== null && isMobile, 280)
  const isDefault = draft === config.defaultValue

  const saveAndClose = () => {
    config.save(draft)
    onClose()
  }

  const editorBody = (
    <div className={styles.promptEditorBody}>
      <textarea
        aria-label={t(config.titleKey)}
        className={clsx(styles.urlInput, styles.promptTextarea)}
        placeholder={t(config.placeholderKey)}
        rows={6}
        spellCheck={false}
        // 移动端不自动聚焦：抽屉滑入与软键盘同时进行会整段掉帧，交给用户点
        autoFocus={!isMobile}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className={styles.promptEditorFooterMeta}>
        <button
          type="button"
          className={styles.promptResetButton}
          disabled={isDefault}
          onClick={() => setDraft(config.defaultValue)}
        >
          {t('settingsResetDefault')}
        </button>
      </div>
    </div>
  )

  if (isMobile) {
    if (!sheetPresence.mounted) {
      return null
    }
    return (
      <Modal
        title={t(config.titleKey)}
        closable
        visible={sheetPresence.visible}
        className={clsx(styles.urlSheet, sheetPresence.visible && styles.sheetVisible)}
        mainClassName={styles.urlSheetMain}
        onClose={onClose}
      >
        <div className={styles.promptStage}>{editorBody}</div>
        <button type="button" className={styles.ttsSheetConfirm} onClick={saveAndClose}>
          {t('confirm')}
        </button>
      </Modal>
    )
  }

  if (!target) {
    return null
  }

  return (
    <Modal
      title={t(config.titleKey)}
      className={styles.promptModal}
      onClose={onClose}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" size="m" onClick={saveAndClose}>
            {t('confirm')}
          </Button>
        </>
      }
    >
      {editorBody}
    </Modal>
  )
}

/** 移动端设置主页的「系统提示词」入口行 */
export const MobileSystemPromptNavRow = ({ onOpen }: { onOpen: () => void }) => {
  const t = useTranslate()
  return (
    <button type="button" className={styles.mobileNavRow} onClick={onOpen}>
      <span className={styles.label}>{t('settingsSystemPrompt')}</span>
      <span className={styles.mobileNavRight}>
        <IconChevronRightOutline14 />
      </span>
    </button>
  )
}

/** 移动端独立的「系统提示词」子页面：顶部系统提示词单卡 + 下方高级设置工具提示词折叠卡片 */
export const MobileSystemPromptPage = () => {
  const t = useTranslate()
  const toolPromptsEnabled = useSettings((state) => state.toolPromptsEnabled)
  const [editorTarget, setEditorTarget] = useState<PromptTarget | null>(null)

  return (
    <>
      <div className={clsx(styles.content, styles.mobileDataContent)}>
        <MobileActionCard
          label={t('settingsSystemPrompt')}
          description={t('settingsSystemPromptDescription')}
          right={
            <span className={styles.mobileNavRight}>
              <IconChevronRightOutline14 />
            </span>
          }
          onAction={() => setEditorTarget('system')}
        />

        <div className={styles.mobileCard}>
          <div
            className={clsx(
              styles.cell,
              styles.locationSwitchCell,
              toolPromptsEnabled && styles.locationSwitchCellOpen
            )}
          >
            <div className={styles.switchHeader}>
              <div className={styles.labelRow}>
                <span className={styles.label}>{t('settingsAdvanced')}</span>
                <InfoModalButton
                  ariaLabel={t('settingsAdvanced')}
                  description={t('settingsAdvancedDescription')}
                />
              </div>
              <Switch
                checked={toolPromptsEnabled}
                ariaLabel={t('settingsAdvanced')}
                onChange={setToolPromptsEnabled}
              />
            </div>
            <div
              className={clsx(
                styles.locationCollapse,
                toolPromptsEnabled && styles.locationCollapseOpen
              )}
              aria-hidden={!toolPromptsEnabled}
            >
              <div className={styles.locationCollapseClip}>
                <div className={styles.advancedToolList}>
                  {TOOL_PROMPT_TARGETS.map((item) => {
                    const cfg = PROMPT_TARGET_CONFIG[item]
                    return (
                      <MobileActionCard
                        key={item}
                        embedded
                        label={t(cfg.titleKey)}
                        description={t(cfg.descKey)}
                        right={
                          <span className={styles.mobileNavRight}>
                            <IconChevronRightOutline14 />
                          </span>
                        }
                        onAction={() => setEditorTarget(item)}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <PromptEditorModal target={editorTarget} onClose={() => setEditorTarget(null)} />
    </>
  )
}

/** 桌面端「系统提示词」与「高级设置」工具提示词入口 */
export const SystemPromptSetting = () => {
  const t = useTranslate()
  const toolPromptsEnabled = useSettings((state) => state.toolPromptsEnabled)
  const [editorTarget, setEditorTarget] = useState<PromptTarget | null>(null)

  return (
    <>
      <div className={clsx(styles.cell, styles.row)}>
        <div className={styles.text}>
          <div className={styles.labelRow}>
            <span className={styles.label}>{t('settingsSystemPrompt')}</span>
            <InfoModalButton
              ariaLabel={t('settingsSystemPrompt')}
              description={t('settingsSystemPromptDescription')}
            />
          </div>
        </div>
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          onClick={() => setEditorTarget('system')}
        >
          {t('settingsEditAction')}
        </Button>
      </div>

      <div className={clsx(styles.cell, styles.locationSwitchCell)}>
        <div className={styles.switchHeader}>
          <div className={styles.labelRow}>
            <span className={styles.label}>{t('settingsAdvanced')}</span>
            <InfoModalButton
              ariaLabel={t('settingsAdvanced')}
              description={t('settingsAdvancedDescription')}
            />
          </div>
          <Switch
            checked={toolPromptsEnabled}
            ariaLabel={t('settingsAdvanced')}
            onChange={setToolPromptsEnabled}
          />
        </div>
        <div
          className={clsx(
            styles.locationCollapse,
            toolPromptsEnabled && styles.locationCollapseOpen
          )}
          aria-hidden={!toolPromptsEnabled}
        >
          <div className={styles.locationCollapseClip}>
            <div className={styles.desktopToolList}>
              {TOOL_PROMPT_TARGETS.map((item) => {
                const cfg = PROMPT_TARGET_CONFIG[item]
                return (
                  <div key={item} className={clsx(styles.cell, styles.row)}>
                    <div className={styles.text}>
                      <div className={styles.labelRow}>
                        <span className={styles.label}>{t(cfg.titleKey)}</span>
                        <InfoModalButton ariaLabel={t(cfg.titleKey)} description={t(cfg.descKey)} />
                      </div>
                    </div>
                    <Button
                      variant="outlined"
                      size="m"
                      className={styles.cellButton}
                      onClick={() => setEditorTarget(item)}
                    >
                      {t('settingsEditAction')}
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <PromptEditorModal target={editorTarget} onClose={() => setEditorTarget(null)} />
    </>
  )
}
