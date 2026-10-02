//! Window identity comes from Tauri IPC, never from a caller-provided label.
use super::*;
use std::{ops::Deref, sync::Arc};
use tauri::ipc::{CommandArg, CommandItem, InvokeError};

pub(crate) struct WindowRegistry {
    pub sessions: Mutex<HashMap<String, Arc<AppState>>>,
    pub db: Arc<Mutex<Connection>>,
    pub preferences_lock: Arc<Mutex<()>>,
    pub data_dir: PathBuf,
    pub closed: Mutex<HashSet<String>>,
}

impl WindowRegistry {
    pub fn create(&self, label: &str, startup: Option<String>) -> Arc<AppState> {
        let mut sessions = self.sessions.lock();
        if let Some(existing) = sessions.get(label) {
            return existing.clone();
        }
        let state = Arc::new(AppState {
            label: label.to_owned(),
            window_label: label.split('/').next().unwrap_or(label).to_owned(),
            current_root: Mutex::new(None),
            db: self.db.clone(),
            watcher: Mutex::new(None),
            preferences_lock: self.preferences_lock.clone(),
            preferences_path: self.data_dir.join("settings.json"),
            db_path: self.data_dir.join("jingreader.sqlite3"),
            startup_target: Mutex::new(StartupTarget {
                path: startup,
                frontend_ready: false,
            }),
            index_generation: AtomicU64::new(0),
            search_generation: AtomicU64::new(0),
            index_status: Mutex::new(IndexStatus::default()),
            reading_positions: Mutex::new(HashMap::new()),
        });
        sessions.insert(label.to_owned(), state.clone());
        state
    }

    pub fn remove(&self, label: &str) {
        self.closed.lock().insert(label.to_owned());
        if let Some(state) = self.sessions.lock().remove(label) {
            *state.current_root.lock() = None;
            state.index_generation.fetch_add(1, Ordering::AcqRel);
            state.search_generation.fetch_add(1, Ordering::AcqRel);
            state.watcher.lock().take();
        }
    }

    pub fn remove_window(&self, label: &str) {
        let keys: Vec<_> = self
            .sessions
            .lock()
            .iter()
            .filter(|(_, state)| state.window_label == label)
            .map(|(key, _)| key.clone())
            .collect();
        for key in keys {
            self.remove(&key);
        }
    }
}

#[derive(Clone)]
pub(crate) struct WindowState(pub Arc<AppState>);

impl Deref for WindowState {
    type Target = AppState;
    fn deref(&self) -> &AppState {
        &self.0
    }
}

impl<'de, R: tauri::Runtime> CommandArg<'de, R> for WindowState {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let webview = command.message.webview();
        let registry = webview.state::<WindowRegistry>();
        let tab = match command.message.payload() {
            tauri::ipc::InvokeBody::Json(value) => value
                .get("tabId")
                .and_then(|value| value.as_str())
                .unwrap_or("primary"),
            _ => "primary",
        };
        if tab.len() > 64
            || !tab
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err(InvokeError::from("无效标签页"));
        }
        let key = if tab == "primary" {
            webview.label().to_owned()
        } else {
            format!("{}/{tab}", webview.label())
        };
        if registry.closed.lock().contains(&key) {
            return Err(InvokeError::from("标签页已关闭"));
        }
        let session = registry.sessions.lock().get(&key).cloned();
        Ok(Self(session.unwrap_or_else(|| registry.create(&key, None))))
    }
}

pub(crate) fn create_reader_window(app: &AppHandle, path: Option<String>) -> Result<(), String> {
    // Validate before opening, without borrowing another window's directory scope.
    let path = path
        .map(|value| canonical(value).map(|path| to_string(&path)))
        .transpose()?;
    if let Some(path) = &path {
        let target = Path::new(path);
        if !target.is_dir() && !(target.is_file() && is_markdown(target)) {
            return Err("请选择 Markdown 文件或文件夹".into());
        }
    }
    let label = format!(
        "reader-{}-{}",
        now_ms(SystemTime::now()),
        READER_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let registry = app.state::<WindowRegistry>();
    registry.create(&label, path);
    let result =
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("静读 Markdown")
            .inner_size(1100.0, 820.0)
            .min_inner_size(560.0, 420.0)
            .center()
            .decorations(cfg!(target_os = "macos"))
            .build();
    match result {
        Ok(window) => {
            window.set_focus().ok();
            Ok(())
        }
        Err(error) => {
            registry.remove(&label);
            Err(error.to_string())
        }
    }
}

pub(crate) fn open_external_target(app: &AppHandle, path: String) {
    // Only reuse the initial empty window. Never replace an article being read.
    let main = app
        .state::<WindowRegistry>()
        .sessions
        .lock()
        .get("main")
        .cloned();
    if let (Some(state), Some(window)) = (main, app.get_webview_window("main")) {
        let mut startup = state.startup_target.lock();
        if state.current_root.lock().is_none() && startup.path.is_none() {
            if startup.frontend_ready {
                // Reserve the empty window until its frontend consumes the request.
                startup.path = Some(path.clone());
                app.emit_to("main", "open-target-argument", path).ok();
            } else {
                startup.path = Some(path);
            }
            window.unminimize().ok();
            window.show().ok();
            window.set_focus().ok();
            return;
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = create_reader_window(&app, Some(path)) {
            eprintln!("无法打开阅读窗口：{error}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> WindowRegistry {
        WindowRegistry {
            sessions: Mutex::new(HashMap::new()),
            db: Arc::new(Mutex::new(init_db(Path::new(":memory:")).unwrap())),
            preferences_lock: Arc::new(Mutex::new(())),
            data_dir: std::env::temp_dir(),
            closed: Mutex::new(HashSet::new()),
        }
    }

    struct Files(PathBuf);
    impl Files {
        fn new() -> Self {
            let directory = std::env::temp_dir().join(format!(
                "jingreader-window-test-{}-{}",
                std::process::id(),
                READER_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(directory.join("a/child")).unwrap();
            fs::create_dir_all(directory.join("b")).unwrap();
            fs::write(
                directory.join("a/child/paper.md"),
                "# 甲\n\n窗口隔离搜索测试",
            )
            .unwrap();
            fs::write(directory.join("b/paper.md"), "# 乙\n\n另一篇文章").unwrap();
            Self(directory)
        }
    }
    impl Drop for Files {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).ok();
        }
    }

    #[test]
    fn startup_is_consumed_once_but_reserved_until_the_document_opens() {
        let files = Files::new();
        let registry = registry();
        let path = to_string(&files.0.join("b/paper.md"));
        let state = WindowState(registry.create("main", Some(path.clone())));
        assert_eq!(consume_startup_target(state.clone()), Some(path.clone()));
        assert_eq!(consume_startup_target(state.clone()), None);
        assert_eq!(state.startup_target.lock().path, Some(path.clone()));
        open_target(state.clone(), path).unwrap();
        assert!(state.startup_target.lock().path.is_none());
        let empty = WindowState(registry.create("main/tab-empty", None));
        assert_eq!(consume_startup_target(empty), None);
    }

    #[test]
    fn local_images_outside_the_root_keep_document_and_type_guards() {
        let files = Files::new();
        let registry = registry();
        let state = WindowState(registry.create("main/tab-images", None));
        let document = to_string(&files.0.join("a/child/paper.md"));
        let image = files.0.join("b/共享 图片.PNG");
        let bytes = b"\x89PNG\r\n\x1a\nimage";
        fs::write(&image, bytes).unwrap();
        let image_path = to_string(&image);
        assert!(read_asset(state.clone(), document.clone(), image_path.clone()).is_err());

        // Opening only the Markdown file sets its containing folder as the root.
        open_target(state.clone(), document.clone()).unwrap();
        assert!(guarded_path(&state, &image_path).is_err());
        let relative_image = to_string(&files.0.join("a/child/../../b/共享 图片.PNG"));
        let payload = read_asset(state.clone(), document.clone(), relative_image).unwrap();
        assert_eq!(payload.mime, "image/png");
        assert_eq!(payload.data, bytes);
        assert!(read_asset(state.clone(), document.clone(), image_path.clone()).is_ok());

        let outside_document = to_string(&files.0.join("b/paper.md"));
        assert!(read_document(state.clone(), outside_document.clone()).is_err());
        assert!(list_directory(state.clone(), to_string(&files.0.join("b"))).is_err());
        assert!(read_asset(state.clone(), outside_document.clone(), image_path.clone()).is_err());
        assert!(read_asset(state.clone(), document.clone(), outside_document).is_err());
        assert!(read_asset(
            state.clone(),
            document.clone(),
            to_string(&files.0.join("b"))
        )
        .is_err());
        assert!(read_asset(
            state.clone(),
            document.clone(),
            to_string(&files.0.join("missing.png"))
        )
        .is_err());

        let own_image = files.0.join("a/child/local.svg");
        fs::write(&own_image, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>").unwrap();
        assert!(read_asset(state.clone(), document.clone(), to_string(&own_image)).is_ok());
        assert!(read_asset(state.clone(), to_string(&own_image), image_path.clone()).is_err());

        let large_image = files.0.join("b/large.png");
        fs::File::create(&large_image)
            .unwrap()
            .set_len(50 * 1024 * 1024 + 1)
            .unwrap();
        assert!(
            read_asset(state.clone(), document.clone(), to_string(&large_image))
                .unwrap_err()
                .contains("50MB")
        );
        open_target(state.clone(), to_string(&files.0.join("b"))).unwrap();
        assert!(read_asset(state.clone(), document.clone(), image_path.clone()).is_err());
        registry.remove_window("main");
        assert!(read_asset(state, document, image_path).is_err());
    }

    #[test]
    fn windows_and_tabs_keep_their_own_roots_permissions_and_lifetime() {
        let files = Files::new();
        let registry = registry();
        let first = WindowState(registry.create("main", None));
        let tab = WindowState(registry.create("main/tab-2", None));
        let second = WindowState(registry.create("reader-2", None));
        let a = to_string(&files.0.join("a"));
        let b = to_string(&files.0.join("b"));
        let paper_a = to_string(&files.0.join("a/child/paper.md"));
        let paper_b = to_string(&files.0.join("b/paper.md"));
        open_target(first.clone(), a.clone()).unwrap();
        open_target(tab.clone(), b.clone()).unwrap();
        open_target(second.clone(), b.clone()).unwrap();
        assert!(read_document(first.clone(), paper_b.clone()).is_err());
        assert!(read_document(tab.clone(), paper_a.clone()).is_err());
        assert!(read_document(first.clone(), paper_a).is_ok());
        let generation = second.index_generation.load(Ordering::Acquire);
        open_target(first, b).unwrap();
        assert_eq!(second.index_generation.load(Ordering::Acquire), generation);
        registry.remove_window("main");
        assert!(!registry.sessions.lock().contains_key("main/tab-2"));
        assert!(read_document(second, paper_b).is_ok());
    }

    #[test]
    fn same_document_positions_are_independent_in_each_tab() {
        let files = Files::new();
        let registry = registry();
        let first = WindowState(registry.create("main", None));
        let second = WindowState(registry.create("reader-2", None));
        let path = to_string(&files.0.join("b/paper.md"));
        for state in [&first, &second] {
            open_target(state.clone(), path.clone()).unwrap();
        }
        for (state, ratio) in [(&first, 0.2), (&second, 0.8)] {
            save_reading_position(
                state.clone(),
                ReadingPosition {
                    path: path.clone(),
                    heading_id: None,
                    heading_ratio: 0.0,
                    document_ratio: ratio,
                },
            )
            .unwrap();
        }
        assert_eq!(
            get_reading_position(first, path.clone())
                .unwrap()
                .unwrap()
                .document_ratio,
            0.2
        );
        assert_eq!(
            get_reading_position(second, path)
                .unwrap()
                .unwrap()
                .document_ratio,
            0.8
        );
    }

    #[test]
    fn overlapping_roots_do_not_overwrite_or_clear_each_others_search_index() {
        let files = Files::new();
        let registry = registry();
        let first = WindowState(registry.create("main", None));
        let second = WindowState(registry.create("main/tab-2", None));
        let parent = canonical(files.0.join("a")).unwrap();
        let child = canonical(files.0.join("a/child")).unwrap();
        let paper = canonical(files.0.join("a/child/paper.md")).unwrap();
        open_target(first.clone(), to_string(&parent)).unwrap();
        open_target(second.clone(), to_string(&child)).unwrap();
        update_index_path(&first, &parent, &paper).unwrap();
        update_index_path(&second, &child, &paper).unwrap();
        for (state, root) in [(&first, &parent), (&second, &child)] {
            assert_eq!(
                search_documents_sync(state, to_string(root), "隔离搜索".into(), 20)
                    .unwrap()
                    .results
                    .len(),
                1
            );
        }
        clear_root_index(&first, &parent).unwrap();
        assert_eq!(
            search_documents_sync(&second, to_string(&child), "隔离搜索".into(), 20)
                .unwrap()
                .results
                .len(),
            1
        );
    }
}
