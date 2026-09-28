import { Moon, Sun, Monitor, Download, Upload } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { useTheme } from "./theme-provider"
import { DEFAULT_SETTINGS } from "@/lib/bookmarks"
import type { AppSettings } from "@/lib/types"

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  onImport,
  onExport,
  onFullExport,
  onHtmlExport,
  onRecovery,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  onImport: () => void
  onExport: () => void
  onFullExport: () => void
  onHtmlExport: () => void
  onRecovery: () => void
}) {
  const { theme, setTheme } = useTheme()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="settings-dialog">
        <DialogHeader>
          <DialogTitle>外观与偏好</DialogTitle>
        </DialogHeader>
        <div className="settings-content">
          <Tabs defaultValue="appearance" className="settings-tabs">
            <TabsList aria-label="偏好分类">
              <TabsTrigger value="appearance">外观</TabsTrigger>
              <TabsTrigger value="bookmarks">书签</TabsTrigger>
              <TabsTrigger value="data">数据</TabsTrigger>
            </TabsList>
            <TabsContent value="appearance">
              <FieldGroup>
                <FieldSet>
                  <FieldLegend className="sr-only">外观</FieldLegend>
                  <FieldGroup>
                    <Field>
                      <FieldLabel id="theme-label">主题</FieldLabel>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={theme}
                        aria-labelledby="theme-label"
                        onValueChange={(value) => {
                          if (value) setTheme(value as typeof theme)
                        }}
                      >
                        <ToggleGroupItem value="light" aria-label="浅色">
                          <Sun />
                          浅色
                        </ToggleGroupItem>
                        <ToggleGroupItem value="dark" aria-label="深色">
                          <Moon />
                          深色
                        </ToggleGroupItem>
                        <ToggleGroupItem value="system" aria-label="跟随系统">
                          <Monitor />
                          系统
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                    <Field>
                      <FieldLabel id="density-label">间距</FieldLabel>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={settings.density}
                        aria-labelledby="density-label"
                        onValueChange={(value) => {
                          if (value)
                            onChange({
                              density: value as AppSettings["density"],
                            })
                        }}
                      >
                        <ToggleGroupItem value="compact">紧凑</ToggleGroupItem>
                        <ToggleGroupItem value="standard">标准</ToggleGroupItem>
                        <ToggleGroupItem value="loose">宽松</ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                    <Field>
                      <FieldLabel id="font-label">字号</FieldLabel>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={settings.fontScale}
                        aria-labelledby="font-label"
                        onValueChange={(value) => {
                          if (value)
                            onChange({
                              fontScale: value as AppSettings["fontScale"],
                            })
                        }}
                      >
                        <ToggleGroupItem value="s">小</ToggleGroupItem>
                        <ToggleGroupItem value="m">中</ToggleGroupItem>
                        <ToggleGroupItem value="l">大</ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="card-scale">
                        视觉缩放{" "}
                        <span className="ml-auto tabular-nums">
                          {Math.round(settings.cardScale * 100)}%
                        </span>
                      </FieldLabel>
                      <Slider
                        id="card-scale"
                        aria-label="视觉缩放"
                        min={75}
                        max={150}
                        step={5}
                        value={[settings.cardScale * 100]}
                        onValueChange={([value]) =>
                          onChange({ cardScale: value / 100 })
                        }
                      />
                    </Field>
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
            </TabsContent>
            <TabsContent value="bookmarks">
              <FieldGroup>
                <FieldSet>
                  <FieldLegend className="sr-only">书签</FieldLegend>
                  <FieldGroup>
                    <Field orientation="horizontal">
                      <FieldLabel htmlFor="show-icons">网站图标</FieldLabel>
                      <Switch
                        id="show-icons"
                        checked={settings.iconMode === "favicon"}
                        onCheckedChange={(checked) =>
                          onChange({ iconMode: checked ? "favicon" : "none" })
                        }
                      />
                    </Field>
                    <Field orientation="horizontal">
                      <FieldLabel htmlFor="online-icons">在线图标</FieldLabel>
                      <Switch
                        id="online-icons"
                        checked={settings.onlineIcons}
                        onCheckedChange={(onlineIcons) =>
                          onChange({ onlineIcons })
                        }
                      />
                    </Field>
                    <Field orientation="horizontal">
                      <FieldLabel htmlFor="show-domain">显示域名</FieldLabel>
                      <Switch
                        id="show-domain"
                        checked={settings.showDomain}
                        onCheckedChange={(showDomain) =>
                          onChange({ showDomain })
                        }
                      />
                    </Field>
                    <Field orientation="horizontal">
                      <FieldLabel htmlFor="open-new-tab">
                        在新标签页打开
                      </FieldLabel>
                      <Switch
                        id="open-new-tab"
                        checked={settings.newTab}
                        onCheckedChange={(newTab) => onChange({ newTab })}
                      />
                    </Field>
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
            </TabsContent>
            <TabsContent value="data">
              <FieldGroup>
                <Field>
                  <FieldLabel>书签备份</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={onImport}>
                      <Upload data-icon="inline-start" />
                      导入书签
                    </Button>
                    <Button variant="outline" onClick={onExport}>
                      <Download data-icon="inline-start" />
                      导出书签
                    </Button>
                    <Button variant="outline" onClick={onFullExport}>
                      <Download data-icon="inline-start" />
                      导出完整备份
                    </Button>
                    <Button variant="outline" onClick={onHtmlExport}>
                      <Download data-icon="inline-start" />
                      HTML 书签
                    </Button>
                    <Button variant="outline" onClick={onRecovery}>
                      最近删除
                    </Button>
                  </div>
                </Field>
              </FieldGroup>
            </TabsContent>
            <Button
              variant="outline"
              onClick={() => {
                onChange(DEFAULT_SETTINGS)
                setTheme("dark")
              }}
            >
              恢复默认设置
            </Button>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}
