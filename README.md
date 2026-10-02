# 静读 Markdown（JingReader）

一个面向 Windows 与 macOS、严格只读、以长文阅读为中心的本地 Markdown 文件夹查看器。macOS 适配的构建与实机验收状态见 [跨平台说明](docs/macos.md)。

- 不建立 vault，不修改资料目录，也不在资料目录生成配置或索引。
- 支持文件树、中文子串全文搜索、短词逐文件搜索、文内高亮查找、标题大纲和阅读位置恢复。
- 支持不写回源文件的四色文本高亮：选中文字弹出色板，点击已有高亮改色或删除，删除后可撤销或从回收站恢复。文件改名/移动后按内容指纹找回，旧记录可手动关联；支持导出、导入标注备份。详见 [高亮与找回说明](docs/highlights.md)。
- 支持 GFM、脚注、KaTeX、Mermaid、代码高亮、本地图片和同目录 wikilink。公式兼容 `$…$`、`$$…$$`、`\(…\)` 和 `\[…\]`。
- 本地图片相对 Markdown 文件所在目录解析，支持 `../`、`../../` 引用当前打开目录之外的共享图片；仍限制为受支持的图片类型和不超过 50 MiB。
- 提供阅读、研读两套排版，以及暖纸、素白、夜读、极夜、人文、墨水六种外观；配色与排版独立，可实时调整并保存个人排版。旧兼容样式与编辑器已移除。
- 字号、行高、每行约字数、字距、段间留白/首行缩进、标题层级、正文对齐、纸张暖度和文字对比度均可独立调整。
- 连接系统字体库（Windows GDI / macOS Core Text），通过真实字形检测分别筛选中文和西文字体；正文中西文、标题和代码可分别选用本机字体，并支持收藏、最近使用和组合预览。
- 引用、表格、代码、公式和图片拥有独立显示选项；标题章节、Callout、代码块和图片均可折叠，图片查看器支持滚轮缩放、拖动和一键适应窗口。
- 正文图片可拖动四个角等比缩放，也可在“大小”中输入原图的 1%–400%；100% 对应原始尺寸。默认同时适应正文宽度和窗口 70% 的高度，手动放大超出正文时在图片区域横向滚动。点击图片进入预览。设置按文档路径和图片地址保存在本机，不修改 Markdown 或图片文件。
- 两侧栏宽度全局共享，切换标签页、打开窗口和重启后保留；窄窗口临时适配，不覆盖保存的宽度。
- “排版 → 详细排版 → 独立公式对齐”可选择居中或靠左，默认居中；普通块公式和 math 代码块统一应用，行内公式不受影响。
- 文件栏和大纲栏靠正文一侧的边界支持拖动调宽、双击恢复默认，也可聚焦后用左右方向键微调。宽度按窗口记忆；窗口缩小时自动适配，并保留正文空间。正文最大宽度仍由阅读设置中的“栏宽”控制。
- 远程图片默认先询问；授权后仍由 Rust 后端受控下载，限制协议、重定向、内网地址、图片格式、并发数和 20 MiB 大小。Mermaid 使用 strict 模式并二次清理 SVG。
- 长文按规模分为普通、长文和超大文档三级，利用浏览器原生内容可见性与缩短重组件预加载距离降低滚动压力。
- 可通过顶部导航栏、文章底部或 `Ctrl+Shift+D`（Mac 为 `⌘+⇧+D`）导出 PDF；可选择清晰白纸或沿用当前阅读预设，并独立决定是否保留文本高亮。导出会展开折叠内容、等待图片/公式/图表渲染，并调用系统打印窗口保存，不捆绑大型 PDF 引擎。
- Windows 资源管理器支持文件夹、文件夹空白处和 `.md` 文件右键打开，不修改 `.md` 默认程序。
- 同时支持多标签页和独立窗口。文件树点击文章会打开新标签页；通过标签栏右侧按钮、文件树右键菜单、`Ctrl+Enter`、`Ctrl+双击`或搜索结果 `Ctrl+单击`可在新窗口打开。每个标签页拥有独立目录、浏览历史、阅读位置、文件监听和搜索任务；设置与高亮跨窗口共享。

`Ctrl+T` 新建标签页、`Ctrl+W` 关闭当前标签页、`Ctrl+Tab` / `Ctrl+Shift+Tab` 切换标签页、`Ctrl+N` 新建独立窗口。关闭最后一个标签页保留空白页。不同窗口可以阅读不同目录中的文章，切换目录或关闭最先打开的窗口不会影响其他窗口。资源管理器或命令行再次打开文档时，优先使用初始空窗口，否则新建独立窗口；保留 `JingReader.exe --new-window "文章.md"` 的兼容用法。窗口最小宽度为 560 像素，适合左右分屏。

标签页切换时仅渲染当前文章，阅读位置与历史保留在本次会话中；暂不提供退出应用后自动恢复全部标签页、拖动标签页脱离窗口或窗口几何位置恢复。搜索索引升级为按目录和文件共同区分，首次升级会重建搜索缓存，不清除高亮或阅读进度。

## 隐私和数据边界

应用数据库使用无正文副本的 FTS5 索引：SQLite 保存路径、文件名、修改时间、阅读进度、不可还原为原文的搜索索引，以及用户主动选择的高亮文本、前后少量上下文和用于找回文档的 SHA-256 内容指纹。不保存完整 Markdown 源文件副本。删除的高亮先进入回收站，需在“标注管理与备份”中确认永久删除才会清除。所有应用状态位于 Windows 的 `%APPDATA%\com.jingreader.app` 或 macOS 的 `~/Library/Application Support/com.jingreader.app`，源资料目录保持零写入；用户主动导出的 JSON 备份保存到所选位置。

## 开发环境

继续使用同一套 Tauri 2 + Rust + React/TypeScript 代码，无需新建 Swift 或 Electron 项目。Windows 使用 WebView2，macOS 使用系统 WKWebView。Mac 要求 macOS 14.2 或更新版本，支持 Apple Silicon 和 Intel；Mac 开发、打包和签名步骤见 [docs/macos.md](docs/macos.md)。除标签切换仍为 `Control+Tab` / `Control+Shift+Tab` 外，以下快捷键中的 `Ctrl` 在 Mac 上对应 `⌘`。Mac 原生文件菜单支持 `⌘T` 新建标签、`⌘W` 关闭标签、`⌘N` 新建窗口、`⌘⇧W` 关闭窗口；关闭最后一个窗口后应用保留菜单，`⌘Q` 退出。

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
