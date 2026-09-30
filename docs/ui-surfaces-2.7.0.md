# TabNest 2.7.0 卡片背景重设计

2026-09-30：删除此前彩色色板、渐变、弧线、分割图案和悬停高光层，重新使用 shadcn 黑白语义主题。亮色为白色哑光卡片，暗色为石墨灰卡片；细内边缘、中性图标底座、轻微底色变化提供层次。品牌图标保留原色。

使用现有 Card、CardHeader、CardTitle、CardDescription、CardContent 与 Avatar 组件。没有修改拼图几何、尺寸规则、页面间距、隐藏滚动条、虚拟渲染和数据接口，也没有添加前端说明文字。

鼠标点击和热度保存不再播放外圈动画。键盘焦点与选中反馈继续可见。设置高度稳定、页面首屏淡入和减少动态效果保留。

## 本次实际复验

本次背景修改在 Windows 11、Chrome 154 实测；此前升级的 Linux 和 Chrome 114 结果保存在原验收报告中，本次未重复这些平台的完整检查。

- ESLint、TypeScript 与生产构建通过；59 项数据和布局单元回归通过。
- 亮暗主题各 24 张样例卡片：无渐变、无装饰层，背景均为中性颜色；WCAG 2 A/AA 扫描无违规。
- 鼠标直接点击与 Ctrl 点击逐帧检查：无外圈阴影、无绘制轮廓、无点击动画；计数正常保存，键盘焦点可见，刷新后背景稳定。
- 浏览器交互检查通过；动态拼图逐帧尺寸、无重叠、冻结与恢复、布局记忆、响应式及减少动态效果通过；设置切换 36 帧高度稳定。
- 首屏／主题 12 组、UI 细节 34 项、滚动／弹窗 57 项通过，最大位置偏移为 0。
- 最新 ZIP 校验文件一致，实际 MV3 安装、书签渲染、新标签页单次呈现通过。

原始结果：`artifacts/surface-check.json`、`artifacts/pointer-light.json`、`artifacts/pointer-dark.json`、`artifacts/browser-check.json`、`artifacts/upgrade-ui-check.json`、`artifacts/startup-check.json`、`artifacts/ui-detail-check.json`、`artifacts/scroll-check.json`、`artifacts/package-smoke.json`。

亮暗主题预览已更新到 `docs/images/mosaic-light.webp` 和 `docs/images/mosaic-dark.webp`，动态演示已重新生成。最新 ZIP、体积与 SHA-256 见 [自动生成的发布数据](releases/2.7.0.md)。
