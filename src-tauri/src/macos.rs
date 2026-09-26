use core_text::{
    font::CTFont,
    font_descriptor::{kCTFontBoldTrait, kCTFontItalicTrait},
};
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID},
    AppHandle, Emitter, Manager,
};

use crate::FontFaces;

pub fn font_faces(font: &CTFont) -> FontFaces {
    let mask = kCTFontBoldTrait | kCTFontItalicTrait;
    let matching_face = |traits| {
        font.clone_with_symbolic_traits(traits, mask)
            .filter(|face| {
                face.family_name() == font.family_name() && face.symbolic_traits() & mask == traits
            })
            .map(|face| face.postscript_name())
    };
    // PostScript names identify actual installed faces for CSS local(), including CJK families.
    // Missing styles remain absent so the browser can apply its normal fallback.
    FontFaces {
        regular: matching_face(0).or_else(|| Some(font.postscript_name())),
        bold: matching_face(kCTFontBoldTrait),
        italic: matching_face(kCTFontItalicTrait),
        bold_italic: matching_face(mask),
    }
}

pub async fn print_document(window: tauri::WebviewWindow) -> Result<(), String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    window
        .with_webview(move |webview| {
            // Tauri runs this closure on the main thread and owns the live WKWebView.
            // runOperation pumps the native modal loop and returns only after printing or cancellation.
            // Wry's sheet-based print() returns immediately, before the page may be restored safely.
            unsafe {
                let view = &*webview.inner().cast::<objc2_web_kit::WKWebView>();
                let info = objc2_app_kit::NSPrintInfo::sharedPrintInfo();
                let operation = view.printOperationWithPrintInfo(&info);
                operation.runOperation();
            }
            // Cancellation is a normal completion; the frontend must restore in either case.
            let _ = sender.send(());
        })
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("打印窗口已关闭：{error}"))
}

pub fn install_menu(app: &AppHandle) -> tauri::Result<()> {
    let action = |id, title, shortcut| MenuItem::with_id(app, id, title, true, Some(shortcut));
    let menu = Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "静读 Markdown",
                true,
                &[
                    &PredefinedMenuItem::about(
                        app,
                        Some("关于静读 Markdown"),
                        Some(AboutMetadata {
                            name: Some("静读 Markdown".into()),
                            version: Some(app.package_info().version.to_string()),
                            ..Default::default()
                        }),
                    )?,
                    &action("reader-settings", "阅读设置…", "CmdOrCtrl+,")?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, Some("服务"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some("隐藏静读 Markdown"))?,
                    &PredefinedMenuItem::hide_others(app, Some("隐藏其他应用"))?,
                    &PredefinedMenuItem::show_all(app, Some("显示全部"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, Some("退出静读 Markdown"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "文件",
                true,
                &[
                    &action("reader-open-file", "打开文件…", "CmdOrCtrl+O")?,
                    &action("reader-open-folder", "打开文件夹…", "CmdOrCtrl+Alt+O")?,
                    &action("reader-new-window", "在对照窗口打开", "CmdOrCtrl+Shift+N")?,
                    &PredefinedMenuItem::separator(app)?,
                    &action("reader-export-pdf", "导出 PDF…", "CmdOrCtrl+Shift+D")?,
                    &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some("撤销"))?,
                    &PredefinedMenuItem::redo(app, Some("重做"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some("剪切"))?,
                    &PredefinedMenuItem::copy(app, Some("复制"))?,
                    &PredefinedMenuItem::paste(app, Some("粘贴"))?,
                    &PredefinedMenuItem::select_all(app, Some("全选"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &action("reader-find", "文内查找…", "CmdOrCtrl+F")?,
                    &action("reader-search", "搜索文件夹…", "CmdOrCtrl+P")?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "显示",
                true,
                &[
                    &action("reader-tree", "显示 / 隐藏文件列表", "CmdOrCtrl+Shift+E")?,
                    &action("reader-outline", "显示 / 隐藏大纲", "CmdOrCtrl+Shift+O")?,
                    &PredefinedMenuItem::fullscreen(app, Some("进入 / 退出全屏"))?,
                ],
            )?,
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                "窗口",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, Some("最小化"))?,
                    &PredefinedMenuItem::maximize(app, Some("缩放"))?,
                ],
            )?,
        ],
    )?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let action = event.id().as_ref();
        if !action.starts_with("reader-") {
            return;
        }
        // Menus belong to the app: send to the active reader only, never every webview.
        let window = app
            .webview_windows()
            .into_values()
            .find(|window| window.is_focused().unwrap_or(false))
            .or_else(|| app.get_webview_window("main"));
        if let Some(window) = window {
            window.unminimize().ok();
            window.show().ok();
            window.set_focus().ok();
            app.emit_to(window.label(), "reader-menu-action", action)
                .ok();
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_real_regular_bold_and_italic_faces() {
        let font = core_text::font::new_from_name("Helvetica", 16.0).unwrap();
        let faces = font_faces(&font);
        for (name, traits) in [
            (faces.regular, 0),
            (faces.bold, kCTFontBoldTrait),
            (faces.italic, kCTFontItalicTrait),
            (faces.bold_italic, kCTFontBoldTrait | kCTFontItalicTrait),
        ] {
            let face = core_text::font::new_from_name(&name.unwrap(), 16.0).unwrap();
            assert_eq!(face.family_name(), font.family_name());
            assert_eq!(
                face.symbolic_traits() & (kCTFontBoldTrait | kCTFontItalicTrait),
                traits
            );
        }
    }
}
