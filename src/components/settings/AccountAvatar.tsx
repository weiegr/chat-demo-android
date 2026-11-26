import clsx from 'clsx'
import { useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  processAvatarImage,
  processCoverImage,
  setMockAccountAvatar,
  setMockAccountCover,
  useMockAccount,
} from '../../services/account.js'
import { IconUserFill24 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { usePresence } from '../base/usePresence.js'
import styles from './Settings.module.css'

interface AndroidPickerBridge {
  setNextPickerMode?: (mode: 'camera' | 'gallery' | 'file' | 'video') => void
}

const triggerGalleryInput = (input: HTMLInputElement | null) => {
  if (!input) {
    return
  }
  const host = (window as Window & { AndroidHost?: AndroidPickerBridge }).AndroidHost
  host?.setNextPickerMode?.('gallery')
  input.value = ''
  input.click()
}

/** 通用圆形模拟账号头像：已选自定义图片时展示图片，否则展示柔和渐变底与人物剪影 */
export const AccountAvatar = ({
  src,
  className,
  iconClassName,
}: {
  src: string | null
  className?: string
  iconClassName?: string
}) => (
  <span className={clsx(styles.accountAvatarCircle, className)} aria-hidden="true">
    {src ? (
      <img src={src} alt="" draggable={false} className={styles.accountAvatarImage} />
    ) : (
      <span className={clsx(styles.accountAvatarDefaultIcon, iconClassName)}>
        <IconUserFill24 />
      </span>
    )}
  </span>
)

type ImagePickerOptions = {
  hasCustom: boolean
  titleKey: TranslationKey
  restoreKey: TranslationKey
  updatedKey: TranslationKey
  resetDoneKey: TranslationKey
  processImage: (file: File) => Promise<string>
  saveImage: (dataUrl: string | null) => boolean
}

const useAccountImagePicker = (options: ImagePickerOptions) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const pickFile = () => {
    if (busy) {
      return
    }
    setMenuOpen(false)
    triggerGalleryInput(inputRef.current)
  }

  const openPickerOrMenu = () => {
    if (busy) {
      return
    }
    if (options.hasCustom) {
      setMenuOpen(true)
    } else {
      pickFile()
    }
  }

  const resetImage = () => {
    setMenuOpen(false)
    options.saveImage(null)
    showToast({ key: options.resetDoneKey }, { placement: 'center' })
  }

  const onFileChange = async (file: File | undefined) => {
    if (!file || busy) {
      return
    }
    setBusy(true)
    try {
      const dataUrl = await options.processImage(file)
      options.saveImage(dataUrl)
      showToast({ key: options.updatedKey }, { placement: 'center' })
    } catch {
      showToast({ key: 'accountAvatarUpdateFailed', type: 'error' }, { placement: 'center' })
    } finally {
      setBusy(false)
    }
  }

  return {
    inputRef,
    menuOpen,
    setMenuOpen,
    busy,
    titleKey: options.titleKey,
    restoreKey: options.restoreKey,
    openPickerOrMenu,
    pickFile,
    resetImage,
    onFileChange,
  }
}

/** 头像切换控制器：未设自定义头像时直达相册，已设时弹出更换/恢复菜单 */
export const useAvatarPicker = () => {
  const hasCustom = useMockAccount((state) => state.avatarDataUrl !== null)
  return useAccountImagePicker({
    hasCustom,
    titleKey: 'accountChangeAvatar',
    restoreKey: 'accountAvatarRestoreDefault',
    updatedKey: 'accountAvatarUpdated',
    resetDoneKey: 'accountAvatarResetDone',
    processImage: processAvatarImage,
    saveImage: setMockAccountAvatar,
  })
}

/** 头图背景切换控制器：未设自定义背景时直达相册，已设时弹出更换/恢复菜单 */
export const useCoverPicker = () => {
  const hasCustom = useMockAccount((state) => state.coverDataUrl !== null)
  return useAccountImagePicker({
    hasCustom,
    titleKey: 'accountChangeCover',
    restoreKey: 'accountCoverRestoreDefault',
    updatedKey: 'accountCoverUpdated',
    resetDoneKey: 'accountCoverResetDone',
    processImage: processCoverImage,
    saveImage: setMockAccountCover,
  })
}

export const AccountImagePickerControls = ({
  picker,
}: {
  picker: ReturnType<typeof useAccountImagePicker>
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const sheetPresence = usePresence(picker.menuOpen && isMobile, 280)
  const modalPresence = usePresence(picker.menuOpen && !isMobile, 220)

  const fileInput = (
    <input
      ref={picker.inputRef}
      type="file"
      accept="image/*"
      style={{ display: 'none' }}
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        void picker.onFileChange(file)
      }}
    />
  )

  if (isMobile) {
    return (
      <>
        {fileInput}
        {sheetPresence.mounted ? (
          <Modal
            title={t(picker.titleKey)}
            closable
            visible={sheetPresence.visible}
            className={clsx(styles.urlSheet, sheetPresence.visible && styles.sheetVisible)}
            mainClassName={styles.avatarSheetMain}
            onClose={() => picker.setMenuOpen(false)}
          >
            <div className={styles.avatarSheetActions}>
              <button type="button" className={styles.avatarSheetButton} onClick={picker.pickFile}>
                {t('accountAvatarChoosePhoto')}
              </button>
              <button
                type="button"
                className={clsx(styles.avatarSheetButton, styles.avatarSheetButtonDanger)}
                onClick={picker.resetImage}
              >
                {t(picker.restoreKey)}
              </button>
            </div>
          </Modal>
        ) : null}
      </>
    )
  }

  return (
    <>
      {fileInput}
      {modalPresence.mounted ? (
        <Modal
          title={t(picker.titleKey)}
          closable
          visible={modalPresence.visible}
          className={styles.avatarModal}
          mainClassName={styles.avatarSheetMain}
          onClose={() => picker.setMenuOpen(false)}
        >
          <div className={styles.avatarSheetActions}>
            <button type="button" className={styles.avatarSheetButton} onClick={picker.pickFile}>
              {t('accountAvatarChoosePhoto')}
            </button>
            <button
              type="button"
              className={clsx(styles.avatarSheetButton, styles.avatarSheetButtonDanger)}
              onClick={picker.resetImage}
            >
              {t(picker.restoreKey)}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
