import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { formatSize } from '../../services/attachments.js'
import {
  cancelMemoryRebuild,
  changeGlobalMemory,
  initGlobalMemory,
  prepareMemoryRebuild,
  regenerateMemory,
  useGlobalMemory,
  type MemoryRebuild,
} from '../../services/chat/globalMemory.js'
import { textBytes } from '../../services/chat/memoryModel.js'
import { useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { IconChevronRightOutline14, IconNotebookOutline20 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { Switch } from '../base/Switch.js'
import { usePresence } from '../base/usePresence.js'
import { Markdown } from '../markdown/Markdown.js'
import { InfoModalButton } from './InfoModalButton.js'
import { MobileActionCard } from './MobileActionCard.js'
import styles from './Settings.module.css'

/** 全局记忆设置页：移动端复用圆角分组卡片与折叠行，桌面端沿用平铺设置行 */
export const GlobalMemoryPage = ({
  onOpenFile,
  disabled,
}: {
  onOpenFile: () => void
  disabled: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const { profile, ready, saving, storageError } = useGlobalMemory()
  const actionsDisabled = disabled || !ready || saving
  const memoryLabel = (
    <div className={styles.labelRow}>
      <span className={styles.label}>{t('globalMemory')}</span>
      <InfoModalButton
        ariaLabel={t('globalMemoryInfo')}
        description={t('globalMemoryDescription')}
      />
    </div>
  )

  useEffect(() => {
    if (!ready) {
      void initGlobalMemory()
    }
  }, [ready])

  if (isMobile) {
    return (
      <div className={clsx(styles.content, styles.mobileLocationContent)}>
        <div className={styles.mobileCard}>
          <div
            className={clsx(
              styles.cell,
              styles.locationSwitchCell,
              profile.enabled && styles.locationSwitchCellOpen
            )}
          >
            <div className={styles.switchHeader}>
              {memoryLabel}
              <Switch
                checked={profile.enabled}
                disabled={actionsDisabled}
                ariaLabel={t('globalMemory')}
                onChange={(enabled) => void changeGlobalMemory({ enabled })}
              />
            </div>
            <div
              className={clsx(
                styles.locationCollapse,
                profile.enabled && styles.locationCollapseOpen
              )}
              aria-hidden={!profile.enabled}
            >
              <div className={styles.locationCollapseClip}>
                <button
                  type="button"
                  className={clsx(styles.mobileNavRow, styles.mobileSubActionRow)}
                  tabIndex={profile.enabled ? 0 : -1}
                  onClick={onOpenFile}
                >
                  <span className={styles.label}>{t('memoryFile')}</span>
                  <span className={styles.mobileNavRight}>
                    <IconChevronRightOutline14 />
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {storageError ? (
          <div className={clsx(styles.mobileCardHint, styles.mobileCardHintError)} role="alert">
            {t('memoryStorageError')}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={styles.desktopSubScroll}>
      <div className={clsx(styles.cell, styles.switchHeader)}>
        {memoryLabel}
        <Switch
          checked={profile.enabled}
          disabled={actionsDisabled}
          ariaLabel={t('globalMemory')}
          onChange={(enabled) => void changeGlobalMemory({ enabled })}
        />
      </div>

      <div
        className={clsx(styles.locationCollapse, profile.enabled && styles.locationCollapseOpen)}
        aria-hidden={!profile.enabled}
      >
        <div className={styles.locationCollapseClip}>
          <div className={clsx(styles.cell, styles.row)}>
            <div className={styles.text}>
              <span className={styles.label}>{t('memoryFile')}</span>
            </div>
            <Button
              variant="outlined"
              size="m"
              className={styles.cellButton}
              tabIndex={profile.enabled ? 0 : -1}
              onClick={onOpenFile}
            >
              {t('memoryViewFile')}
            </Button>
          </div>
        </div>
      </div>

      {storageError ? (
        <div className={clsx(styles.error, styles.desktopMemoryAlert)} role="alert">
          {t('memoryStorageError')}
        </div>
      ) : null}
    </div>
  )
}

/** 记忆文件查看与管理页：移动端卡片化操作与阅读区，桌面端滚动阅读区配固定底部操作条 */
export const MemoryFilePage = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const { profile, saving, storageError, rebuild, autoError } = useGlobalMemory()
  const hasKey = useSettings((state) => Boolean(state.apiKey))
  const [confirm, setConfirm] = useState<MemoryRebuild | 'delete' | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [prepareError, setPrepareError] = useState(false)
  const preparingRef = useRef(false)
  const prepareTimerRef = useRef<number | undefined>(undefined)
  const lastConfirmRef = useRef<MemoryRebuild | 'delete' | null>(null)
  if (confirm !== null) {
    lastConfirmRef.current = confirm
  }
  const confirmPresence = usePresence(confirm !== null, 220)
  const active = rebuild === 'waiting' || rebuild === 'generating'

  useEffect(
    () => () => {
      window.clearTimeout(prepareTimerRef.current)
    },
    []
  )

  const startRebuild = async () => {
    if (preparingRef.current) {
      return
    }
    preparingRef.current = true
    window.clearTimeout(prepareTimerRef.current)
    // 选取近期会话通常在数十毫秒内完成，延迟展示准备提示可避免点击瞬间页面抖动与按钮闪灰
    prepareTimerRef.current = window.setTimeout(() => {
      if (preparingRef.current) {
        setPreparing(true)
      }
    }, 200)
    try {
      const plan = await prepareMemoryRebuild()
      if (plan.versions.length) {
        setEmpty(false)
        setPrepareError(false)
        setConfirm(plan)
      } else {
        setPrepareError(false)
        setEmpty(true)
      }
    } catch {
      setEmpty(false)
      setPrepareError(true)
    } finally {
      window.clearTimeout(prepareTimerRef.current)
      prepareTimerRef.current = undefined
      preparingRef.current = false
      setPreparing(false)
    }
  }

  const confirmAction = async () => {
    if (!confirm) {
      return
    }
    if (confirm === 'delete') {
      if (await changeGlobalMemory('delete')) {
        setEmpty(false)
        setPrepareError(false)
        setConfirm(null)
      }
    } else {
      setConfirm(null)
      void regenerateMemory(confirm)
    }
  }

  const regenerateDisabled =
    disabled || active || preparing || saving || !profile.enabled || !hasKey
  const deleteDisabled = disabled || saving || !profile.enabled
  const message = active
    ? rebuild === 'waiting'
      ? 'memoryRebuildWaiting'
      : 'memoryRebuilding'
    : preparing
      ? 'memoryRebuildPreparing'
      : rebuild === 'failed' || prepareError
        ? 'memoryRebuildError'
        : empty
          ? 'memoryNoConversations'
          : storageError
            ? 'memoryStorageError'
            : !hasKey
              ? 'memoryRequiresApiKey'
              : autoError
                ? 'memoryAutoError'
                : null
  const error =
    message === 'memoryRebuildError' ||
    message === 'memoryStorageError' ||
    message === 'memoryAutoError'

  const documentNode = (
    <div className={styles.memoryDocCard}>
      {profile.markdown ? (
        <Markdown
          content={profile.markdown}
          loading={false}
          cacheKey="global-memory"
          disableLink
          className={styles.memoryDocument}
        />
      ) : (
        <div className={styles.memoryEmptyState}>
          <span className={styles.memoryEmptyIcon} aria-hidden="true">
            <IconNotebookOutline20 />
          </span>
          <span>{t('memoryFileEmpty')}</span>
        </div>
      )}
    </div>
  )

  const renderedConfirm = confirm ?? lastConfirmRef.current
  const confirmModal =
    confirmPresence.mounted && renderedConfirm ? (
      <Modal
        title={t(renderedConfirm === 'delete' ? 'memoryDelete' : 'memoryRegenerate')}
        visible={confirmPresence.visible}
        className={styles.deleteConfirm}
        onClose={() => {
          if (!saving) {
            setConfirm(null)
          }
        }}
        footer={
          <div className={styles.deleteActions} aria-busy={saving}>
            <Button
              size="m"
              variant="outlined"
              autoFocus={!isMobile}
              disabled={saving}
              onClick={() => setConfirm(null)}
            >
              {t('cancel')}
            </Button>
            <Button
              size="m"
              variant={renderedConfirm === 'delete' ? 'danger' : 'primary'}
              disabled={saving || disabled || confirm === null}
              onClick={() => void confirmAction()}
            >
              {t(renderedConfirm === 'delete' ? 'delete' : 'confirm')}
            </Button>
          </div>
        }
      >
        {renderedConfirm === 'delete'
          ? t('memoryDeleteConfirm')
          : t('memoryRebuildConfirm', {
              count: renderedConfirm.versions.length,
              size: formatSize(textBytes(renderedConfirm.excerpts)),
            })}
      </Modal>
    ) : null

  if (isMobile) {
    return (
      <div className={clsx(styles.content, styles.mobileDataContent)}>
        <div className={styles.mobileActionGroup}>
          <div className={styles.mobileCard}>
            <MobileActionCard
              embedded
              label={t('memoryRegenerate')}
              disabled={regenerateDisabled}
              onAction={() => void startRebuild()}
            />
            {active ? (
              <MobileActionCard embedded label={t('cancel')} onAction={cancelMemoryRebuild} />
            ) : null}
            <MobileActionCard
              embedded
              danger
              label={t('memoryDelete')}
              disabled={deleteDisabled}
              onAction={() => setConfirm('delete')}
            />
          </div>
          {message ? (
            <div
              role={error ? 'alert' : 'status'}
              className={clsx(styles.mobileCardHint, error && styles.mobileCardHintError)}
            >
              {t(message)}
            </div>
          ) : null}
        </div>
        {documentNode}
        {confirmModal}
      </div>
    )
  }

  return (
    <div className={styles.memoryFileDesktop}>
      <div className={styles.memoryFileDesktopBody}>
        {message ? (
          <div
            role={error ? 'alert' : 'status'}
            className={clsx(styles.memoryDesktopStatus, error ? styles.error : styles.description)}
          >
            {t(message)}
          </div>
        ) : null}
        {documentNode}
      </div>
      <div className={styles.memoryDesktopFooter}>
        <Button
          variant="dangerOutlined"
          size="m"
          className={styles.memoryDesktopDelete}
          disabled={deleteDisabled}
          onClick={() => setConfirm('delete')}
        >
          {t('memoryDelete')}
        </Button>
        {active ? (
          <Button variant="outlined" size="m" onClick={cancelMemoryRebuild}>
            {t('cancel')}
          </Button>
        ) : null}
        <Button
          variant="outlined"
          size="m"
          disabled={regenerateDisabled}
          onClick={() => void startRebuild()}
        >
          {t('memoryRegenerate')}
        </Button>
      </div>
      {confirmModal}
    </div>
  )
}
