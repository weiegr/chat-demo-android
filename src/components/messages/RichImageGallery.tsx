import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { SearchImage } from '../../services/chat/view.js'
import { IconRightUpOutline14 } from '../base/icons.js'
import { SiteLogo } from '../search/SiteLogo.js'
import { openImagePreview } from './imagePreviewState.js'
import styles from './RichImageGallery.module.css'

const GalleryItem = memo(function GalleryItem({
  image,
  single,
  onInvalid,
}: {
  image: SearchImage
  single: boolean
  onInvalid: (url: string) => void
}) {
  const t = useTranslate()
  const [loaded, setLoaded] = useState(false)

  return (
    <div className={clsx(styles.card, single && styles.singleCard)}>
      {loaded ? null : <div className={styles.skeleton} aria-hidden="true" />}
      <button
        type="button"
        className={styles.previewHit}
        aria-label={image.title}
        onClick={() => openImagePreview(image.url, image.title)}
      >
        <img
          src={image.url}
          alt={image.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={clsx(styles.img, !loaded && styles.imgHidden)}
          onLoad={() => setLoaded(true)}
          onError={() => onInvalid(image.url)}
        />
      </button>
      {loaded ? (
        <div className={styles.metaBar}>
          <span className={styles.siteBadge}>
            <SiteLogo url={image.siteIcon} className={styles.siteLogo} />
            <span className={styles.siteText}>{image.siteName || image.title}</span>
          </span>
          <a
            className={styles.sourceLink}
            href={image.pageUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={t('richImageOpenSource')}
            title={t('richImageOpenSource')}
            onClick={(event) => event.stopPropagation()}
          >
            <IconRightUpOutline14 />
          </a>
        </div>
      ) : null}
    </div>
  )
})

/**
 * 搜索工具返回的富文本图片画廊：
 * 仅在允许 AI 回复加入图片且本轮实际执行搜索工具时显示，加载失败的条目自动剔除。
 */
export const RichImageGallery = memo(function RichImageGallery({
  images,
}: {
  images: SearchImage[]
}) {
  const t = useTranslate()
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set())

  const handleInvalid = (url: string) => {
    setFailedUrls((prev) => {
      if (prev.has(url)) {
        return prev
      }
      const next = new Set(prev)
      next.add(url)
      return next
    })
  }

  const visibleImages = images.filter((image) => !failedUrls.has(image.url))
  if (visibleImages.length === 0) {
    return null
  }

  return (
    <div className={styles.gallery} role="region" aria-label={t('richImageGalleryLabel')}>
      <div className={styles.strip}>
        {visibleImages.map((image) => (
          <GalleryItem
            key={image.url}
            image={image}
            single={visibleImages.length === 1}
            onInvalid={handleInvalid}
          />
        ))}
      </div>
    </div>
  )
})
