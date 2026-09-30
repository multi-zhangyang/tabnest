import { Component } from "react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; exporting: boolean; error: string }
> {
  state = { failed: false, exporting: false, error: "" }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() { document.documentElement.dataset.startup = "ready" }
  export = async () => {
    this.setState({ exporting: true, error: "" })
    try {
      const { createRecoveryFile, downloadRecoveryFile } = await import("@/lib/recovery-file")
      downloadRecoveryFile(await createRecoveryFile())
    } catch { this.setState({ error: "恢复文件导出失败" }) }
    finally { this.setState({ exporting: false }) }
  }
  render() {
    if (this.state.failed)
      return (
        <Empty className="min-h-screen">
          <EmptyHeader>
            <EmptyTitle>页面加载失败</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => window.location.reload()}>重新加载</Button>
            <Button variant="outline" disabled={this.state.exporting} onClick={() => void this.export()}>导出恢复文件</Button>
            {this.state.error && <FieldError role="alert">{this.state.error}</FieldError>}
          </EmptyContent>
        </Empty>
      )
    return this.props.children
  }
}
