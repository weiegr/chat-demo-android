import clsx from 'clsx'
import { useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconChevronRightOutline14, IconEditOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { usePresence } from '../base/usePresence.js'
import { InfoModalButton } from './InfoModalButton.js'
import { MobileActionCard } from './MobileActionCard.js'
import { useApiKeyForm } from './useApiKeyForm.js'
import styles from './Settings.module.css'

/** API Key 设置项：移动端 44px 单行 / 桌面端设置行，带感叹号说明并点击打开二级编辑菜单 */
export const ApiKeySetting = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const apiKey = useSettings((state) => state.apiKey)
  const storageMode = useSettings((state) => state.apiKeyStorageMode)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const form = useApiKeyForm(() => {
    setEditing(false)
    setOpen(false)
  })
  const sheetPresence = usePresence(open && isMobile, 280)
  const showInput = !apiKey || editing
  const loading = storageMode === 'loading'
  const loadFailed = storageMode === 'error'
  const status = loading
    ? t('apiKeyStorageLoading')
    : loadFailed
      ? t('apiKeyStorageReadFailed')
      : apiKey
        ? t(storageMode === 'temporary' ? 'apiKeyStatusTemporary' : 'apiKeyStatusSet')
        : t('apiKeyStatusUnset')

  const openModal = () => {
    setEditing(false)
    form.reset()
    setOpen(true)
  }

  const closeModal = () => {
    if (form.pending) {
      return
    }
    form.reset()
    setOpen(false)
    setEditing(false)
  }

  const submitDisabled = loading || form.pending !== null || (showInput && !form.value.trim())
  const confirmLabel = form.pending === 'save' ? t('apiKeyVerifying') : t('confirm')
  const handleConfirm = () => {
    if (showInput) {
      void form.submit()
    } else {
      closeModal()
    }
  }

  const content = (
    <div className={styles.apiKeyModalBody}>
      {loading ? (
        <div role="status">{t('apiKeyStorageLoading')}</div>
      ) : showInput ? (
        <div className={styles.apiKeyInput}>
          <input
            type="password"
            aria-label={t('apiKeyLabel')}
            placeholder={t('apiKeyPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            // 移动端不自动聚焦：抽屉滑入与软键盘同时进行会整段掉帧，交给用户点
            autoFocus={!isMobile}
            value={form.value}
            onChange={(event) => form.setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                void form.submit()
              }
            }}
          />
        </div>
      ) : (
        <div className={styles.apiKeySaved}>
          <span className={styles.apiKeyMask}>{'*'.repeat(apiKey.length)}</span>
          <IconButton
            tone="primary"
            icon={<IconEditOutline16 />}
            tooltip={t('apiKeyEdit')}
            onClick={() => setEditing(true)}
          />
        </div>
      )}
      {form.error || loadFailed ? (
        <div className={styles.error} role="alert">
          {form.error ?? t('apiKeyStorageReadFailed')}
        </div>
      ) : null}
      {storageMode === 'temporary' ? <div>{t('apiKeyStorageTemporary')}</div> : null}
      {apiKey || loadFailed ? (
        <div className={styles.promptEditorFooterMeta}>
          <button
            type="button"
            className={styles.promptResetButton}
            disabled={form.pending !== null}
            onClick={async () => {
              if (await form.clear()) {
                setEditing(true)
              }
            }}
          >
            {t('apiKeyClear')}
          </button>
        </div>
      ) : null}
    </div>
  )

  return (
    <>
      {isMobile ? (
        <MobileActionCard
          embedded
          label={t('apiKeyLabel')}
          description={t('apiKeyDescription')}
          right={
            <span className={styles.mobileNavRight}>
              <span className={styles.mobileNavValue}>{status}</span>
              <IconChevronRightOutline14 />
            </span>
          }
          onAction={openModal}
        />
      ) : (
        <div className={clsx(styles.cell, styles.row)}>
          <div className={styles.text}>
            <div className={styles.labelRow}>
              <span className={styles.label}>{t('apiKeyLabel')}</span>
              <InfoModalButton ariaLabel={t('apiKeyLabel')} description={t('apiKeyDescription')} />
            </div>
            <div className={styles.description}>{status}</div>
          </div>
          <Button variant="outlined" size="m" className={styles.cellButton} onClick={openModal}>
            {t('settingsEditAction')}
          </Button>
        </div>
      )}

      {isMobile ? (
        sheetPresence.mounted ? (
          <Modal
            title={t('apiKeyLabel')}
            closable
            visible={sheetPresence.visible}
            className={clsx(styles.urlSheet, sheetPresence.visible && styles.sheetVisible)}
            mainClassName={styles.urlSheetMain}
            onClose={closeModal}
          >
            <div className={styles.promptStage}>{content}</div>
            <button
              type="button"
              className={styles.ttsSheetConfirm}
              disabled={submitDisabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleConfirm}
            >
              {confirmLabel}
            </button>
          </Modal>
        ) : null
      ) : open ? (
        <Modal
          title={t('apiKeyLabel')}
          className={styles.urlModal}
          onClose={closeModal}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={closeModal}>
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="m"
                disabled={submitDisabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleConfirm}
              >
                {confirmLabel}
              </Button>
            </>
          }
        >
          {content}
        </Modal>
      ) : null}
    </>
  )
}
