import clsx from 'clsx'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { getImeMotionState, hasNativeImeMotion, subscribeImeMotion } from '../../app/imeMotion.js'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from './icons.js'
import { IconButton } from './IconButton.js'
import styles from './Modal.module.css'

/** 当前打开的弹窗，后打开的在末尾；叠放时 Esc 只关闭最上层 */
const openModals: object[] = []

/** 遮罩 + 居中卡片，Esc / 点遮罩关闭 */
export const Modal = ({
  title,
  children,
  footer,
  closable = false,
  visible,
  fullscreen = false,
  dialogRef,
  overlayClassName,
  className,
  mainClassName,
  onClose,
}: {
  title: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** 标题栏右侧显示关闭按钮 */
  closable?: boolean
  /** 可选受控显隐态：传入布尔值时由外层配合 usePresence 驱动进/退场遮罩过渡 */
  visible?: boolean
  /** 全屏覆盖弹层（如移动端设置页）不随软键盘整体平移 */
  fullscreen?: boolean
  /** 可选指向弹窗内容容器的 ref（便于调用方在动效期直接切换 DOM 状态） */
  dialogRef?: MutableRefObject<HTMLDivElement | null>
  /** 遮罩层的额外 class */
  overlayClassName?: string
  className?: string
  /** 内容区的 class */
  mainClassName?: string
  onClose: () => void
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const titleId = useId()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const setContentEl = (node: HTMLDivElement | null) => {
    contentRef.current = node
    if (dialogRef) {
      dialogRef.current = node
    }
  }
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const controlled = visible !== undefined
  const active = visible ?? true

  // 受控弹层首次以隐藏初始态挂载时主动提交一次布局，确保 WebView 锁定过渡起点（before-change style）
  useLayoutEffect(() => {
    if (controlled && !visible && contentRef.current) {
      void contentRef.current.getBoundingClientRect()
    }
  }, [controlled, visible])

  // Android 原生键盘动效：优先使用独立 CSS translate 属性托起底部抽屉/居中弹窗，
  // 与入退场 transform 互不冲突；Chrome < 104 不支持独立 translate 时降级用 margin-bottom 托起。
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!isMobile || fullscreen || !active || !hasNativeImeMotion() || !content) {
      return
    }

    const supportsTranslate =
      typeof content.style.translate === 'string' &&
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('translate', '0 0')
    let factor = 0.5
    let maxLift = 0
    let currentLift = 0
    let isBottomSheet = false

    const cacheMetrics = () => {
      const safeTop = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--safe-top')
      )
      const topGuard = (Number.isFinite(safeTop) ? safeTop : 0) + 12
      const rect = content.getBoundingClientRect()
      const naturalTop = rect.top + currentLift
      const naturalBottom = rect.bottom + currentLift
      isBottomSheet = naturalBottom >= window.innerHeight - 4
      factor = isBottomSheet ? 1 : 0.5
      maxLift = Math.max(0, naturalTop - topGuard)
    }

    const applyLift = (raise: number) => {
      const lift = raise > 0.05 ? Math.min(raise * factor, maxLift) : 0
      currentLift = lift > 0.05 ? lift : 0
      if (supportsTranslate) {
        if (currentLift > 0) {
          content.style.translate = `0 ${(-currentLift).toFixed(2)}px`
        } else {
          content.style.removeProperty('translate')
        }
      } else if (currentLift > 0) {
        const margin = isBottomSheet ? currentLift : currentLift * 2
        content.style.marginBottom = `${margin.toFixed(2)}px`
      } else {
        content.style.removeProperty('margin-bottom')
      }
    }

    cacheMetrics()
    applyLift(getImeMotionState().raise)

    const unsubscribe = subscribeImeMotion((phase, ime) => {
      if (phase === 'prepare') {
        cacheMetrics()
        return
      }
      if (phase === 'start' && ime.opening) {
        cacheMetrics()
      }
      applyLift(ime.raise)
    })

    return () => {
      unsubscribe()
      if (supportsTranslate) {
        content.style.removeProperty('translate')
      } else {
        content.style.removeProperty('margin-bottom')
      }
    }
  }, [isMobile, fullscreen, active])
  useEffect(() => {
    if (!active) {
      return
    }
    const token = {}
    openModals.push(token)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openModals.at(-1) === token) {
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      openModals.splice(openModals.indexOf(token), 1)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [active])

  return createPortal(
    <div
      className={clsx(
        styles.overlay,
        overlayClassName,
        controlled && (visible ? styles.overlayVisible : styles.overlayHidden)
      )}
      aria-hidden={controlled && !visible ? true : undefined}
      onMouseDown={(event) => {
        if (active && event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        ref={setContentEl}
        className={clsx(
          styles.content,
          controlled && (visible ? styles.contentVisible : styles.contentHidden),
          className
        )}
        role={active ? 'dialog' : undefined}
        aria-modal={active ? 'true' : undefined}
        aria-labelledby={titleId}
      >
        <div className={styles.header}>
          <div id={titleId} className={styles.title}>
            {title}
          </div>
          {closable ? (
            <IconButton
              className={styles.close}
              tone="primary"
              icon={<IconCloseOutline16 />}
              aria-label={t('close')}
              onClick={onClose}
            />
          ) : null}
        </div>
        {children ? <div className={clsx(styles.main, mainClassName)}>{children}</div> : null}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body
  )
}
