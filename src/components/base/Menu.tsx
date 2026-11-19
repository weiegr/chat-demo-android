import clsx from 'clsx'
import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss, type Align } from './anchored.js'
import styles from './Menu.module.css'

export type MenuOption = {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  onSelect: () => void
}

/** 点击或长按触发的悬浮菜单；支持受控显隐、外部锚点及防穿透透明遮罩 */
export const Menu = ({
  options,
  open: controlledOpen,
  anchorRef: externalAnchorRef,
  align = 'start',
  alignOffset = -5,
  offset = 4,
  variant = 'default',
  withBackdrop = false,
  onOpenChange,
  children,
}: {
  options: MenuOption[]
  open?: boolean
  anchorRef?: RefObject<HTMLElement | null>
  align?: Align
  alignOffset?: number
  offset?: number
  variant?: 'default' | 'context'
  withBackdrop?: boolean
  /** 打开状态变化时通知调用方，用于让触发元素在菜单打开期间保持可见 */
  onOpenChange?: (open: boolean) => void
  children: (props: { open: boolean; toggle: () => void }) => ReactNode
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen
  const backdropArmedRef = useRef(false)
  const changeOpen = (next: boolean) => {
    if (!next) {
      backdropArmedRef.current = false
    }
    if (controlledOpen === undefined) {
      setUncontrolledOpen(next)
    }
    onOpenChange?.(next)
  }
  const close = () => changeOpen(false)
  const backdropRef = useRef<HTMLDivElement>(null)
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLSpanElement, HTMLDivElement>(
    open,
    { align, alignOffset, offset, externalAnchorRef }
  )
  useDismiss(
    open,
    withBackdrop ? [anchorRef, floatingRef, backdropRef] : [anchorRef, floatingRef],
    close
  )

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        {children({ open, toggle: () => changeOpen(!open) })}
      </span>
      {open
        ? createPortal(
            <>
              {withBackdrop ? (
                <div
                  ref={backdropRef}
                  className={styles.backdrop}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    backdropArmedRef.current = true
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    // 仅响应菜单打开后在遮罩上新发起的按压点击，吞掉长按松手时的合成 ghost click
                    if (!backdropArmedRef.current) {
                      return
                    }
                    backdropArmedRef.current = false
                    close()
                  }}
                />
              ) : null}
              <div
                ref={floatingRef}
                className={clsx(styles.menu, variant === 'context' && styles.menuContext)}
                style={position ?? undefined}
                role="menu"
              >
                {options.map((option) => (
                  <div
                    key={option.key}
                    role="menuitem"
                    className={clsx(styles.option, option.danger && styles.danger)}
                    onClick={(event) => {
                      event.stopPropagation()
                      changeOpen(false)
                      option.onSelect()
                    }}
                  >
                    <span className={styles.icon}>{option.icon}</span>
                    {option.label}
                  </div>
                ))}
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )
}
