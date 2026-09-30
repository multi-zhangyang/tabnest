# TabNest 2.7.0 性能实测

由 tools/acceptance-report.mjs 根据 Windows 与 Linux 的实际报告生成。

以下为首次 2.7 升级的历史数据。连续拼图 v8、按需搜索和单视图切换的后续 Windows 复验见 [修正复验](mosaic-fix-2.7.0.md)；旧 Linux 性能矩阵不代表后续实现。

Windows 11：11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz；Chrome/154.0.8037.57；2026-09-30T13:21:09.131Z。

Ubuntu 24.04 · WSL 2：11th Gen Intel(R) Core(TM) i7-11800H @ 2.30GHz；Chrome/154.0.8037.57；2026-09-30T13:25:01.070Z。

每场景五个独立新页面，未缓存布局，1440 × 900，关闭 GPU，无 CPU／网络节流。首屏截至真实拼图出现、页面淡入完成及两个绘制帧；点击反馈截至真实持久化计数在页面更新，面积反馈截至首个面积变化。五个样本的 P95 取最高值。

| 平台 | 书签 | 目录 | 首屏 P95 | 搜索 P95 | 点击反馈 P95 | 首个面积变化 P95 | 最大挂载 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Windows 11 | 500 | 50 | 868 ms | 34 ms | 40 ms | 89 ms | 154 |
| Windows 11 | 5000 | 50 | 835 ms | 55 ms | 57 ms | 98 ms | 155 |
| Windows 11 | 5000 | 1000 | 795 ms | 55 ms | 57 ms | 97 ms | 155 |
| Windows 11 | 20000 | 1000 | 995 ms | 59 ms | 87 ms | 124 ms | 155 |
| Windows 11 | 20000 | 2000 | 1115 ms | 63 ms | 99 ms | 152 ms | 155 |
| Ubuntu 24.04 · WSL 2 | 500 | 50 | 1135 ms | 46 ms | 66 ms | 115 ms | 154 |
| Ubuntu 24.04 · WSL 2 | 5000 | 50 | 1129 ms | 64 ms | 92 ms | 136 ms | 155 |
| Ubuntu 24.04 · WSL 2 | 5000 | 1000 | 1020 ms | 75 ms | 72 ms | 119 ms | 155 |
| Ubuntu 24.04 · WSL 2 | 20000 | 1000 | 1376 ms | 55 ms | 119 ms | 159 ms | 155 |
| Ubuntu 24.04 · WSL 2 | 20000 | 2000 | 1430 ms | 56 ms | 101 ms | 132 ms | 155 |

5000 条门槛：首屏 ≤1500ms、搜索和点击反馈 ≤100ms、首个面积变化 ≤150ms、挂载书签 ≤250；两个目录分布在两个平台均通过。所有场景都检查了末尾书签及文件夹的键盘／滚动可达性。

Linux 为同一设备上的 Ubuntu 24.04 WSL 2 实测，未覆盖独立 Linux 桌面显示服务器。真实书签分布、深层目录、硬件与其他扩展负载会影响结果。原始数据保存在 artifacts/performance-check.json 和 artifacts/linux-final/performance-check.json；可用 npm run test:performance 复测。
