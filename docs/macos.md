# macOS 与跨平台开发

## 技术选择

沿用 Tauri 2 + Rust + React/TypeScript。文件读取、SQLite FTS5 索引、目录监听、阅读状态、Markdown、公式和图表继续共用；仅系统字体、窗口、外部应用与安装入口按平台适配。迁移到 Electron 会增加运行时和打包体积，重写 SwiftUI 则需要维护第二套阅读界面，当前需求没有必要承担这些成本。

通用配置在 `src-tauri/tauri.conf.json`；Tauri 自动合并 `tauri.windows.conf.json` 或 `tauri.macos.conf.json`。Windows 保留 NSIS/MSI 和资源管理器右键菜单，Mac 生成 `.app` / `.dmg`，使用 `.icns` 图标和 Finder 的“打开方式”。仅声明 `.md`、`.markdown` 的 Viewer/Alternate 角色，不主动修改默认打开程序。参见 [Tauri 平台配置](https://v2.tauri.app/reference/config/)。

## 系统要求

- macOS 14.2 或更新版本；Apple Silicon 和 Intel。
- Node.js 24、项目声明的 pnpm 11、Rust stable、Xcode Command Line Tools。
- 系统 WebKit 必须提供 CSS Custom Highlight API；该能力在 [Safari 17.2](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/) 加入，因此不沿用 Tauri 更低的默认系统要求。macOS 14.2 是当前实现的最低目标，性能和排版仍须按下方清单实测。

## 在 Mac 开发与打包

在 Mac 的终端中执行（这些命令不用于 Windows）：

```sh
xcode-select --install
# 先按各工具的官方安装方式安装 Node.js 24、pnpm 11 和 Rust stable。
pnpm install --frozen-lockfile
pnpm tauri dev
```

开发模式不会注册 Finder 文件关联，必须安装 `.app` 验证“打开方式”。

通用安装包同时包含两种 CPU 架构：

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm release:macos
```

也可只构建一种架构：

```sh
pnpm release:macos aarch64-apple-darwin
pnpm release:macos x86_64-apple-darwin
```

脚本运行前端测试、Rust fmt/Clippy/测试，再由 Tauri 构建前端和 App/DMG。使用 `lipo` 验证架构和 `codesign` 校验包完整性，生成保留 bundle 元数据的 `.app.zip`、DMG、SHA-256 和清单。输出位于 `release/macos/<target>/<version>/`，不会覆盖已有 Windows 安装包。

仓库中的 `.github/workflows/desktop.yml` 提供 Windows、Apple Silicon、Intel 三个原生 CI 任务，测试后上传安装包为 Actions artifacts，不创建公开 Release。Mac CI 使用临时签名，仅用于测试。上传到可运行 GitHub Actions 的仓库后才能执行；当前本地目录没有可用的 Git 远程配置。

## 系统集成

| 功能 | Windows | macOS |
| --- | --- | --- |
| 主快捷键 | Ctrl | Command（⌘） |
| 窗口 | 自绘窗口控制 | 原生标题栏和红黄绿按钮 |
| 主窗口关闭 | 关闭窗口 | 隐藏并保留阅读状态；Dock 点击恢复，⌘Q 退出 |
| 字体枚举与字形检测 | GDI | Core Text |
| 外部编辑 | 默认程序 / code 命令 | 文本编辑 / 已安装的 VS Code 应用 |
| PDF | Microsoft Print to PDF | 打印面板 PDF → 存储为 PDF |
| 文件打开 | 命令行与资源管理器 | Finder 打开方式、拖到 Dock 图标、命令行 |
| 数据目录 | `%APPDATA%\com.jingreader.app` | `~/Library/Application Support/com.jingreader.app` |

Mac 按路径传给 `/usr/bin/open`，不拼接 shell 命令，也不依赖 Finder 启动时的终端 PATH。文本编辑入口固定使用 TextEdit，避免将本程序设为默认 Markdown 阅读器后产生循环打开。所有读写边界和根目录限制继续由 Rust 后端检查。

Finder 在页面监听就绪前发来的目标会暂存，页面注册监听后再消费。一次选择多个文件时只打开第一个本地目标，延续应用的单根目录模型；同根目录文章可用 ⌘+Enter 或 ⌘+双击打开对照窗口。主窗口切换目录仍关闭旧目录的对照窗口。

## 签名与公证

开发机可使用临时签名生成测试包。对外发布需要 Apple Developer ID Application 证书和 Apple 公证；临时签名通过完整性校验不表示 Gatekeeper 会信任安装包。

按 [Tauri macOS 签名文档](https://v2.tauri.app/distribute/sign/macos/) 配置 `APPLE_SIGNING_IDENTITY`，以及公证用的 `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`（或文档中的 App Store Connect API 凭据）。证书/密码仅放钥匙串或 CI Secrets；不要写进仓库。重新运行发布脚本后执行：

```sh
codesign --verify --deep --strict /Applications/JingReader.app
spctl --assess --type execute --verbose /Applications/JingReader.app
xcrun stapler validate /Applications/JingReader.app
```

还需验证实际分发的 DMG 和下载后首次安装体验。脚本清单刻意标为 `requires-release-verification`，不会根据环境变量假定公证成功。

## 验收与当前边界

本轮在 Windows 验证共享代码和 Windows Rust 分支，Mac 专用接口已按依赖源码核对。**尚未在 Mac 编译、安装或实机运行；当前没有已验证的 Mac 安装包。** CI 文件已经就绪，但当前会话没有 Mac 执行环境或可用的远程仓库，不能把配置生成等同于 CI 已通过。Linux 不是本轮发布目标。

2026-09-05 本地验证：47 项前端测试、17 项 Rust 测试通过，包含 Mac Command 组件交互、POSIX/Windows/UNC 路径和两套平台配置的 Tauri schema 解析。TypeScript/Vite 生产构建、Rust fmt/Clippy 通过。Windows NSIS 与 MSI 调试安装器构建成功，产物在 `src-tauri/target/debug/bundle/`；没有覆盖 `release/` 中既有发布包。构建仍提示既有的大 JavaScript 分块和 `.app` 结尾的 bundle identifier 建议；本轮保留 identifier，以免改变现有用户数据目录。

发布前在两种架构上完成：

1. 安装 DMG，首次启动；⌘Q 退出、红色按钮关闭、Dock 恢复、最小化和全屏。
2. Finder 冷启动与已运行时打开中文/空格路径的 Markdown；验证 ⌘O、⌘F、⌘P、⌘⇧D、⌘⇧O、对照窗口与切换根目录。
3. 使用 `fixtures/reader-showcase.md` 检查本地图片、相对链接、公式、Mermaid、长文滚动；搜索并增加/恢复四色高亮。
4. Core Text 字体列表应含中文与西文字体，并验证切换字体的实际字形和排版。
5. 文本编辑、VS Code（包括未安装时错误提示）、中文文件路径。
6. 导出白纸/当前主题 PDF，检查高亮、分页、公式和图片；取消打印后继续阅读。
7. 外部修改文件，验证监听刷新与阅读位置恢复。比较操作前后资料目录的文件哈希和目录项，确保源资料零写入；只允许应用数据目录变化。
8. 正式分发前完成 Developer ID 签名、公证及 Gatekeeper 首次启动检查。
