import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { IconMicFill16, IconMicOutline16, IconVoiceCircleOutline24 } from '../base/icons.js'
import { Tooltip } from '../base/Tooltip.js'
import type { VoiceInputStatus } from './useVoiceInput.js'
import styles from './VoiceButton.module.css'

/**
 * 语音输入按钮。
 * 移动端采用与附件加号成对的 24px 圆形声波图标；录音中为外层呼吸光圈 + 内层品牌蓝圆，
 * 移动端内层为白色三段声波逐层脉冲，桌面端为实心麦克风。
 */
export const VoiceButton = ({
  status,
  mobile = false,
  disabled = false,
  seconds,
  onClick,
}: {
  status: VoiceInputStatus
  /** 移动端采用圆形声波样式，与左侧 24px 圆形加号按钮视觉成对 */
  mobile?: boolean
  /** 非安全上下文中按钮置灰，tooltip 提示录音需要 HTTPS */
  disabled?: boolean
  /** 本次录音已录秒数，录音中显示在按钮左侧 */
  seconds: number
  onClick: () => void
}) => {
  const t = useTranslate()
  const recording = status === 'recording'

  const label = disabled
    ? t('voiceInputRequiresHttps')
    : recording
      ? t('voiceInputStop')
      : status === 'transcribing'
        ? t('voiceInputCancel')
        : t('voiceInput')

  return (
    <>
      {recording ? <span className={styles.timer}>{t('voiceInputTimer', { seconds })}</span> : null}
      <Tooltip content={label}>
        <button
          type="button"
          className={clsx(
            styles.button,
            mobile && styles.mobileButton,
            recording && styles.recording,
            disabled && styles.disabled
          )}
          aria-label={label}
          aria-pressed={recording}
          aria-disabled={disabled}
          onClick={() => {
            if (!disabled) {
              onClick()
            }
          }}
        >
          {recording ? (
            <span className={clsx(styles.active, mobile && styles.activeMobile)}>
              <span className={styles.halo} />
              <span className={styles.core} />
              <span className={styles.outline}>
                {mobile ? <IconVoiceCircleOutline24 /> : <IconMicOutline16 />}
              </span>
              <span className={styles.glyph}>
                {mobile ? (
                  <IconVoiceCircleOutline24
                    showRing={false}
                    waveClasses={[styles.waveDot, styles.waveInner, styles.waveOuter]}
                  />
                ) : (
                  <IconMicFill16 />
                )}
              </span>
            </span>
          ) : status === 'transcribing' ? (
            <span className={clsx(styles.loading, mobile && styles.loadingMobile)} />
          ) : mobile ? (
            <IconVoiceCircleOutline24 />
          ) : (
            <IconMicOutline16 />
          )}
        </button>
      </Tooltip>
    </>
  )
}
