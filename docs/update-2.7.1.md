# 更新到 TabNest 2.7.1

加载项目 `tabnest/dist` 的用户，在构建结束后打开 `chrome://extensions`，点击 TabNest 的重新加载，然后关闭原有新标签页并重新打开。旧页面仍运行更新前的脚本。

设置标题旁应显示 `2.7.1` 与构建编号。完整编号记录在 `dist/build-info.json`，安装包大小与 SHA-256 记录在同版本发布报告中。

更新保留书签、点击次数、最近打开和设置。正常备份继续使用 JSON v5，兼容 v2–v5。独立恢复文件只导入通过校验的部分，内部缓存和未知版本数据不直接写回。

重新加载扩展前可在设置中导出完整备份。浏览器原生书签始终是书签数据的来源。

## 构建与验收

`npm run build` 更新 `dist`；`node tools/candidate.mjs` 冻结候选 ZIP 与验收批次。跨平台检查使用同一份候选 ZIP，通过 `node tools/unpack-candidate.mjs` 解包，验收阶段不重新构建。

`node tools/check-suite.mjs` 运行功能检查与 20 样本性能测试。`node tools/release-checks.mjs` 串行执行 CPU 降速、真实 MV3 性能、30 分钟持续交互、重启、标签页丢弃及内存对照；需要冻结的 2.7.0 ZIP 与校验文件。Windows 最低 Chrome 路径通过 `MINIMUM_CHROME_PATH` 指定。

Windows 和 Linux 报告合并到 `artifacts/runs/<batch>/` 后，`node tools/verification-release.mjs` 检查完整门槛并生成验收包，随后运行 `node tools/acceptance-report.mjs` 和 `node tools/source-release.mjs`。缺失、失败、旧批次或其他候选包的报告会阻止聚合。

GitHub Actions 已在仓库设置中关闭，工作流文件已移除。上述工具保留供本地按需使用，push／PR 不触发 CI。本次完成情况见 [运行检查记录](acceptance-2.7.1.md)。
