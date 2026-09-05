# 静读 Markdown（JingReader）

一个面向 Windows 与 macOS、严格只读、以长文阅读为中心的本地 Markdown 文件夹查看器。macOS 适配的构建与实机验收状态见 [跨平台说明](docs/macos.md)。

- 不建立 vault，不修改资料目录，也不在资料目录生成配置或索引。
- 支持文件树、中文子串全文搜索、短词逐文件搜索、文内高亮查找、标题大纲和阅读位置恢复。
- 支持不写回源文件的四色文本高亮：选区浮动色板、改色、删除、本文与最近高亮列表、点击跳转，以及外部修改后的“引用文本 + 上下文 + 标题 + 偏移”重定位；无法可靠定位时保留为待恢复记录。
- 支持 GFM、脚注、KaTeX、Mermaid、代码高亮、本地图片和同目录 wikilink。公式兼容 `$…$`、`$$…$$`、`\(…\)` 和 `\[…\]`。
- 内置静读暖纸、人文暖页、中文书页、编辑部、瑞士现代、Solarized、墨水屏、静谧夜读、Nord 和清晰技术十套完整阅读预设；可实时预览并保存个人样式。
- 字号、行高、每行约字数、字距、段间留白/首行缩进、标题层级、正文对齐、纸张暖度和文字对比度均可独立调整。
- 连接系统字体库（Windows GDI / macOS Core Text），通过真实字形检测分别筛选中文和西文字体；正文中西文、标题和代码可分别选用本机字体，并支持收藏、最近使用和组合预览。
- 引用、表格、代码、公式和图片拥有独立显示选项；标题章节、Callout、代码块和图片均可折叠，图片查看器支持滚轮缩放、拖动和一键适应窗口。
- 远程图片默认先询问；授权后仍由 Rust 后端受控下载，限制协议、重定向、内网地址、图片格式、并发数和 20 MiB 大小。Mermaid 使用 strict 模式并二次清理 SVG。
- 长文按规模分为普通、长文和超大文档三级，利用浏览器原生内容可见性与缩短重组件预加载距离降低滚动压力。
- 可通过顶部导航栏、文章底部或 `Ctrl+Shift+D`（Mac 为 `⌘+⇧+D`）导出 PDF；可选择清晰白纸或沿用当前阅读预设，并独立决定是否保留文本高亮。导出会展开折叠内容、等待图片/公式/图表渲染，并调用系统打印窗口保存，不捆绑大型 PDF 引擎。
- Windows 资源管理器支持文件夹、文件夹空白处和 `.md` 文件右键打开，不修改 `.md` 默认程序。
- 默认仍为单窗口阅读；可通过顶部新窗口按钮、文件树右键菜单、`Ctrl+Enter`、`Ctrl+双击`或搜索结果 `Ctrl+单击`按需打开对照窗口。各窗口拥有独立的文档、历史、查找、大纲和滚动位置，并共享设置、索引与文件监听。

多窗口保持单根目录的轻量模型：子窗口用于对照阅读当前资料目录中的文章，不重复建立索引；主窗口切换资料目录时会关闭旧目录的子窗口，避免跨目录资源访问和监听错配。主窗口已运行时，也可使用 `JingReader.exe --new-window "文章.md"` 确定性地打开同根目录文章。

## 隐私和数据边界

应用数据库使用无正文副本的 FTS5 索引：SQLite 保存路径、文件名、修改时间、阅读进度、不可还原为原文的搜索索引，以及用户主动选择的高亮文本和前后少量上下文。高亮摘录用于文件变化后的重新定位，不保存完整 Markdown 源文件副本，并可在设置中一键清除当前目录全部高亮。所有应用状态位于 Windows 的 `%APPDATA%\com.jingreader.app` 或 macOS 的 `~/Library/Application Support/com.jingreader.app`，源资料目录保持零写入。

## 开发环境

继续使用同一套 Tauri 2 + Rust + React/TypeScript 代码，无需新建 Swift 或 Electron 项目。Windows 使用 WebView2，macOS 使用系统 WKWebView。Mac 要求 macOS 14.2 或更新版本，支持 Apple Silicon 和 Intel；Mac 开发、打包和签名步骤见 [docs/macos.md](docs/macos.md)。以下快捷键中的 `Ctrl` 在 Mac 上对应 `⌘`。

本机工具链约定安装在 `D:\Env`：

```powershell
$env:RUSTUP_HOME = 'D:\Env\Rust\Rustup'
$env:CARGO_HOME = 'D:\Env\Rust\Cargo'
$env:Path = "D:\Env\Rust\Cargo\bin;$env:Path"
pnpm install
pnpm tauri dev
```

Rust 使用 MSVC 目标和 Visual Studio Build Tools，不需要 Visual Studio IDE，也不使用 GCC/MinGW。CMake 仅在未来依赖实际需要时安装。

## 验证与构建

```powershell
pnpm test
pnpm build
cargo test --manifest-path src-tauri\Cargo.toml
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo clippy --manifest-path src-tauri\Cargo.toml -- -D warnings
pnpm tauri build
```

固定功能、安全与排版样例位于 `fixtures`。需要压力测试时运行 `scripts\generate-stress-fixtures.ps1`，按需生成约十万字长文和一万个 Markdown 文件；生成内容位于已忽略的 `fixtures\generated`，不会进入发布包。

正式发布、代码签名、便携版和只读快照检查见 [docs/releasing.md](docs/releasing.md)。
