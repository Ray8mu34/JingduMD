use std::path::Path;
use serde_json::Value;
use serde::Deserialize;
use serde_json::value::RawValue;

#[derive(Deserialize)]
struct RawNotebook<'a> {
    nbformat: u32,
    #[serde(borrow)]
    cells: Vec<&'a RawValue>,
}
#[derive(Deserialize)]
struct RawCell<'a> {
    cell_type: &'a str,
    #[serde(borrow)]
    source: Option<&'a RawValue>,
}

/// Preserve every byte outside Markdown source values, including large numeric
/// metadata that a JSON Value round trip could otherwise silently round.
fn highlight_parts(content: &str) -> Result<(String, Vec<(bool, String)>), String> {
    let notebook: RawNotebook = serde_json::from_str(content).map_err(|e| format!("Notebook JSON 无效：{e}"))?;
    if notebook.nbformat != 4 { return Err("仅支持 nbformat 4 的正文高亮。".into()); }
    let mut skeleton = String::new();
    let mut sources = Vec::new();
    let mut cursor = 0;
    for raw in notebook.cells {
        let cell: RawCell = serde_json::from_str(raw.get()).map_err(|e| e.to_string())?;
        if cell.cell_type != "markdown" { continue; }
        let source = cell.source.ok_or("Markdown 单元格缺少 source。")?.get();
        let array = source.starts_with('[');
        let text = if array {
            serde_json::from_str::<Vec<String>>(source).map_err(|e| e.to_string())?.concat()
        } else {
            serde_json::from_str::<String>(source).map_err(|e| e.to_string())?
        };
        let start = source.as_ptr() as usize - content.as_ptr() as usize;
        skeleton.push_str(&content[cursor..start]);
        skeleton.push_str("\"__markdown_source__\"");
        cursor = start + source.len();
        sources.push((array, text));
    }
    skeleton.push_str(&content[cursor..]);
    Ok((skeleton, sources))
}

pub fn validate_highlight_change(before: &str, after: &str) -> Result<(), String> {
    let (before_skeleton, before_sources) = highlight_parts(before)?;
    let (after_skeleton, after_sources) = highlight_parts(after)?;
    if before_skeleton != after_skeleton || before_sources.len() != after_sources.len() {
        return Err("Notebook 高亮只能修改 Markdown source，不能修改代码、输出、附件或元数据。".into());
    }
    for ((before_array, before), (after_array, after)) in before_sources.iter().zip(&after_sources) {
        if before_array != after_array || super::file_highlights::without_markers(before) != super::file_highlights::without_markers(after) {
            return Err("高亮操作只能修改 Markdown 语法标记，不能改写正文。".into());
        }
    }
    Ok(())
}

pub fn is_notebook(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("ipynb"))
}

fn source(value: &Value) -> String {
    if let Some(text) = value.as_str() { return text.to_owned(); }
    match value.as_array() {
        Some(parts) if parts.iter().all(Value::is_string) => parts.iter().filter_map(Value::as_str).collect(),
        _ => String::new(),
    }
}

/// Shared by FTS indexing and search snippets. Never index output or metadata.
pub fn search_text(content: &str) -> Result<String, String> {
    let notebook: Value = serde_json::from_str(content).map_err(|_| "Notebook JSON 已损坏，无法读取。")?;
    if notebook["nbformat"].as_u64() != Some(4) { return Err("不支持此 Notebook 主版本；目前仅支持 nbformat 4。".into()); }
    let cells = notebook["cells"].as_array().ok_or("Notebook 缺少有效的 cells 数组。")?;
    Ok(cells.iter().filter(|cell| matches!(cell["cell_type"].as_str(), Some("markdown" | "code")))
        .map(|cell| {
            let text = source(&cell["source"]);
            if cell["cell_type"] == "markdown" { super::file_highlights::without_markers(&text) } else { text }
        }).collect::<Vec<_>>().join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn highlights_change_only_markdown_source() {
        let original = r#"{"nbformat":4,"metadata":{"n":900719925474099312345},"cells":[{"cell_type":"markdown","source":["正文\n","下一行"],"attachments":{"a":{"image/png":"bytes"}}},{"cell_type":"code","source":"x == 1","outputs":[{"text":"keep"}]}]}"#;
        let highlighted = original.replace("正文", "==🟡正文==");
        assert!(validate_highlight_change(original, &highlighted).is_ok());
        assert!(validate_highlight_change(&highlighted, &highlighted.replace("🟡", "🔵")).is_ok());
        assert!(validate_highlight_change(&highlighted, original).is_ok());
        for changed in [original.replace("900719925474099312345", "900719925474099312346"), original.replace("bytes", "other"), original.replace("x == 1", "==🟡x== == 1"), original.replace("keep", "==🟡keep=="), original.replace("正文", "改写"), original.replace("下一行", "下一行!")] {
            assert!(validate_highlight_change(original, &changed).is_err());
        }
        assert!(validate_highlight_change("broken", original).is_err());
    }
    #[test]
    fn extracts_only_searchable_sources() {
        let value = r##"{"nbformat":4,"metadata":{"secret":"hidden"},"cells":[{"cell_type":"markdown","source":["# 中文","\n公式"]},{"cell_type":"code","source":"print(1)","outputs":[{"text":"excluded"}]},{"cell_type":"raw","source":"excluded"}]}"##;
        assert_eq!(search_text(value).unwrap(), "# 中文\n公式\n\nprint(1)");
        assert_eq!(search_text(&value.replace("中文", "中==🔵文==")).unwrap(), "# 中文\n公式\n\nprint(1)");
        assert!(search_text("broken").is_err());
        assert!(search_text(r#"{"nbformat":3,"cells":[]}"#).is_err());
        assert!(is_notebook(Path::new("A.IPYNB")));
    }
}
