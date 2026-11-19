import clsx from 'clsx'
import type { Image } from 'mdast'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getSafeHttpUrl, type Source } from '../../services/chat/view.js'
import { IconImageOutline20, IconRightUpOutline14 } from '../base/icons.js'
import { openImagePreview } from '../messages/imagePreviewState.js'
import { SiteLogo } from '../search/SiteLogo.js'
import { ImageAsLink } from './Link.js'
import styles from './RichImage.module.css'

/** 从 Markdown 文本中提取已出现的 HTTP/HTTPS 图片链接（用于与顶部搜图画廊去重） */
export const extractMarkdownImageUrls = (markdown: string): Set<string> => {
  const urls = new Set<string>()
  const pattern = /!\[[^\]]*\]\(\s*(https?:\/\/[^\s)>"']+)/gi
  for (const match of markdown.matchAll(pattern)) {
    const safe = getSafeHttpUrl(match[1])
    if (safe) {
      urls.add(safe)
    }
  }
  return urls
}

const RichImageInner = ({
  url,
  alt,
  title,
  source,
  block,
}: {
  url: string
  alt: string
  title: string
  source?: Source
  block: boolean
}) => {
  const t = useTranslate()
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const caption = alt || title || source?.title || ''

  if (status === 'error') {
    if (!block) {
      return (
        <a
          className={clsx('ds-a', styles.inlineFallback)}
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          <span className={styles.fallbackLabel}>{caption || t('richImageLoadFailed')}</span>
          <IconRightUpOutline14 />
        </a>
      )
    }
    return (
      <div className={styles.figure}>
        <a
          className={clsx('ds-a', styles.fallbackCard)}
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          <span className={styles.fallbackIcon}>
            <IconImageOutline20 />
          </span>
          <span className={styles.fallbackLabel}>{caption || t('richImageLoadFailed')}</span>
          <span className={styles.fallbackAction}>
            {t('richImageViewOriginal')}
            <IconRightUpOutline14 />
          </span>
        </a>
      </div>
    )
  }

  if (!block) {
    return (
      <span className={styles.inlineWrap}>
        <span className={clsx(styles.inlineCard, status === 'loading' && styles.inlineCardLoading)}>
          {status === 'loading' ? <span className={styles.skeleton} aria-hidden="true" /> : null}
          <button
            type="button"
            className={styles.previewButton}
            aria-label={caption || url}
            onClick={() => openImagePreview(url, caption)}
          >
            <img
              src={url}
              alt={caption}
              title={title || undefined}
              loading="lazy"
              referrerPolicy="no-referrer"
              className={clsx(styles.inlineImage, status === 'loading' && styles.imageHidden)}
              onLoad={() => setStatus('loaded')}
              onError={() => setStatus('error')}
            />
          </button>
        </span>
      </span>
    )
  }

  return (
    <figure className={styles.figure}>
      <div className={clsx(styles.card, status === 'loading' && styles.cardLoading)}>
        {status === 'loading' ? <div className={styles.skeleton} aria-hidden="true" /> : null}
        <button
          type="button"
          className={styles.previewButton}
          aria-label={caption || url}
          onClick={() => openImagePreview(url, caption)}
        >
          <img
            src={url}
            alt={caption}
            title={title || undefined}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={clsx(styles.image, status === 'loading' && styles.imageHidden)}
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
          />
        </button>
      </div>
      {caption || source ? (
        <figcaption className={styles.caption}>
          {caption ? <span className={styles.captionText}>{caption}</span> : <span />}
          {source ? (
            <a
              className={clsx('ds-a', styles.sourceChip)}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              title={source.title}
            >
              <SiteLogo url={source.siteIcon} className={styles.sourceLogo} />
              <span className={styles.sourceName}>{source.siteName}</span>
            </a>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  )
}

/**
 * AI 搜索富文本内嵌图片：
 * 仅处理合法 HTTP/HTTPS 图片链接；支持骨架占位、no-referrer 外链加载、点击全屏预览及无破图降级。
 */
export const RichImage = memo(function RichImage({
  node,
  sources,
  block = false,
}: {
  node: Image
  sources?: Source[]
  block?: boolean
}) {
  const safeUrl = getSafeHttpUrl(node.url)
  if (!safeUrl) {
    return <ImageAsLink node={node} />
  }
  const matchedSource = sources?.find((source) => source.imageUrl === safeUrl)
  return (
    <RichImageInner
      key={safeUrl}
      url={safeUrl}
      alt={node.alt?.trim() ?? ''}
      title={node.title?.trim() ?? ''}
      source={matchedSource}
      block={block}
    />
  )
})
