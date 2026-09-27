import { Component } from "react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
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
          </EmptyContent>
        </Empty>
      )
    return this.props.children
  }
}
