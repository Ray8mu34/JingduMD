# 中文长文排版复核

依据用户对暖纸长文的两张截图，本轮保留 760px 正文栏宽、标题上下间距、纸色 `#f6f2e8` 和标题墨色 `#302d29`。未加入分割线、色块、公式背景或段落卡片。

## 修正

- canonical 的“首行缩进”原先只作用于相邻段落 `p + p`，使标题后的首段落空。现在所有正文直属段落均使用设定的缩进，纯图片段落除外；引用和列表沿用各自的缩进规则。
- 暖纸正文墨色从 `#504a43` 调到 `#47413b`，公式继承同一字色。工具栏与标题保持原有颜色。其余三种 appearance 未调色。
- 字体页增加独立的“正文搭配建议”。点击时从本机已安装字体中选宋体中文与衬线西文，并同时更新“阅读”“研读”的正文角色；现有标题字体、代码字体、数学字体及外观不变。若找不到候选字体，交给现有衬线回退栈。默认西文回退栈优先尝试 Source Serif 4、Source Serif、Charter、Literata、Noto Serif，然后是 Georgia。
- 正文启用 `line-break: strict`、`word-break: normal`，长 Latin 词由既有 `overflow-wrap: break-word` 兜底。支持的引擎对正文段落启用 `text-wrap: pretty`；没有采用强制两端对齐或插入不可断字符。

## 可复查的结果

`pnpm qa:text-flow` 使用完整 QA App 与本机 Edge。标题后首段、节标题后首段、后续段落的缩进均为 37px（18.5px × 2em）；正文仍为 760px，无横向溢出。正文和行内公式的计算字色相同，标题仍为 `rgb(48, 45, 41)`。

100 个中文短尾构造样本中，普通换行有 4 个末行只剩 1–2 字，`pretty` 下为 0；这说明此引擎能改善部分短尾，**不能保证所有文档或所有 WebView2 版本都有同样结果**。检查的中文段落在 640px 和 760px 下没有禁则标点落在所测行首/行尾；超长 Latin 词也未撑出正文或页面。

字体搭配测试使用本机实际安装的 Noto Serif SC 和 Georgia。CDP 从同一混排段落报告这两套字形，并保留行内代码的 Cascadia Code；切换到“研读”再返回、重载后仍保留搭配。另用隔离身份构建的原生 WebView2 窗口打开中文长文，目视确认标题后的首段与后续段落均缩进，并在本机 326 种字体的目录中应用该搭配。截图：[暖纸缩进样张](../qa-artifacts/text-flow-warm-indent.png)、[独立字体搭配入口](../qa-artifacts/font-pair-option.png)。

`pnpm qa:print` 生成 9 页 PDF，末行代码与表格最后一行均在。其原检查把无语言标记代码误判为必须带 `hljs` class，已改为等待实际代码节点；打印前等待 Markdown 组件安装展开监听。原生 WebView2 的短尾、不同缩放下的字色和纸张输出尚未逐项测量。

参考：[Chrome 对 `text-wrap: pretty` 的说明](https://developer.chrome.com/blog/css-text-wrap-pretty)、[CSS Text 对 `line-break` 的定义](https://drafts.csswg.org/css-text/#line-break-property)。
