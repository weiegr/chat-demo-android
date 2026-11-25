import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import type { ChatModel } from '../../services/api/types.js'
import { setRpModel, useSettings } from '../../services/settings.js'
import { Modal } from '../base/Modal.js'
import { WheelColumn } from './WheelColumn.js'
import styles from './Settings.module.css'

const RP_MODEL_OPTIONS: { value: ChatModel; labelKey: TranslationKey }[] = [
  { value: 'deepseek-flash', labelKey: 'settingsRpModelFlash' },
  { value: 'deepseek-v4-pro', labelKey: 'settingsRpModelPro' },
]

/** RP 模式模型滚轮选择菜单：支持上下滑动切换 Flash / Pro 并持久化作为新会话默认模型 */
export const RpModelPickerModal = ({
  visible,
  onClose,
}: {
  visible: boolean
  onClose: () => void
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const rpModel = useSettings((state) => state.rpModel)
  const items = RP_MODEL_OPTIONS.map((item) => ({ value: item.value, label: t(item.labelKey) }))
  const [draftModel, setDraftModel] = useState<ChatModel>(rpModel)
  const indexRef = useRef(
    Math.max(
      0,
      RP_MODEL_OPTIONS.findIndex((item) => item.value === draftModel)
    )
  )

  useEffect(() => {
    if (!visible) {
      return
    }
    setDraftModel(rpModel)
    indexRef.current = Math.max(
      0,
      RP_MODEL_OPTIONS.findIndex((item) => item.value === rpModel)
    )
  }, [visible, rpModel])

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
      className={clsx(
        isMobile
          ? [styles.locationSheet, visible && styles.sheetVisible]
          : [styles.avatarModal, visible && styles.themeModalVisible]
      )}
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
