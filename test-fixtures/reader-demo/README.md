---
title: 静读 Markdown 验收文档
language: zh-CN
---

# 静读 Markdown 验收文档

这是一份用于验证中文长文排版的示例。正文应保持舒展的行高、克制的对比度与适合持续阅读的栏宽。

## 基础排版

普通段落包含**粗体**、*斜体*、~~删除线~~、[外部链接](https://example.com)以及 `inline code`。同目录链接可以写成 [[第二篇|第二篇文档]]。

> 阅读界面的任务不是制造视觉刺激，而是尽量降低长时间阅读时的额外负担。

- 支持无序列表；
- 支持任务清单，但复选框严格只读；
- [ ] 不会写回源文件；
- [x] 可以渲染完成状态。

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 文件树 | 完成 | 按需读取子目录 |
| 全文索引 | 完成 | SQLite FTS5 |
| 阅读位置 | 完成 | 标题锚点与比例兜底 |

## 数学公式

行内公式 $E = mc^2$ 与块级公式：

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

## Mermaid 图表

```mermaid
flowchart LR
  A[打开普通文件夹] --> B[安全读取 Markdown]
  B --> C[舒适阅读]
  C --> D[恢复阅读位置]
```

## 代码块

```typescript
type ReaderPromise = {
  readonly sourceDirectory: "untouched";
  readonly readingExperience: "comfortable";
};
```

## 本地图片

![静读 Markdown 图标](./sample.svg)

## 脚注

长文阅读需要在字体、行距和栏宽之间取得平衡。[^reading]

[^reading]: 参数应允许用户独立调整，而不是被某一个主题锁死。
