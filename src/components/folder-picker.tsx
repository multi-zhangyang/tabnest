import { useState } from "react"
import { ChevronsUpDown, Folder } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import type { BookmarkFolder } from "@/lib/types"
import { cn } from "@/lib/utils"

export function FolderPicker({
  folders,
  value,
  onChange,
  disabled = false,
  id,
  className,
}: {
  folders: BookmarkFolder[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  id?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="目标文件夹"
          className={cn(
            "folder-picker-trigger w-full min-w-0 justify-between",
            className
          )}
          disabled={disabled}
        >
          <span className="min-w-0 truncate">
            {folders.find((folder) => folder.id === value)?.path ||
              "选择文件夹"}
          </span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="folder-picker-popover p-0"
        align="start"
        collisionPadding={12}
      >
        <Command>
          <CommandInput placeholder="查找文件夹…" aria-label="查找文件夹" />
          <CommandList className="folder-picker-list">
            <CommandEmpty>没有匹配的文件夹</CommandEmpty>
            <CommandGroup>
              {folders.map((folder) => (
                <CommandItem
                  key={folder.id}
                  value={folder.id}
                  keywords={[folder.path]}
                  disabled={folder.readOnly}
                  onSelect={() => {
                    onChange(folder.id)
                    setOpen(false)
                  }}
                  data-checked={folder.id === value}
                >
                  <Folder />
                  <span className="min-w-0 truncate" title={folder.path}>
                    {folder.path}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
