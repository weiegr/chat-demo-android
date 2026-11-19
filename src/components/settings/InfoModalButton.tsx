import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconWarningOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import styles from './Settings.module.css'

/** 感叹号提示按钮与居中提示弹窗，供设置项与移动端卡片共用 */
export const InfoModalButton = ({
  ariaLabel,
  description,
  actionLabel,
  onAction,
  warning = false,
}: {
  ariaLabel: string
  description: ReactNode
  actionLabel?: string
  onAction?: () => void
  warning?: boolean
}) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={clsx(styles.infoButton, warning && styles.infoButtonWarn)}
        aria-label={ariaLabel}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <IconWarningOutline16 />
      </button>
      {open ? (
        <Modal title="" className={styles.infoModal} onClose={() => setOpen(false)}>
          <div className={styles.infoModalText}>{description}</div>
          {actionLabel && onAction ? (
            <div className={styles.infoModalActions}>
              <button
                type="button"
                className={clsx(styles.themeModalConfirm, styles.infoModalCancel)}
                onClick={() => setOpen(false)}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                className={styles.themeModalConfirm}
                onClick={() => {
                  setOpen(false)
                  onAction()
                }}
              >
                {actionLabel}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.themeModalConfirm}
              onClick={() => setOpen(false)}
            >
              {t('confirm')}
            </button>
          )}
        </Modal>
      ) : null}
    </>
  )
}
