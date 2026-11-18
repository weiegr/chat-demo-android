import clsx from 'clsx'
import styles from './Switch.module.css'

/** 开关控件：开启时呈现蓝色强调色轨道 */
export const Switch = ({
  checked,
  disabled = false,
  ariaLabel,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  ariaLabel: string
  onChange: (checked: boolean) => void
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    className={clsx(styles.switch, checked && styles.checked)}
    onClick={() => onChange(!checked)}
  >
    <span className={styles.thumb} />
  </button>
)
