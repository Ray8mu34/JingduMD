# 下一阶段阅读验收记录

基线为 `8fb3d80`；截图来自 Windows 上的 Edge 浏览器，视口截图为 1100 × 900 CSS px（设置面板另有 760px 视口）。`before-*.png` 是基线版本的 11 种旧主题，`after-legacy-*.png` 是兼容路径，同名文件可逐一比较。`after-reading-*.png` 与 `after-study-*.png` 覆盖两套新排版和四种外观；`after-settings-*.png` 包含一级与高级设置。`print-page-1.png`、`print-page-2.png` 是长内容打印校样。扩展样张保留了基线样张的开头，又增加了后续验收内容，因此旧版与新版截图可比较共同的开头区域。

固定样张在 `fixtures/`：`plain-article.md`、`reader-showcase.md`、`anonymous-timeline.md`、`readme-sample.md`、`delayed-long.md`。`sample-*.png` 是五类样张的阅读/暖纸校样。浏览器样张入口为 `qa.html`。

## 已执行

- `pnpm test`：57 项通过。
- `pnpm build`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：18 项通过。
- `pnpm qa:layout`：760、1100、1600px × 阅读/研读 × 四外观，共 24 组；无整页横向溢出、宽表末列可达、横向控制和键盘滚动可用；所测正文与代码注释等文字对比度均不低于 4.5:1，同一排版切外观的几何尺寸稳定。
- `pnpm qa:samples`：五类样张各八种排版/外观组合，共 40 组；无整页横向溢出，表格末列可达，README 徽章保留链接容器，长文进入按需渲染路径。浏览器样张无法加载 Tauri 本地图片，因此实际图片解码留待桌面复核。
- `pnpm qa:legacy`：11 种旧主题截图及正文/代码注释对比度检查通过。
- `pnpm qa:navigation`：语法树目录 ID 与正文一致；折叠章节可揭开；字号变化后文本锚点垂直偏差 0.42px，低于当前行高 42.55px；脚注前往与返回均可用。
- `pnpm qa:settings`：窄窗和常规宽度下的一级/高级设置截图和交互检查通过。
- `pnpm qa:print`：生成 9 页长内容校样；最后一行表格及最后一行代码仍在 PDF 文本中。临时 PDF 已删除，仅保留前两页校样图。

## 待实际设备复核

- Windows 桌面 WebView2 与 macOS WKWebView 的真实应用窗口，包括字体回退、中英文粗斜体、全角标点、公式深下标和焦点移动。Edge 浏览器的检查不能代替桌面 WebView2，亦不能代替 macOS 校样。
- 打印系统对话框取消后的折叠状态与阅读位置，以及多窗口广播和本窗口导航状态，需要在实际桌面应用中复核。
- 远程图片站点授权、真实本地文件与目录边界，仍由既有安全回归测试覆盖；浏览器样张没有真实 Tauri 文件访问能力。
