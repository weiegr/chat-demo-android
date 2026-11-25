import clsx from 'clsx'
import type { ClipboardEventHandler, FocusEventHandler, ReactNode, RefObject } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

type Props = {
  inputRef: RefObject<HTMLTextAreaElement>
  value: string
  onTextChange: (text: string) => void
  onSend: () => void
  onFocus?: FocusEventHandler<HTMLTextAreaElement>
  onBlur?: FocusEventHandler<HTMLTextAreaElement>
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>
  ariaLabel?: string
  autoFocus?: boolean
  disabled?: boolean
  children?: ReactNode
}

export const ChatTextarea = ({
  inputRef,
  value,
  onTextChange,
  onSend,
  onFocus,
  onBlur,
  onPaste,
  ariaLabel,
  autoFocus,
  disabled,
  children,
}: Props) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const mirror = isMobile ? (value.endsWith('\n') ? value + ' ' : value || ' ') : value + '\n'

  return (
    <div className={styles.textareaWrapper}>
      <textarea
        ref={inputRef}
        className={clsx(styles.textarea, children && styles.textareaHidden)}
        aria-label={ariaLabel}
        placeholder={t('chatInputPlaceholderChat')}
        rows={isMobile ? 1 : 2}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(event) => onTextChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onPaste={onPaste}
        onMouseDown={(event) => {
          // 移动浏览器手动聚焦以避免整页滚动，Android WebView 保留原生光标落点。
          if (
            isMobile &&
            !('AndroidHost' in window) &&
            event.button === 0 &&
            document.activeElement !== event.currentTarget
          ) {
            event.preventDefault()
            event.currentTarget.focus({ preventScroll: true })
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSend()
          }
        }}
      />
      {children}
      <div className={styles.mirror} aria-hidden>
        {mirror}
      </div>
    </div>
  )
}
