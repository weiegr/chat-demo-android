import { Component, type ReactNode } from 'react'

interface ErrorBoundaryState {
  error: Error | null
}

const isZhLocale = () =>
  typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')

/** 顶层错误边界：捕获未预期渲染异常并给出可恢复提示，避免整屏死白 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }

  override render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }
    const zh = isZhLocale()
    const detail = `${error.name || 'Error'}: ${error.message || ''}`.slice(0, 240)
    return (
      <div
        role="alert"
        style={{
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          minHeight: '100%',
          height: '100%',
          padding: '24px',
          textAlign: 'center',
          backgroundColor: 'var(--dsw-alias-bg-base, #ffffff)',
          color: 'var(--dsw-alias-label-primary, #1f2329)',
          fontFamily: 'var(--dsw-font-family, sans-serif)',
        }}
      >
        <div style={{ fontSize: '16px', fontWeight: 600 }}>
          {zh ? '页面出现异常' : 'Something went wrong'}
        </div>
        <div
          style={{
            maxWidth: '360px',
            fontSize: '13px',
            lineHeight: '20px',
            color: 'var(--dsw-alias-label-secondary, #646a73)',
            wordBreak: 'break-word',
          }}
        >
          {zh
            ? '可点击下方按钮重新加载页面；若反复出现，请将下方信息反馈给开发者。'
            : 'Reload the page to recover. If this persists, share the details below.'}
        </div>
        <code
          style={{
            maxWidth: '360px',
            padding: '8px 12px',
            borderRadius: '10px',
            fontSize: '12px',
            lineHeight: '18px',
            backgroundColor: 'var(--dsw-alias-bg-layer-2, #f5f6f7)',
            color: 'var(--dsw-alias-label-secondary, #646a73)',
            wordBreak: 'break-all',
          }}
        >
          {detail}
        </code>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: '4px',
            padding: '10px 20px',
            border: 'none',
            borderRadius: '999px',
            backgroundColor: 'var(--dsw-alias-brand-primary, #4d6bfe)',
            color: '#ffffff',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {zh ? '重新加载' : 'Reload'}
        </button>
      </div>
    )
  }
}
