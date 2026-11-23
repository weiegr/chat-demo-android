import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  DEFAULT_EXPERT_SYSTEM_PROMPT,
  DEFAULT_FAST_SYSTEM_PROMPT,
  DEFAULT_FAST_LIVE_PROMPT,
  DEFAULT_FAST_VIDEO_PROMPT,
  DEFAULT_LOCATION_TOOL_PROMPT,
  DEFAULT_READ_LINK_TOOL_PROMPT,
  DEFAULT_RP_SYSTEM_PROMPT,
  DEFAULT_SEARCH_TOOL_PROMPT,
  setExpertSystemPrompt,
  setFastLocationToolPrompt,
  setFastLivePrompt,
  setFastReadLinkToolPrompt,
  setFastSearchToolPrompt,
  setFastSystemPrompt,
  setFastVideoPrompt,
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

export type PromptTarget =
  | 'fastSystem'
  | 'fastVideo'
  | 'fastLive'
  | 'fastSearchTool'
  | 'fastReadLinkTool'
  | 'fastLocationTool'
  | 'expertSystem'
  | 'rpSystem'

type PromptConfig = {
  titleKey: TranslationKey
  descKey: TranslationKey
  placeholderKey: TranslationKey
  defaultValue: string
  read: () => string
  save: (value: string) => void
}

const PROMPT_TARGET_CONFIG: Record<PromptTarget, PromptConfig> = {
  fastSystem: {
    titleKey: 'settingsFastSystemPrompt',
    descKey: 'settingsFastSystemPromptDesc',
    placeholderKey: 'settingsSystemPromptPlaceholder',
    defaultValue: DEFAULT_FAST_SYSTEM_PROMPT,
    read: () => useSettings.getState().fastSystemPrompt,
    save: setFastSystemPrompt,
  },
  fastLive: {
    titleKey: 'settingsFastLivePrompt',
    descKey: 'settingsFastLivePromptDesc',
    placeholderKey: 'settingsSystemPromptPlaceholder',
    defaultValue: DEFAULT_FAST_LIVE_PROMPT,
    read: () => useSettings.getState().fastLivePrompt,
    save: setFastLivePrompt,
  },
  fastVideo: {
    titleKey: 'settingsFastVideoPrompt',
    descKey: 'settingsFastVideoPromptDesc',
    placeholderKey: 'settingsSystemPromptPlaceholder',
    defaultValue: DEFAULT_FAST_VIDEO_PROMPT,
    read: () => useSettings.getState().fastVideoPrompt,
    save: setFastVideoPrompt,
  },
  fastSearchTool: {
    titleKey: 'settingsFastSearchToolPrompt',
    descKey: 'settingsFastSearchToolPromptDesc',
    placeholderKey: 'settingsToolPromptPlaceholder',
    defaultValue: DEFAULT_SEARCH_TOOL_PROMPT,
    read: () => useSettings.getState().fastSearchToolPrompt,
    save: setFastSearchToolPrompt,
  },
  fastReadLinkTool: {
    titleKey: 'settingsFastReadLinkToolPrompt',
    descKey: 'settingsFastReadLinkToolPromptDesc',
    placeholderKey: 'settingsToolPromptPlaceholder',
    defaultValue: DEFAULT_READ_LINK_TOOL_PROMPT,
    read: () => useSettings.getState().fastReadLinkToolPrompt,
    save: setFastReadLinkToolPrompt,
  },
  fastLocationTool: {
    titleKey: 'settingsFastLocationToolPrompt',
    descKey: 'settingsFastLocationToolPromptDesc',
    placeholderKey: 'settingsToolPromptPlaceholder',
    defaultValue: DEFAULT_LOCATION_TOOL_PROMPT,
    read: () => useSettings.getState().fastLocationToolPrompt,
    save: setFastLocationToolPrompt,
  },
  expertSystem: {
    titleKey: 'settingsExpertSystemPrompt',
    descKey: 'settingsExpertSystemPromptDesc',
    placeholderKey: 'settingsSystemPromptPlaceholder',
    defaultValue: DEFAULT_EXPERT_SYSTEM_PROMPT,
    read: () => useSettings.getState().expertSystemPrompt,
    save: setExpertSystemPrompt,
  },
  rpSystem: {
    titleKey: 'settingsRpSystemPrompt',
    descKey: 'settingsRpSystemPromptDesc',
    placeholderKey: 'settingsSystemPromptPlaceholder',
    defaultValue: DEFAULT_RP_SYSTEM_PROMPT,
    read: () => useSettings.getState().rpSystemPrompt,
    save: setRpSystemPrompt,
  },
}

/** 系统提示词页面的两个模式分组：快速模式维护基础与工具提示词，专家模式只有基础提示词 */
const MODE_PROMPT_GROUPS: { main: PromptTarget; tools: PromptTarget[] }[] = [
  {
    main: 'fastSystem',
    tools: [
      'fastSearchTool',
      'fastReadLinkTool',
      'fastLocationTool',
      'fastVideo',
      'fastLive',
    ],
  },
  {
    main: 'expertSystem',
    // v4-pro 不声明任何服务端/客户端工具，工具提示词无请求侧用途
    tools: [],
  },
]

/** 二级提示词编辑弹窗/底部抽屉：供快速模式、专家模式、各工具及 RP 模式提示词共用 */
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

/** 移动端独立的「系统提示词」子页面：按快速模式、专家模式拆分为两张卡片，各自展示基础提示词与工具提示词 */
export const MobileSystemPromptPage = () => {
  const t = useTranslate()
  const [editorTarget, setEditorTarget] = useState<PromptTarget | null>(null)

  return (
    <>
      <div className={clsx(styles.content, styles.mobileDataContent)}>
        {MODE_PROMPT_GROUPS.map((group) => {
          const mainCfg = PROMPT_TARGET_CONFIG[group.main]
          return (
            <div key={group.main} className={styles.mobileCard}>
              <MobileActionCard
                embedded
                className={styles.modePromptMainRow}
                label={t(mainCfg.titleKey)}
                description={t(mainCfg.descKey)}
                right={
                  <span className={styles.mobileNavRight}>
                    <IconChevronRightOutline14 />
                  </span>
                }
                onAction={() => setEditorTarget(group.main)}
              />
              {group.tools.length > 0 ? (
                <div className={styles.modePromptSubList}>
                  {group.tools.map((item) => {
                    const cfg = PROMPT_TARGET_CONFIG[item]
                    return (
                      <MobileActionCard
                        key={item}
                        embedded
                        className={styles.modePromptSubRow}
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
              ) : null}
            </div>
          )
        })}
      </div>
      <PromptEditorModal target={editorTarget} onClose={() => setEditorTarget(null)} />
    </>
  )
}

/** 桌面端「系统提示词」：拆分为快速模式与专家模式，各自列出基础提示词及对应工具提示词 */
export const SystemPromptSetting = () => {
  const t = useTranslate()
  const [editorTarget, setEditorTarget] = useState<PromptTarget | null>(null)

  return (
    <>
      {MODE_PROMPT_GROUPS.map((group) => {
        const mainCfg = PROMPT_TARGET_CONFIG[group.main]
        return (
          <div key={group.main}>
            <div className={clsx(styles.cell, styles.row)}>
              <div className={styles.text}>
                <div className={styles.labelRow}>
                  <span className={styles.label}>{t(mainCfg.titleKey)}</span>
                  <InfoModalButton
                    ariaLabel={t(mainCfg.titleKey)}
                    description={t(mainCfg.descKey)}
                  />
                </div>
              </div>
              <Button
                variant="outlined"
                size="m"
                className={styles.cellButton}
                onClick={() => setEditorTarget(group.main)}
              >
                {t('settingsEditAction')}
              </Button>
            </div>
            {group.tools.length > 0 ? (
              <div className={styles.desktopToolList}>
                {group.tools.map((item) => {
                  const cfg = PROMPT_TARGET_CONFIG[item]
                  return (
                    <div key={item} className={clsx(styles.cell, styles.row)}>
                      <div className={styles.text}>
                        <div className={styles.labelRow}>
                          <span className={styles.label}>{t(cfg.titleKey)}</span>
                          <InfoModalButton
                            ariaLabel={t(cfg.titleKey)}
                            description={t(cfg.descKey)}
                          />
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
            ) : null}
          </div>
        )
      })}

      <PromptEditorModal target={editorTarget} onClose={() => setEditorTarget(null)} />
    </>
  )
}
