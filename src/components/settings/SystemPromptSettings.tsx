import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  DEFAULT_EXPERT_SYSTEM_PROMPT,
  DEFAULT_FAST_SYSTEM_PROMPT,
  DEFAULT_RP_SYSTEM_PROMPT,
  setExpertSystemPrompt,
  setFastSystemPrompt,
  setRpSystemPrompt,
  useSettings,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconChevronRightOutline14 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { usePresence } from '../base/usePresence.js'
import { InfoModalButton } from './InfoModalButton.js'
import { MobileActionCard } from './MobileActionCard.js'
import styles from './Settings.module.css'

export type PromptTarget = 'fastSystem' | 'expertSystem' | 'rpSystem'

type PromptConfig = {
  titleKey: TranslationKey
  descKey: TranslationKey
  defaultValue: string
  read: () => string
  save: (value: string) => void
}

const PROMPT_TARGET_CONFIG: Record<PromptTarget, PromptConfig> = {
  fastSystem: {
    titleKey: 'settingsFastSystemPrompt',
    descKey: 'settingsFastSystemPromptDesc',
    defaultValue: DEFAULT_FAST_SYSTEM_PROMPT,
    read: () => useSettings.getState().fastSystemPrompt,
    save: setFastSystemPrompt,
  },
  expertSystem: {
    titleKey: 'settingsExpertSystemPrompt',
    descKey: 'settingsExpertSystemPromptDesc',
    defaultValue: DEFAULT_EXPERT_SYSTEM_PROMPT,
    read: () => useSettings.getState().expertSystemPrompt,
    save: setExpertSystemPrompt,
  },
  rpSystem: {
    titleKey: 'settingsRpSystemPrompt',
    descKey: 'settingsRpSystemPromptDesc',
    defaultValue: DEFAULT_RP_SYSTEM_PROMPT,
    read: () => useSettings.getState().rpSystemPrompt,
    save: setRpSystemPrompt,
  },
}

/** 系统提示词页面维护的模式基础提示词（含快速、专家与 RP 模式） */
const MODE_PROMPT_TARGETS: PromptTarget[] = ['fastSystem', 'expertSystem', 'rpSystem']

/** 二级提示词编辑弹窗/底部抽屉：供快速模式、专家模式与 RP 模式提示词共用 */
export const PromptEditorModal = ({
  target,
  onClose,
}: {
  target: PromptTarget | null
  onClose: () => void
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()

  const lastTargetRef = useRef<PromptTarget>('fastSystem')
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
  const modalPresence = usePresence(target !== null && !isMobile, 220)
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
        placeholder={t('settingsSystemPromptPlaceholder')}
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

  if (!modalPresence.mounted) {
    return null
  }

  return (
    <Modal
      title={t(config.titleKey)}
      visible={modalPresence.visible}
      className={styles.promptModal}
      onClose={onClose}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" size="m" disabled={target === null} onClick={saveAndClose}>
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

/** 移动端独立的「系统提示词」子页面：展示快速、专家与 RP 模式基础提示词 */
export const MobileSystemPromptPage = () => {
  const t = useTranslate()
  const [editorTarget, setEditorTarget] = useState<PromptTarget | null>(null)

  return (
    <>
      <div className={clsx(styles.content, styles.mobileDataContent)}>
        {MODE_PROMPT_TARGETS.map((item) => {
          const cfg = PROMPT_TARGET_CONFIG[item]
          return (
            <MobileActionCard
              key={item}
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
      <PromptEditorModal target={editorTarget} onClose={() => setEditorTarget(null)} />
    </>
  )
}

/** 桌面端「系统提示词」：列出快速、专家与 RP 模式基础提示词 */
export const SystemPromptSetting = () => {
  const t = useTranslate()
  const [editorTarget, setEditorTarget] = useState<PromptTarget | null>(null)

  return (
    <>
      {MODE_PROMPT_TARGETS.map((item) => {
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

      <PromptEditorModal target={editorTarget} onClose={() => setEditorTarget(null)} />
    </>
  )
}
