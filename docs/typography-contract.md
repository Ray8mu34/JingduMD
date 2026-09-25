# 阅读样式契约

`ReaderPreferences` 是磁盘与 Rust 的存储格式。`resolveReadingStyle` 兼容旧样式；`resolveReaderStyle` 从中取出 `ReaderTypography`、`ReaderAppearance` 和阅读焦点。`readerPresentation` 把有效值映射到 CSS 变量与 class。正文、设置时的正文实时预览、打印均使用这一份结果。工具栏和侧栏仍消费 palette 色值，但不消费正文字号。

## 当前有效 token

| 来源 | CSS 输出及单位 | 实际消费者 | 用户覆盖与打印 |
| --- | --- | --- | --- |
| `fontSize` | `--reader-size`，px | `.markdown-body` 的 `font-size` | 全局字号；打印白纸为 11.5pt，沿用当前外观时使用此值 |
| `lineHeight` | `--reader-leading`，无单位 | `.markdown-body` 的 `line-height` | 各 profile 独立；打印白纸为 1.72，沿用当前外观时使用此值 |
| `contentWidth` | `--reader-width`，px | `.markdown-body`、`.document-footer` 的宽度 | 各 profile 独立；打印宽度交给纸张 |
| `paragraphSpacing` | `--paragraph-space`，em | `.markdown-body p` 段距 | 各 profile 独立；打印保持语义段距 |
| 正文中西文字体 | `--reader-font`，family 栈；本机 face 别名 | `.reader-scroll .markdown-body` | 单独选择可按 profile 覆盖；“正文搭配建议”同时更新两套 profile；打印保留当前字体栈 |
| 标题中西文字体、旧 `headingFont` | `--heading-font`，family 栈；本机 face 别名 | `.markdown-body h1`–`h6` | 各 profile 独立；旧值作为继承栈，打印保留 |
| `codeFont` | `--code-font`，family 栈 | `.markdown-body code`，含有/无语言名的 fenced code | 各 profile 独立；打印保留 |
| `headingScale` | `--heading-scale`，无单位 | H1–H3 尺度；旧样式还用于部分 H4 | 各 profile 独立；打印沿用 |
| `headingDensity` | `--heading-space`，无单位 | 旧样式 H1–H3 相邻空间 | 各 profile 独立；canonical 主要以语义相邻规则控制段距 |
| `firstLineIndent` | `--first-line-indent`，em | `.paragraph-indent .markdown-body > p`，含标题后的首段 | 各 profile 独立；打印沿用 |
| `textAlign` | `--reader-align`，关键字 | `.markdown-body` 对齐 | 各 profile 独立；打印沿用 |
| `letterSpacing` | `--reader-tracking`，em | `.markdown-body` 字距 | 各 profile 独立；打印沿用 |
| `codeScale` | `--code-scale`，em | 行内 `code` 与 `pre code` | 各 profile 独立；打印沿用 |
| `formulaScale` | `--formula-scale`，em | `.lazy-math`；其 0.95 光学校正与 KaTeX 的 1.21 内部倍率合成约 1.15 | 各 profile 独立；打印沿用 |
| `backgroundWarmth`、`textContrast` | `--reader-warmth`、`--text-contrast`，% | 阅读画布底色、正文混色 | 外观相关的微调；打印白纸会覆盖底色 |
| 暖纸正文墨色 | `--reader-ink`，颜色 | 暖纸正文与继承其颜色的公式 | canonical 暖纸为 `#47413b`，标题与应用界面保持原色；沿用当前外观打印时保留 |
| `imageBrightness` | `--image-brightness`，% | canonical 图片的 `filter` | 用户值；打印清除滤镜 |

`paragraphStyle`、`quoteStyle`、`tableStyle`、`imageStyle`、`codeWrap` 由 class 选择内容块规则。它们属于排版，不属于 appearance。四种 canonical appearance 只更换 palette；legacy preset 中残留的外观与几何混合仍由 `style-legacy` 兼容层承担。`readingFocus` 只控制焦点行为。屏幕宽块由 `.reader-scroll` 的容器宽度约束；打印规则叠加纸张、分页与颜色，不另设字体配置。

中文正文以 `line-break: strict` 和 `word-break: normal` 约束禁则；长 Latin 词只在需要时由 `overflow-wrap: break-word` 断开。支持 `text-wrap: pretty` 的引擎将它用于正文段落以减少短尾；这是一项增强，不保证每段都消除短尾。正文仍按左对齐排版，不以两端拉伸补救行尾。

## 回归门槛

- `pnpm qa:style-contract` 在完整 App 中读取 computed style 与几何，检查 appearance 切换时正文节点、选区和字号不变，并检查打印媒体中的中西标题字体。
- `pnpm qa:heading-fonts` 使用 Windows 实际字体，通过 CDP 验证标题的宋体、Arial Bold 与 Bold Italic face；Rust 枚举测试检查 face 元数据。
- `pnpm qa:math` 检查公式各层尺寸和滚动轴；`pnpm qa:print` 检查 PDF 正文与宽内容。
- `pnpm qa:text-flow` 在完整 App 中检查首段缩进、中文禁则、暖纸正文/公式墨色、短尾样本、长 Latin 词、实际中西文字形及搭配在两套排版和重载后的保留。
- 手动在原生窗口核对安装字体、系统缩放和打印取消；Edge 的 `deviceScaleFactor` 仅用于浏览器回归。
