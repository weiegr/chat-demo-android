import clsx from 'clsx'
import type { AriaAttributes, ReactNode } from 'react'
import { InfoModalButton } from './InfoModalButton.js'
import styles from './Settings.module.css'

/**
 * 移动端整行/整卡可点击动作条：
 * - `embedded = false` 时作为独立圆角卡片（数据管理、系统提示词、RP 模式设置）
 * - `embedded = true` 时作为卡片内部 44px 单行（API Key 等条目）
 * 使用铺满底部的 hit button 与 pointer-events 穿透层，避免 button 嵌套 button。
 */
export const MobileActionCard = ({
  label,
  description,
  statusText,
  statusError = false,
  right,
  embedded = false,
  disabled = false,
  danger = false,
  ariaHasPopup,
  ariaExpanded,
  className,
  onAction,
  children,
}: {
  label: string
  description?: string
  statusText?: string | null
  statusError?: boolean
  right?: ReactNode
  embedded?: boolean
  disabled?: boolean
  danger?: boolean
  ariaHasPopup?: AriaAttributes['aria-haspopup']
  ariaExpanded?: boolean
  className?: string
  onAction: () => void
  children?: ReactNode
}) => (
  <div
    className={clsx(
      styles.mobileActionCard,
      embedded && styles.mobileActionCardEmbedded,
      className
    )}
  >
    <button
      type="button"
      className={styles.mobileActionHit}
      aria-label={label}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      disabled={disabled}
      onClick={onAction}
    />
    <div className={styles.mobileActionBody}>
      <div className={styles.labelRow}>
        <span
          className={clsx(
            styles.label,
            danger && styles.mobileActionDangerLabel,
            disabled && styles.mobileActionLabelDisabled
          )}
        >
          {label}
        </span>
        {description ? <InfoModalButton ariaLabel={label} description={description} /> : null}
      </div>
      {statusText ? (
        <div className={clsx(styles.description, statusError && styles.error)}>{statusText}</div>
      ) : null}
    </div>
    {right ? <div className={styles.mobileActionRight}>{right}</div> : null}
    {children}
  </div>
)
