# 交互与存储契约

业务依据：用户在本次会话中要求文件内高亮、现有四色、内层优先、交叉拆分、旧记录迁移及迁移前备份；语法及恢复方式见 `docs/highlights.md`。

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | 原生 select；现有字体选择器 | DESIGN.md | 设置有限选项原生；字体选择器自定义 | 既有设置 QA |
| CRUD | fileHighlights.ts、file_highlights.rs、HighlightToolbar | docs/highlights.md | 文件内高亮；旧数据库记录 | fileHighlights.test.tsx、qa-source-highlights.mjs、Rust tests |
| Toast | App.tsx notify；AnnotationManager status | 现有阅读操作反馈 | 即时失败提示；迁移持久状态 | qa-source-highlights.mjs |
| Scrollbar | src/styles.css | docs/typography-contract.md | 既有正文和弹窗滚动 | 既有布局 QA |

文件写入只允许语法标记变化。写入前备份原字节，并校验打开时内容和保存前内容；外部修改、备份失败和不可写文件均不覆盖原文。批量迁移先备份完整数据库，逐篇备份原文。未定位或失败的旧记录继续保留。

同一段落内完整包含粗体、斜体和链接的连续高亮使用一对标记；点击其中任何文字均编辑这一整段高亮。旧同色片段只在没有未高亮正文和其他层干扰时合并。跨段落、表格单元格、交叉选区和部分格式边界的必要拆分仍保留，拆分后的片段分别编辑。

生成内容（公式、代码、原始 HTML、无源码映射的 wikilink）不猜测写入位置；选择可映射的正文文字，或保留旧数据库标注。迁移中的重复摘录需唯一上下文，否则跳过。
