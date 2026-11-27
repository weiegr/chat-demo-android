import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { savePixelImage } from '../../services/image/saveImage.js'
import { showToast } from '../base/toastState.js'
import { openImagePreview } from './imagePreviewState.js'
import styles from './ReplyArea.module.css'

/**
 * 生成的像素画卡片：时间线草图与回复正文里的成品共用一套结构。
 * 缩略图保持硬边放大，点开全屏预览，「保存」把 512×512 版本写进下载目录。
 */
export const GeneratedImageCard = ({
  dataUrl,
  title,
  large = false,
}: {
  dataUrl: string
  title?: string
  /** 正文里的成品用大图；时间线草图默认小图 */
  large?: boolean
}) => {
  const t = useTranslate()
  const [saving, setSaving] = useState(false)
  const alt = title?.trim() || t('toolImageAlt')

  const save = async () => {
    if (saving) {
      return
    }
    setSaving(true)
    try {
      await savePixelImage(dataUrl)
      showToast({ key: 'toolImageSaved' })
    } catch {
      showToast({ key: 'toolImageSaveFail' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <figure className={clsx(styles.imageCard, large && styles.imageCardLarge)}>
      <button
        type="button"
        className={clsx(styles.imageThumb, large && styles.imageThumbLarge)}
        onClick={() => openImagePreview(dataUrl, alt, true)}
        aria-label={t('toolImageZoom')}
        title={t('toolImageZoom')}
      >
        <img className={styles.pixelImage} src={dataUrl} alt={alt} draggable={false} />
      </button>
      <figcaption className={styles.imageMeta}>
        <span className={styles.imageTitle}>{alt}</span>
        <button type="button" className={styles.imageSave} onClick={save} disabled={saving}>
          {t(saving ? 'toolImageSaving' : 'toolImageSave')}
        </button>
      </figcaption>
    </figure>
  )
}
