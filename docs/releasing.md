# Windows 发布说明

macOS 的 App/DMG、通用二进制和签名公证说明见 [macos.md](macos.md)。两个平台共用源代码，安装器配置由 Tauri 自动按平台合并。

## 产物

`scripts/release-audit.ps1` 会依次运行前端测试与构建、Rust 格式检查/Clippy/测试、Tauri NSIS/MSI 打包，并在 `release` 目录生成：

- NSIS 安装程序；
- MSI 安装程序；
- 单文件便携版 `JingReader-Portable-<version>.exe`；
- `SHA256SUMS.txt`；
- `release-manifest.json`，作为以后接入更新服务的稳定元数据格式。

日常安装优先使用 NSIS `setup.exe`，它按当前用户安装且无需 Visual Studio。MSI 采用 Windows Installer 的全机注册语义，需要管理员权限，主要用于受管部署。

若旧版程序仍在运行，可先设置绝对路径的 `CARGO_TARGET_DIR`，再执行发布脚本；脚本会从该目录收集打包产物，避免覆盖正在运行的 EXE。

## Authenticode 签名

仓库不保存证书和私钥。获得可信代码签名证书后，将证书导入当前用户证书库，再运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-audit.ps1 -CertificateThumbprint '证书指纹'
```

脚本使用 Windows SDK 的 `signtool.exe` 和 RFC 3161 时间戳服务签署所有 EXE/MSI，并用 `Get-AuthenticodeSignature` 复核。没有证书时仍可生成本地测试包，但清单会明确标记 `signed: false`。

## 自动更新基础

当前版本不静默联网，也没有硬编码不存在的更新服务器。`release-manifest.json` 已提供版本、平台、文件名、大小和 SHA-256；将来确定 HTTPS 发布地址与独立的更新签名密钥后，再启用 Tauri updater，并把公钥写入应用配置。更新私钥只能放在发布机或 CI Secret 中。

启用更新前必须满足：

1. 更新清单和安装包全部通过 HTTPS 提供；
2. 更新包使用独立密钥签名，并验证密钥轮换方案；
3. 应用只在用户主动检查或明确开启自动检查后联网；
4. 更新失败不影响已安装版本及其 AppData；
5. 安装器仍执行右键菜单注册和卸载清理实测。

## 只读边界实测

安装前对资料目录创建快照：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-source-tree.ps1 -Path '.\test-fixtures\reader-demo' -Baseline '.\release\reader-demo.snapshot.json' -Mode Capture
```

用安装版依次打开文件夹、Markdown、本地图片，执行搜索、切换主题、关闭并重开，再验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-source-tree.ps1 -Path '.\test-fixtures\reader-demo' -Baseline '.\release\reader-demo.snapshot.json' -Mode Verify
```

验证还应覆盖中文/空格路径、三个右键入口、单实例转发、外部编辑器、卸载后的注册表清理，以及 `%APPDATA%\com.jingreader.app` 中设置和阅读位置的升级保留。
