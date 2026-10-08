import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Contain page rendering failures while retaining the surrounding navigation. */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section role="alert" className="mx-auto my-10 max-w-xl space-y-4 rounded-xl border p-6">
        <h1 className="text-lg font-semibold">这个页面暂时无法显示</h1>
        <p className="text-sm text-muted-foreground">页面遇到了异常。你可以重试，或通过侧栏继续使用其他功能。</p>
        <div className="flex gap-3">
          <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => this.setState({ failed: false })}>重试当前页面</button>
          <Link className="rounded-md border px-3 py-2 text-sm" to="/dashboard">返回 Dashboard</Link>
        </div>
      </section>
    )
  }
}
