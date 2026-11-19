import clsx from 'clsx'
import { useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import type { ChatModel } from '../../services/api/types.js'
import { setRpModel, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconChevronRightOutline14 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { usePresence } from '../base/usePresence.js'
import { InfoModalButton } from './InfoModalButton.js'
import { MobileActionCard } from './MobileActionCard.js'
import { PromptEditorModal } from './SystemPromptSettings.js'
import { WheelColumn } from './WheelColumn.js'
import styles from './Settings.module.css'

const RP_MODEL_OPTIONS: { value: ChatModel; labelKey: TranslationKey }[] = [
  { value: 'deepseek-flash', labelKey: 'settingsRpModelFlash' },
  { value: 'deepseek-v4-pro', labelKey: 'settingsRpModelPro' },
]

/** 移动端主设置「对话设置」卡片末尾的「RP模式设置」入口行（不展示具体模型型号，便于后续扩展更多设置项） */
export const MobileRpModeNavRow = ({ onOpen }: { onOpen: () => void }) => {
  const t = useTranslate()
  return (
    <button type="button" className={styles.mobileNavRow} onClick={onOpen}>
      <span className={styles.label}>{t('settingsRpMode')}</span>
      <span className={styles.mobileNavRight}>
        <IconChevronRightOutline14 />
      </span>
    </button>
  )
}

/** RP 模式模型滚轮抽屉：参考位置信息地区选择器，支持上下滑动切换 Flash / Pro 模型 */
const MobileRpModelPickerModal = ({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) => {
  const t = useTranslate()
  const rpModel = useSettings((state) => state.rpModel)
  const items = RP_MODEL_OPTIONS.map((item) => ({ value: item.value, label: t(item.labelKey) }))
  const [draftModel, setDraftModel] = useState<ChatModel>(rpModel)
  const indexRef = useRef(
    Math.max(
      0,
      items.findIndex((item) => item.value === draftModel)
    )
  )

  const handleConfirm = () => {
    const picked = RP_MODEL_OPTIONS[indexRef.current]?.value ?? draftModel
    setRpModel(picked)
    onClose()
  }

  return (
    <Modal
      title={t('settingsRpModel')}
      closable
      visible={visible}
      className={clsx(styles.locationSheet, visible && styles.sheetVisible)}
      mainClassName={styles.locationSheetMain}
      onClose={onClose}
    >
      <div className={styles.wheelStage}>
        <div className={styles.wheelHighlight} aria-hidden="true" />
        <div className={styles.wheelColumns}>
          <WheelColumn
            ariaLabel={t('settingsRpModel')}
            items={items}
            value={draftModel}
            liveIndexRef={indexRef}
            onChange={(value) => setDraftModel(value as ChatModel)}
          />
        </div>
      </div>
      <button type="button" className={styles.ttsSheetConfirm} onClick={handleConfirm}>
        {t('confirm')}
      </button>
    </Modal>
  )
}

/** 移动端独立的「RP模式设置」子页面：包含模型设置与 RP 模式提示词 */
export const MobileRpModePage = () => {
  const t = useTranslate()
  const rpModel = useSettings((state) => state.rpModel)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const pickerPresence = usePresence(pickerOpen, 280)
  const current = RP_MODEL_OPTIONS.find((item) => item.value === rpModel) ?? RP_MODEL_OPTIONS[0]

  return (
    <div className={clsx(styles.content, styles.mobileLocationContent)}>
      <MobileActionCard
        label={t('settingsRpModel')}
        description={t('settingsRpModelDescription')}
        right={
          <span className={styles.mobileNavRight}>
            <span className={styles.mobileNavValue}>{t(current.labelKey)}</span>
            <IconChevronRightOutline14 />
          </span>
        }
        onAction={() => setPickerOpen(true)}
      />

      <MobileActionCard
        label={t('settingsRpSystemPrompt')}
        description={t('settingsRpSystemPromptDesc')}
        right={
          <span className={styles.mobileNavRight}>
            <IconChevronRightOutline14 />
          </span>
        }
        onAction={() => setPromptOpen(true)}
      />

      {pickerPresence.mounted ? (
        <MobileRpModelPickerModal
          visible={pickerPresence.visible}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      <PromptEditorModal
        target={promptOpen ? 'rpSystem' : null}
        onClose={() => setPromptOpen(false)}
      />
    </div>
  )
}

/** 桌面端「RP模式设置」：包含模型选择与 RP 模式提示词 */
export const RpModeSetting = () => {
  const t = useTranslate()
  const rpModel = useSettings((state) => state.rpModel)
  const [promptOpen, setPromptOpen] = useState(false)

  return (
    <>
      <div className={clsx(styles.cell, styles.row)}>
        <div className={styles.text}>
          <div className={styles.labelRow}>
            <span className={styles.label}>{t('settingsRpMode')}</span>
            <InfoModalButton
              ariaLabel={t('settingsRpMode')}
              description={t('settingsRpModelDescription')}
            />
          </div>
        </div>
        <Select
          ariaLabel={t('settingsRpModel')}
          value={rpModel}
          options={RP_MODEL_OPTIONS.map((item) => ({ value: item.value, label: t(item.labelKey) }))}
          onChange={setRpModel}
        />
      </div>

      <div className={clsx(styles.cell, styles.row)}>
        <div className={styles.text}>
          <div className={styles.labelRow}>
            <span className={styles.label}>{t('settingsRpSystemPrompt')}</span>
            <InfoModalButton
              ariaLabel={t('settingsRpSystemPrompt')}
              description={t('settingsRpSystemPromptDesc')}
            />
          </div>
        </div>
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          onClick={() => setPromptOpen(true)}
        >
          {t('settingsEditAction')}
        </Button>
      </div>

      <PromptEditorModal
        target={promptOpen ? 'rpSystem' : null}
        onClose={() => setPromptOpen(false)}
      />
    </>
  )
}
