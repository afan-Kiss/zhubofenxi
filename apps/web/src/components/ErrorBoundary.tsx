import React from 'react'
import { apiRequest } from '../lib/api'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    void apiRequest('/api/audit/client-error', {
      method: 'POST',
      body: JSON.stringify({
        message: error.message,
        stack: info.componentStack ?? error.stack,
        path: window.location.pathname,
      }),
    }).catch(() => {
      /* 未登录或网络失败时忽略 */
    })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
          <h2 className="text-lg font-semibold text-slate-800">页面加载失败</h2>
          <p className="max-w-md text-sm text-slate-600">
            页面出现异常，请刷新或联系管理员。
            {this.state.message ? `（${this.state.message}）` : ''}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            刷新页面
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
