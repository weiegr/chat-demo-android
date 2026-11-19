import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { IconToastError16 } from './icons.js'
import { useToast } from './toastState.js'
import styles from './Toast.module.css'

export const Toast = () => {
  const t = useTranslate()
  const { id, message, placement } = useToast()
  if (!message) {
    return null
  }
  const center = placement === 'center'
  if (typeof message === 'string') {
    return (
      <div key={id} className={clsx(styles.toast, center && styles.center)} role="status">
        {message}
      </div>
    )
  }
  const error = !center && message.type === 'error'
  return (
    <div
      key={id}
      className={clsx(styles.toast, center && styles.center, error && styles.error)}
      role="status"
    >
      {error ? (
        <span className={styles.icon}>
          <IconToastError16 />
        </span>
      ) : null}
      <span className={styles.content}>
        {t(message.key, message.params)}
        {message.link ? (
          <a className={styles.link} href={message.link.href} target="_blank" rel="noreferrer">
            {t(message.link.key)}
          </a>
        ) : null}
      </span>
    </div>
  )
}
