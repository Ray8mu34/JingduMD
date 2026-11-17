# 交互与存储契约

业务依据：用户在本次会话中要求文件内高亮、现有四色、内层优先、交叉拆分、旧记录迁移及迁移前备份；语法及恢复方式见 `docs/highlights.md`。

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | 原生 select；现有字体选择器 | DESIGN.md | 设置有限选项原生；字体选择器自定义 | 既有设置 QA |
| CRUD | fileHighlights.ts、file_highlights.rs、HighlightToolbar | docs/highlights.md | 文件内高亮；旧数据库记录 | fileHighlights.test.tsx、qa-source-highlights.mjs、Rust tests |
| Toast | App.tsx notify；AnnotationManager status | 现有阅读操作反馈 | 即时失败提示；迁移持久状态 | qa-source-highlights.mjs |
| Scrollbar | src/styles.css | docs/typography-contract.md | 既有正文和弹窗滚动 | 既有布局 QA |
| 文本阅读与编辑 | lib.rs、MarkdownReader、SourceEditor、file_highlights.rs | 用户要求 TXT 兼容与源码软换行 | TXT 纯文本；Markdown 着色源码；保留实际换行、保存冲突保护与撤销 | MarkdownReader.test.tsx、Rust TXT 保存测试、qa-txt-wrap.mjs |
| 外部链接 | MarkdownReader、Tauri opener capability | 用户要求单击打开浏览器 | HTTP/HTTPS 与 mailto 使用系统默认程序；失败显示提示 | MarkdownReader.test.tsx、qa-highlight-position.mjs |
| 高亮阅读位置 | readingAnchor.ts、App preserveAnchor | 用户要求高亮后页面稳定 | 文本节点拆分后按正文偏移恢复，段首保持文字行坐标 | readingAnchor.test.ts、qa-highlight-position.mjs |

高亮写入只允许语法标记变化。日常保存按 5 分钟间隔合并恢复点，每篇最多 3 个，7 天自动过期，全局数据库不超过 64 MiB；撤销使用操作历史。校验打开时内容和保存前内容，外部修改和不可写文件均不覆盖原文，恢复点故障不阻止普通保存。批量迁移先自动保护数据库；未定位或失败的旧记录继续保留。

同一段落内完整包含粗体、斜体和链接的连续高亮使用一对标记；点击其中任何文字均编辑这一整段高亮。旧同色片段只在没有未高亮正文和其他层干扰时合并。跨段落、表格单元格、交叉选区和部分格式边界的必要拆分仍保留，拆分后的片段分别编辑。

生成内容（公式、代码、原始 HTML、无源码映射的 wikilink）不猜测写入位置；选择可映射的正文文字，或保留旧数据库标注。迁移中的重复摘录需唯一上下文，否则跳过。

Notebook 静态读取 nbformat 4；全文源码编辑和图片复制仍限定 Markdown。Notebook 标注写入仅允许 Markdown 单元格 source 中的高亮标记变化；后端逐字节校验 source 之外的 JSON 不变，并检查 source 文字与字符串/数组形式不变。保存前比较原文件，复用备份、原子替换和占用重试；跨单元格选择分别保存，代码、输出、附件只读。索引和摘要共同使用 Rust `search_text`，Notebook 仅提取 Markdown/代码 source，统计仅使用 Markdown 正文。损坏文件清空索引正文但仍通知阅读器显示错误。HTML 输出使用独立表格白名单，附件在内存中显示；不改变全局安全策略。

验证：`src/lib/notebook.test.tsx`、Rust notebook/只读测试、`node scripts/qa-notebook.mjs <资料目录>`。后者读取指定目录中的 notebook，在浏览器中检查阅读、大纲、搜索与只读调用，并核对原文件 SHA-256；测试结果仅写入项目 `qa-artifacts`。

标签栏横向溢出时，新建、切换及关闭后的当前标签自动进入可见范围。ReaderWorkspace 保留标签栏重建前的横向位置，仅调整标签栏自身滚动，不改变正文滚动位置或抢占键盘焦点；标签尺寸和窗口宽度变化后重新定位。验证：scripts/qa-tabs.mjs 的 16 标签、首尾/左右切换、关闭与窄窗口场景。

SVG 正文显示由 MarkdownReader、mediaWorkQueue.ts 与 svgRaster.ts 共同负责：保持原始逻辑尺寸和缩放偏好，静态图以临时位图参与正文绘制，预览与打印保留原始 SVG。切换文档或取消任务后，不发布过期结果，释放原图与位图对象 URL；转换失败退回 SVG，不影响远程图片授权。验证：mediaWorkQueue.test.ts、svgRaster.test.ts、MarkdownReader.test.tsx，以及 `node scripts/qa-svg-selection.mjs <Markdown 路径> [WebView2 CDP 地址]` 的连续鼠标拖选与逐帧选区变化记录。

密集公式文档使用整条公式的 `role=math` 与 TeX 说明，KaTeX 只生成视觉 HTML，避免额外隐藏 MathML DOM。该模式保留整条公式说明与视觉排版，不提供 MathML 内部逐项导航。验证：MarkdownReader.test.tsx、mathRendering.test.ts、qa-math-geometry.mjs、qa-performance-next.mjs；原生 WebView2 连续拖选的体验仍需实际窗口验证。

长文的公式编译由共享 Worker 执行，DOM 更新让位于滚动与鼠标拖选；Worker 不可用时通过同一空闲队列回退。过期内容取消排队并丢弃正在计算的结果。可见性观察器共用，打印同步展开且退出打印后不闪回 TeX。验证：mathCompiler.test.ts、visibleContent.test.ts、MarkdownReader.test.tsx，并使用合并讲义在 WebView2 中测量已加载区域的滚动与拖选。
