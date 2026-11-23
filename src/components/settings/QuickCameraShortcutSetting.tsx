import clsx from 'clsx'
import { useRef, useState } from 'react'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  setQuickCameraShortcut,
  useSettings,
  type QuickCameraShortcut,
} from '../../services/settings.js'
import { IconChevronRightOutline14 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { usePresence } from '../base/usePresence.js'
import { MobileActionCard } from './MobileActionCard.js'
import { WheelColumn } from './WheelColumn.js'
import styles from './Settings.module.css'

const OPTIONS: { value: QuickCameraShortcut; labelKey: TranslationKey }[] = [
  { value: 'on', labelKey: 'settingsQuickCameraOn' },
  { value: 'when-occupied', labelKey: 'settingsQuickCameraWhenOccupied' },
  { value: 'off', labelKey: 'settingsQuickCameraOff' },
]

export const QuickCameraShortcutSetting = () => {
  const t = useTranslate()
  const preference = useSettings((state) => state.quickCameraShortcut)
  const [open, setOpen] = useState(false)
  const [pickerKey, setPickerKey] = useState(0)
  const presence = usePresence(open, 280)
  const title = t('settingsQuickCameraShortcut')
  const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0]

  return (
    <>
      <MobileActionCard
        embedded
        label={title}
        description={t('settingsQuickCameraShortcutDesc')}
        ariaHasPopup="dialog"
        ariaExpanded={open}
        right={
          <span className={styles.mobileNavRight}>
            <span className={styles.mobileNavValue}>{t(current.labelKey)}</span>
            <IconChevronRightOutline14 />
          </span>
        }
        onAction={() => {
          setPickerKey((key) => key + 1)
          setOpen(true)
        }}
      />
      {presence.mounted ? (
        <QuickCameraShortcutPicker
          key={pickerKey}
          preference={preference}
          visible={presence.visible}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

const QuickCameraShortcutPicker = ({
  preference,
  visible,
  onClose,
}: {
  preference: QuickCameraShortcut
  visible: boolean
  onClose: () => void
}) => {
  const t = useTranslate()
  const title = t('settingsQuickCameraShortcut')
  const items = OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))
  const [draftValue, setDraftValue] = useState<string>(preference)
  const indexRef = useRef(OPTIONS.findIndex((option) => option.value === preference))

  return (
    <Modal
      title={title}
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
            ariaLabel={title}
            items={items}
            value={draftValue}
            liveIndexRef={indexRef}
            onChange={setDraftValue}
          />
        </div>
      </div>
      <button
        type="button"
        className={styles.ttsSheetConfirm}
        onClick={() => {
          setQuickCameraShortcut(OPTIONS[indexRef.current]?.value ?? preference)
          onClose()
        }}
      >
        {t('confirm')}
      </button>
    </Modal>
  )
}
