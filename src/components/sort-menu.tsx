import { ArrowDownWideNarrow } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SortKey } from "@/lib/types"

export function SortMenu({
  value,
  onChange,
}: {
  value: SortKey
  onChange: (sort: SortKey) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="书签排序">
          <ArrowDownWideNarrow />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(value) => onChange(value as SortKey)}
        >
          <DropdownMenuRadioItem value="default">
            浏览器顺序
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">名称</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
