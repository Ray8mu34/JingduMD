---
title: 静读渲染回归测试
language: zh-CN
---

# 长文阅读总览

## 第 3 章：**Swin** *Transformer*（2026）— café / M²

标题字体验证：**加粗术语**、*斜体变量*、`inline code` 与公式 $E=mc^2$。

这份文档用于验证中文长段落、标题折叠、PDF 分页以及阅读位置恢复。现代教材预设尤其需要观察**粗体术语**、*斜体变量*、[普通文本链接](https://example.com)以及 `inline code` 是否自然融入正文，而不是呈现为按钮或醒目的卡片。

数学与计算机科学教材通常需要在同一页中容纳定义、推导、例子和解释。正文的任务不是追求海报式冲击，而是让读者能够稳定地沿着论证前进：字符密度应该克制，段落之间需要可感知的停顿，标题则负责标示结构，却不应抢走公式和图表的注意力。这一段用于观察较长中文正文在默认栏宽、行高与段距下的阅读节奏。

Modern technical prose often alternates between conceptual explanation and precise notation. A useful reading measure keeps seventy to eighty Latin characters on a typical line, leaves enough vertical air for sustained study, and preserves a clear contrast between the sans-serif narrative text and the serif forms produced by TeX. This deliberately long paragraph helps reviewers judge line length, wrapping, emphasis, and the visual rhythm of several consecutive sentences without relying on decorative panels.

> [!NOTE]
> Callout 应具有独立标题，并且能够折叠而不修改源文件。

> 普通引用应保留清楚的左侧细线和高对比文字，但不需要阴影、渐变或大圆角。

## 公式、代码与表格

### 从行内记号到展示公式

行内公式 \(E = mc^2\)，块公式如下：

\[
\int_0^1 x^2\,dx = \frac{1}{3}
\]

较长的公式必须在窄窗口中安全滚动，而不能撑破阅读栏：

\[
\mathcal{L}(\theta) = -\frac{1}{N}\sum_{i=1}^{N}\sum_{k=1}^{K} y_{ik}\log\left(\frac{\exp(z_{ik}(\theta))}{\sum_{j=1}^{K}\exp(z_{ij}(\theta))}\right) + \lambda\sum_{\ell=1}^{L}\lVert W_{\ell}\rVert_{F}^{2}
\]

阅读顺序检查：

- 行内元素应当保持自然 baseline；
- 列表标记应当清楚，但不成为视觉焦点。

1. 先确认正文与行内公式的 baseline；
2. 再确认展示公式上下留白；
3. 最后缩窄窗口检查长公式的横向滚动。

```typescript
export function readingMinutes(characters: number) {
  return Math.max(1, Math.ceil(characters / 500));
}
```

```
const unlabelledBlock = "仍按代码块排版";
```

| 项目 | 目标 |
| --- | --- |
| 正文 | 长时间阅读舒适 |
| 目录 | 不产生配置文件 |
| 导出 | 使用系统 PDF 打印管线 |

## 图片与脚注

![本地阅读网格](assets/reading-grid.svg)

折叠图片后应保留一行摘要，放大预览支持滚轮缩放和拖动。[^reader]

[^reader]: 该脚注用于验证分页与脚注渲染。

## 导航与极端内容

### [带链接的标题](https://example.com)

标题链接应保留链接行为，目录仍应到达这一节。

### 重复标题

第一个重复标题。

### 重复标题

第二个重复标题。

Setext 标题
-----------

这一节检验 Setext 大纲和位置恢复。

### 高帽、深下标和作者编号

$$
\hat{X}_{\displaystyle \sum_{i=1}^{n} a_i} = \begin{bmatrix} 1 & 2 \\ 3 & 4 \end{bmatrix} \tag{原文 1}
$$

| 年份 | 作者与记录 | 事件说明 | 资料来源 | 影响与后续 | 备注 |
| :--- | :--- | --- | --- | --- | ---: |
| 2020 | 匿名研究者甲与合作团队 | 这是可以自然换行的长段文字，不应仅因一个单元格拉宽整个表格。 | 内部记录 A | 延续至下一阶段，详细说明按原文完整显示。 | 12 |
| 2021 | 匿名研究者乙 | 长时间轴的第二项内容，刻意保留多个中文短句以检查窄窗换行。 | 内部记录 B | 需要查看最右列，但不必滚到长表底部寻找水平滚动条。 | 34 |

| A | B | C | D | E | F | G | H | I | J | K | L |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 | 最右列可达 |

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q | R | S | T |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 最右列可达 |

```typescript
// 注释也是需要清楚阅读的正文信息。
const extremelyLongIdentifierUsedToVerifyLocalHorizontalScrolling = "a line of code must remain intact by default";
```
