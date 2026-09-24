use encoding_rs::GBK;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    ffi::OsStr,
    fs,
    io::Read,
    net::{IpAddr, ToSocketAddrs},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenTarget {
    root: String,
    selected_file: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryEntry {
    name: String,
    path: String,
    kind: &'static str,
    has_children: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPayload {
    path: String,
    name: String,
    content: String,
    modified_ms: u64,
    size: u64,
}

#[derive(Debug, Serialize)]
struct AssetPayload {
    mime: String,
    data: Vec<u8>,
}

#[derive(Debug, Serialize)]
struct SearchResult {
    path: String,
    name: String,
    snippet: String,
    score: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    results: Vec<SearchResult>,
    partial: bool,
    mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexStatus {
    root: String,
    indexed: usize,
    total: usize,
    running: bool,
    error: Option<String>,
    phase: String,
    cancelled: bool,
}

impl Default for IndexStatus {
    fn default() -> Self {
        Self {
            root: String::new(),
            indexed: 0,
            total: 0,
            running: false,
            error: None,
            phase: "idle".into(),
            cancelled: false,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexDiagnostics {
    schema_version: i64,
    database_bytes: u64,
    indexed_documents: u64,
    indexed_roots: u64,
    highlight_count: u64,
    stores_raw_content: bool,
    current_root: Option<String>,
    status: IndexStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentRoot {
    path: String,
    opened_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
struct ExternalChangeEvent {
    path: String,
    kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct ReaderPreferences {
    schema_version: u32,
    style_mode: String,
    typography_profile: String,
    appearance: String,
    legacy_appearance: Option<String>,
    typography_overrides: serde_json::Value,
    personal_typographies: Vec<serde_json::Value>,
    theme: String,
    font_size: f64,
    line_height: f64,
    content_width: f64,
    paragraph_spacing: f64,
    font_family: String,
    chinese_font: String,
    latin_font: String,
    heading_font: String,
    code_font: String,
    heading_scale: f64,
    heading_density: String,
    paragraph_style: String,
    first_line_indent: f64,
    text_align: String,
    letter_spacing: f64,
    quote_style: String,
    table_style: String,
    code_wrap: bool,
    code_scale: f64,
    formula_scale: f64,
    image_brightness: f64,
    image_style: String,
    background_warmth: f64,
    text_contrast: f64,
    reading_focus: String,
    show_frontmatter: bool,
    show_reading_stats: bool,
    show_tree: bool,
    show_outline: bool,
    reading_ruler: bool,
    remote_image_policy: String,
    pdf_style: String,
    pdf_include_highlights: bool,
    allowed_remote_hosts: Vec<String>,
    favorite_fonts: Vec<String>,
    recent_fonts: Vec<String>,
    custom_profiles: Vec<serde_json::Value>,
}

impl Default for ReaderPreferences {
    fn default() -> Self {
        Self {
            schema_version: 0,
            style_mode: "legacy".to_owned(),
            typography_profile: "reading".to_owned(),
            appearance: "warm".to_owned(),
            legacy_appearance: None,
            typography_overrides: serde_json::json!({"reading": {}, "study": {}}),
            personal_typographies: Vec::new(),
            theme: "paper".to_owned(),
            font_size: 18.5,
            line_height: 1.82,
            content_width: 780.0,
            paragraph_spacing: 0.85,
            font_family: "serif".to_owned(),
            chinese_font: String::new(),
            latin_font: String::new(),
            heading_font: String::new(),
            code_font: String::new(),
            heading_scale: 1.0,
            heading_density: "balanced".to_owned(),
            paragraph_style: "spacing".to_owned(),
            first_line_indent: 2.0,
            text_align: "left".to_owned(),
            letter_spacing: 0.0,
            quote_style: "bar".to_owned(),
            table_style: "plain".to_owned(),
            code_wrap: false,
            code_scale: 0.84,
            formula_scale: 1.0,
            image_brightness: 100.0,
            image_style: "soft".to_owned(),
            background_warmth: 0.0,
            text_contrast: 0.0,
            reading_focus: "off".to_owned(),
            show_frontmatter: true,
            show_reading_stats: true,
            show_tree: true,
            show_outline: true,
            reading_ruler: false,
            remote_image_policy: "ask".to_owned(),
            pdf_style: "paper".to_owned(),
            pdf_include_highlights: true,
            allowed_remote_hosts: Vec::new(),
            favorite_fonts: Vec::new(),
            recent_fonts: Vec::new(),
            custom_profiles: Vec::new(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreferencesChanged {
    source: String,
    preferences: ReaderPreferences,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemFont {
    family: String,
    supports_cjk: bool,
    supports_latin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadingPosition {
    path: String,
    heading_id: Option<String>,
    heading_ratio: f64,
    document_ratio: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextHighlight {
    id: i64,
    path: String,
    root: String,
    quote: String,
    prefix: String,
    suffix: String,
    start_offset: usize,
    end_offset: usize,
    heading_id: Option<String>,
    color: String,
    created_ms: u64,
    updated_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewTextHighlight {
    path: String,
    quote: String,
    prefix: String,
    suffix: String,
    start_offset: usize,
    end_offset: usize,
    heading_id: Option<String>,
    color: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HighlightsChanged {
    path: String,
    source: String,
}

struct AppState {
    current_root: Mutex<Option<PathBuf>>,
    db: Mutex<Connection>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    preferences_path: PathBuf,
    db_path: PathBuf,
    startup_target: Mutex<StartupTarget>,
    window_targets: Mutex<HashMap<String, OpenTarget>>,
    index_generation: AtomicU64,
    search_generation: AtomicU64,
    index_status: Mutex<IndexStatus>,
}

struct StartupTarget {
    path: Option<String>,
    frontend_ready: bool,
}

static READER_WINDOW_COUNTER: AtomicU64 = AtomicU64::new(1);

const DB_SCHEMA_VERSION: i64 = 3;

fn now_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn init_db(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|e| e.to_string())?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS reading_positions(
           path TEXT PRIMARY KEY, heading_id TEXT, heading_ratio REAL NOT NULL,
           document_ratio REAL NOT NULL, updated_ms INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS recent_roots(
           path TEXT PRIMARY KEY, opened_ms INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS expanded_nodes(
           path TEXT PRIMARY KEY, root TEXT NOT NULL
         );",
        )
        .map_err(|e| e.to_string())?;

    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if version < 2 {
        let transaction = connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        transaction
            .execute_batch(
                "DROP TABLE IF EXISTS documents_fts;
                 DROP TABLE IF EXISTS documents;
                 CREATE TABLE documents(
                   id INTEGER PRIMARY KEY,
                   path TEXT NOT NULL UNIQUE,
                   root TEXT NOT NULL,
                   name TEXT NOT NULL,
                   modified_ms INTEGER NOT NULL,
                   size INTEGER NOT NULL
                 );
                 CREATE INDEX documents_root_idx ON documents(root);
                 CREATE VIRTUAL TABLE documents_fts USING fts5(
                   name, content,
                   content='', contentless_delete=1,
                   tokenize='trigram'
                 );
                 PRAGMA user_version=2;",
            )
            .map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
    } else {
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS documents(
                   id INTEGER PRIMARY KEY,
                   path TEXT NOT NULL UNIQUE,
                   root TEXT NOT NULL,
                   name TEXT NOT NULL,
                   modified_ms INTEGER NOT NULL,
                   size INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS documents_root_idx ON documents(root);
                 CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                   name, content,
                   content='', contentless_delete=1,
                   tokenize='trigram'
                 );",
            )
            .map_err(|e| e.to_string())?;
    }
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS text_highlights(
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               path TEXT NOT NULL,
               root TEXT NOT NULL,
               quote TEXT NOT NULL,
               prefix TEXT NOT NULL,
               suffix TEXT NOT NULL,
               start_offset INTEGER NOT NULL,
               end_offset INTEGER NOT NULL,
               heading_id TEXT,
               color TEXT NOT NULL,
               created_ms INTEGER NOT NULL,
               updated_ms INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS text_highlights_path_idx ON text_highlights(path, created_ms);
             CREATE INDEX IF NOT EXISTS text_highlights_root_recent_idx ON text_highlights(root, updated_ms DESC);",
        )
        .map_err(|e| e.to_string())?;
    connection
        .pragma_update(None, "user_version", DB_SCHEMA_VERSION)
        .map_err(|e| e.to_string())?;
    Ok(connection)
}

fn sqlite_storage_bytes(path: &Path) -> u64 {
    [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ]
    .iter()
    .filter_map(|item| fs::metadata(item).ok())
    .map(|metadata| metadata.len())
    .sum()
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
}

fn ignored_name(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name.to_ascii_lowercase().as_str(),
            "node_modules" | "target" | "dist" | "build" | "__pycache__" | ".obsidian" | ".git"
        )
}

fn canonical(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    fs::canonicalize(path.as_ref())
        .map_err(|e| format!("路径不存在或无法访问：{} ({e})", path.as_ref().display()))
}

fn guarded_path(state: &AppState, path: &str) -> Result<PathBuf, String> {
    let candidate = canonical(path)?;
    let root = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    if !candidate.starts_with(&root) {
        return Err("已拒绝根目录之外的文件访问".into());
    }
    Ok(candidate)
}

fn decode_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&bytes[3..]).into_owned();
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    match String::from_utf8(bytes.to_vec()) {
        Ok(value) => value,
        Err(_) => GBK.decode(bytes).0.into_owned(),
    }
}

fn read_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取失败：{e}"))?;
    Ok(decode_text(&bytes))
}

fn to_string(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        value.into_owned()
    }
}

#[tauri::command]
fn open_target(app: AppHandle, state: State<AppState>, path: String) -> Result<OpenTarget, String> {
    let target = canonical(&path)?;
    let (root, selected_file) = if target.is_file() {
        if !is_markdown(&target) {
            return Err("首版只支持 Markdown 文件".into());
        }
        (
            target.parent().ok_or("无法确定文件所在目录")?.to_path_buf(),
            Some(to_string(&target)),
        )
    } else if target.is_dir() {
        (target, None)
    } else {
        return Err("目标不是文件或文件夹".into());
    };
    let changed = state.current_root.lock().as_ref() != Some(&root);
    if changed {
        for (label, window) in app.webview_windows() {
            if label.starts_with("reader-") {
                window.close().ok();
            }
        }
        state.window_targets.lock().clear();
        state.index_generation.fetch_add(1, Ordering::AcqRel);
        state.search_generation.fetch_add(1, Ordering::AcqRel);
    }
    *state.current_root.lock() = Some(root.clone());
    state
        .db
        .lock()
        .execute(
            "INSERT INTO recent_roots(path, opened_ms) VALUES(?1, ?2)
         ON CONFLICT(path) DO UPDATE SET opened_ms=excluded.opened_ms",
            params![to_string(&root), now_ms(SystemTime::now())],
        )
        .map_err(|e| e.to_string())?;
    Ok(OpenTarget {
        root: to_string(&root),
        selected_file,
    })
}

fn open_in_new_window_impl(app: &AppHandle, state: &AppState, path: &str) -> Result<(), String> {
    let file = guarded_path(state, path)?;
    if !file.is_file() || !is_markdown(&file) {
        return Err("只能在新窗口中打开 Markdown 文件".into());
    }
    let root = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    let target = OpenTarget {
        root: to_string(&root),
        selected_file: Some(to_string(&file)),
    };
    let label = format!(
        "reader-{}",
        READER_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    state.window_targets.lock().insert(label.clone(), target);
    let result =
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("静读 Markdown")
            .inner_size(1280.0, 820.0)
            .min_inner_size(760.0, 520.0)
            .center()
            .decorations(cfg!(target_os = "macos"))
            .build();
    if let Err(error) = result {
        state.window_targets.lock().remove(&label);
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
fn open_in_new_window(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    open_in_new_window_impl(&app, &state, &path)
}

#[tauri::command]
fn consume_window_target(
    window: tauri::WebviewWindow,
    state: State<AppState>,
) -> Option<OpenTarget> {
    state.window_targets.lock().remove(window.label())
}

#[tauri::command]
fn list_directory(state: State<AppState>, path: String) -> Result<Vec<DirectoryEntry>, String> {
    let directory = guarded_path(&state, &path)?;
    if !directory.is_dir() {
        return Err("目标不是文件夹".into());
    }
    let mut entries = Vec::new();
    for item in fs::read_dir(&directory).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let file_type = item.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        if ignored_name(&name) {
            continue;
        }
        let item_path = item.path();
        if file_type.is_dir() {
            entries.push(DirectoryEntry {
                name,
                path: to_string(&item_path),
                kind: "directory",
                has_children: true,
            });
        } else if file_type.is_file() && is_markdown(&item_path) {
            entries.push(DirectoryEntry {
                name,
                path: to_string(&item_path),
                kind: "markdown",
                has_children: false,
            });
        }
    }
    entries.sort_by(|a, b| {
        (a.kind != "directory", a.name.to_lowercase())
            .cmp(&(b.kind != "directory", b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
fn read_document(state: State<AppState>, path: String) -> Result<DocumentPayload, String> {
    let file = guarded_path(&state, &path)?;
    if !file.is_file() || !is_markdown(&file) {
        return Err("目标不是 Markdown 文件".into());
    }
    let metadata = fs::metadata(&file).map_err(|e| e.to_string())?;
    if metadata.len() > 64 * 1024 * 1024 {
        return Err("文档超过 64MB 安全上限".into());
    }
    Ok(DocumentPayload {
        path: to_string(&file),
        name: file
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        content: read_text(&file)?,
        modified_ms: metadata.modified().map(now_ms).unwrap_or_default(),
        size: metadata.len(),
    })
}

#[tauri::command]
fn read_asset(state: State<AppState>, path: String) -> Result<AssetPayload, String> {
    let file = guarded_path(&state, &path)?;
    if !file.is_file() {
        return Err("资源不存在".into());
    }
    let allowed = [
        "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
    ];
    let extension = file
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if !allowed.contains(&extension.as_str()) {
        return Err("不支持或不安全的资源类型".into());
    }
    let metadata = fs::metadata(&file).map_err(|e| e.to_string())?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("图片超过 50MB 安全上限".into());
    }
    Ok(AssetPayload {
        mime: mime_guess::from_path(&file)
            .first_or_octet_stream()
            .to_string(),
        data: fs::read(&file).map_err(|e| e.to_string())?,
    })
}

const REMOTE_IMAGE_LIMIT: usize = 20 * 1024 * 1024;
const REMOTE_IMAGE_CONCURRENCY: usize = 4;
static REMOTE_IMAGE_REQUESTS: AtomicUsize = AtomicUsize::new(0);

struct RemoteRequestSlot;

impl RemoteRequestSlot {
    fn acquire() -> Result<Self, String> {
        let result =
            REMOTE_IMAGE_REQUESTS.fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                (value < REMOTE_IMAGE_CONCURRENCY).then_some(value + 1)
            });
        result
            .map(|_| Self)
            .map_err(|_| "远程图片并发已达上限，请稍后重试".into())
    }
}

impl Drop for RemoteRequestSlot {
    fn drop(&mut self) {
        REMOTE_IMAGE_REQUESTS.fetch_sub(1, Ordering::AcqRel);
    }
}

fn is_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_unspecified())
        }
        IpAddr::V6(ip) => {
            !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local())
        }
    }
}

fn validate_remote_image_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "远程图片地址无效")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("仅允许不含凭据的 HTTP(S) 图片地址".into());
    }
    let host = url.host_str().ok_or("远程图片缺少主机名")?;
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err("不允许访问本机或私有网络图片".into());
    }
    let port = url.port_or_known_default().ok_or("远程图片端口无效")?;
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|_| "无法解析远程图片主机")?
        .collect::<Vec<_>>();
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|address| !is_public_address(address.ip()))
    {
        return Err("不允许访问本机或私有网络图片".into());
    }
    Ok(url)
}

fn sniff_remote_image_mime(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if data.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        Some("image/webp")
    } else if data.starts_with(b"BM") {
        Some("image/bmp")
    } else if data.len() >= 12
        && &data[4..8] == b"ftyp"
        && matches!(&data[8..12], b"avif" | b"avis")
    {
        Some("image/avif")
    } else {
        None
    }
}

#[tauri::command]
fn read_remote_image(url: String) -> Result<AssetPayload, String> {
    let _slot = RemoteRequestSlot::acquire()?;
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(6))
        .timeout_read(Duration::from_secs(12))
        .timeout_write(Duration::from_secs(6))
        .redirects(0)
        .build();
    let mut current = validate_remote_image_url(&url)?;
    for redirect in 0..=3 {
        let response = match agent
            .get(current.as_str())
            .set(
                "Accept",
                "image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp;q=0.9",
            )
            .set("User-Agent", "JingReader/0.5")
            .call()
        {
            Ok(response) => response,
            Err(ureq::Error::Status(301 | 302 | 303 | 307 | 308, response)) => {
                if redirect == 3 {
                    return Err("远程图片重定向次数过多".into());
                }
                let location = response
                    .header("Location")
                    .ok_or("远程图片重定向缺少目标")?;
                current = validate_remote_image_url(
                    current
                        .join(location)
                        .map_err(|_| "远程图片重定向地址无效")?
                        .as_str(),
                )?;
                continue;
            }
            Err(ureq::Error::Status(code, _)) => return Err(format!("远程图片服务器返回 {code}")),
            Err(error) => return Err(format!("远程图片请求失败：{error}")),
        };
        if response
            .header("Content-Length")
            .and_then(|value| value.parse::<usize>().ok())
            .is_some_and(|size| size > REMOTE_IMAGE_LIMIT)
        {
            return Err("远程图片超过 20MB 安全上限".into());
        }
        let mut data = Vec::new();
        response
            .into_reader()
            .take((REMOTE_IMAGE_LIMIT + 1) as u64)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        if data.len() > REMOTE_IMAGE_LIMIT {
            return Err("远程图片超过 20MB 安全上限".into());
        }
        let mime = sniff_remote_image_mime(&data).ok_or("远程资源不是受支持的安全图片格式")?;
        return Ok(AssetPayload {
            mime: mime.into(),
            data,
        });
    }
    Err("远程图片加载失败".into())
}

fn collect_markdown(root: &Path) -> Vec<PathBuf> {
    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0 || !ignored_name(&entry.file_name().to_string_lossy())
        })
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file() && is_markdown(entry.path()))
        .map(|entry| entry.into_path())
        .collect()
}

fn publish_index_status(app: &AppHandle, status: IndexStatus) {
    let state = app.state::<AppState>();
    *state.index_status.lock() = status.clone();
    app.emit("index-status", status).ok();
}

fn index_is_cancelled(state: &AppState, root: &Path, generation: u64) -> bool {
    state.index_generation.load(Ordering::Acquire) != generation
        || state.current_root.lock().as_deref() != Some(root)
}

fn clear_root_index(state: &AppState, root: &Path) -> Result<(), String> {
    let root_string = to_string(root);
    let mut connection = state.db.lock();
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    let ids: Vec<i64> = {
        let mut statement = transaction
            .prepare("SELECT id FROM documents WHERE root=?1")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![root_string], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).collect()
    };
    for id in ids {
        transaction
            .execute("DELETE FROM documents_fts WHERE rowid=?1", params![id])
            .map_err(|e| e.to_string())?;
    }
    transaction
        .execute("DELETE FROM documents WHERE root=?1", params![root_string])
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

fn index_root_sync(
    app: AppHandle,
    root: PathBuf,
    generation: u64,
    force: bool,
) -> Result<bool, String> {
    let files = collect_markdown(&root);
    let total = files.len();
    let root_string = to_string(&root);
    let state = app.state::<AppState>();
    let mut seen = HashSet::with_capacity(total);
    if force {
        clear_root_index(&state, &root)?;
    }
    publish_index_status(
        &app,
        IndexStatus {
            root: root_string.clone(),
            indexed: 0,
            total,
            running: true,
            error: None,
            phase: if force { "rebuild" } else { "index" }.into(),
            cancelled: false,
        },
    );
    for (index, file) in files.iter().enumerate() {
        if index_is_cancelled(&state, &root, generation) {
            publish_index_status(
                &app,
                IndexStatus {
                    root: root_string,
                    indexed: index,
                    total,
                    running: false,
                    error: None,
                    phase: "cancelled".into(),
                    cancelled: true,
                },
            );
            return Ok(true);
        }
        let path_string = to_string(file);
        seen.insert(path_string.clone());
        let metadata = match fs::metadata(file) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let modified = metadata.modified().map(now_ms).unwrap_or_default();
        let size = metadata.len();
        let unchanged = state
            .db
            .lock()
            .query_row(
                "SELECT 1 FROM documents WHERE path=?1 AND modified_ms=?2 AND size=?3 AND root=?4",
                params![path_string, modified, size, root_string],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .is_some();
        if !unchanged && update_index_path(&state, &root, file).is_err() {
            continue;
        }
        if index % 50 == 0 || index + 1 == total {
            publish_index_status(
                &app,
                IndexStatus {
                    root: root_string.clone(),
                    indexed: index + 1,
                    total,
                    running: true,
                    error: None,
                    phase: if force { "rebuild" } else { "index" }.into(),
                    cancelled: false,
                },
            );
        }
    }
    if index_is_cancelled(&state, &root, generation) {
        return Ok(true);
    }
    let existing: Vec<(i64, String)> = {
        let connection = state.db.lock();
        let mut statement = connection
            .prepare("SELECT id,path FROM documents WHERE root=?1")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![root_string], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).collect()
    };
    for (id, stale) in existing
        .into_iter()
        .filter(|(_, path)| !seen.contains(path))
    {
        let mut connection = state.db.lock();
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        transaction
            .execute("DELETE FROM documents_fts WHERE rowid=?1", params![id])
            .map_err(|e| e.to_string())?;
        transaction
            .execute("DELETE FROM documents WHERE path=?1", params![stale])
            .map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
    }
    publish_index_status(
        &app,
        IndexStatus {
            root: root_string,
            indexed: total,
            total,
            running: false,
            error: None,
            phase: "complete".into(),
            cancelled: false,
        },
    );
    Ok(false)
}

#[tauri::command]
async fn index_root(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
) -> Result<(), String> {
    let candidate = canonical(&root)?;
    let current = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    if candidate != current {
        return Err("索引目标不是当前根目录".into());
    }
    let generation = state.index_generation.fetch_add(1, Ordering::AcqRel) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        index_root_sync(app, candidate, generation, false)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(())
}

#[tauri::command]
fn cancel_index(app: AppHandle, state: State<AppState>) {
    state.index_generation.fetch_add(1, Ordering::AcqRel);
    let mut status = state.index_status.lock().clone();
    status.running = false;
    status.cancelled = true;
    status.phase = "cancelled".into();
    publish_index_status(&app, status);
}

#[tauri::command]
async fn rebuild_index(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
) -> Result<(), String> {
    let root = canonical(root)?;
    if state.current_root.lock().as_deref() != Some(root.as_path()) {
        return Err("重建目标不是当前根目录".into());
    }
    let generation = state.index_generation.fetch_add(1, Ordering::AcqRel) + 1;
    tauri::async_runtime::spawn_blocking(move || index_root_sync(app, root, generation, true))
        .await
        .map_err(|e| e.to_string())??;
    Ok(())
}

fn trigram_query(query: &str) -> String {
    format!("\"{}\"", query.replace('"', "\"\""))
}

fn fuzzy_filename_score(candidate: &str, query: &str) -> Option<f64> {
    let candidate = candidate.to_lowercase();
    let query = query.to_lowercase();
    if query.is_empty() {
        return None;
    }
    if let Some(position) = candidate.find(&query) {
        return Some(
            1000.0 - position as f64 - candidate.len().saturating_sub(query.len()) as f64 * 0.01,
        );
    }
    let mut cursor = 0usize;
    let mut gaps = 0usize;
    for wanted in query.chars() {
        let tail = &candidate[cursor..];
        let found = tail.find(wanted)?;
        gaps += found;
        cursor += found + wanted.len_utf8();
    }
    Some(500.0 - gaps as f64)
}

fn snippet_for_query(content: &str, query: &str) -> Option<String> {
    let position = content.find(query).or_else(|| {
        let folded_content = content.to_lowercase();
        let folded_query = query.to_lowercase();
        folded_content.find(&folded_query)
    })?;
    let mut boundaries: Vec<usize> = content.char_indices().map(|(index, _)| index).collect();
    boundaries.push(content.len());
    let match_character = boundaries.partition_point(|index| *index < position);
    let start_character = match_character.saturating_sub(48);
    let end_character = (match_character + query.chars().count() + 72).min(boundaries.len() - 1);
    let start = boundaries[start_character];
    let end = boundaries[end_character];
    let body = content[start..end]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    Some(format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        body,
        if end < content.len() { "…" } else { "" }
    ))
}

#[tauri::command]
async fn search_documents(
    app: AppHandle,
    root: String,
    query: String,
    limit: u32,
) -> Result<SearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || search_documents_sync(&app, root, query, limit))
        .await
        .map_err(|error| error.to_string())?
}

fn search_documents_sync(
    app: &AppHandle,
    root: String,
    query: String,
    limit: u32,
) -> Result<SearchResponse, String> {
    let state = app.state::<AppState>();
    let root = canonical(root)?;
    let current = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    if root != current {
        return Err("搜索目标不是当前根目录".into());
    }
    let query = query.trim().to_owned();
    if query.is_empty() {
        return Ok(SearchResponse {
            results: Vec::new(),
            partial: false,
            mode: "empty".into(),
        });
    }
    let generation = state.search_generation.fetch_add(1, Ordering::AcqRel) + 1;
    let limit = limit.min(100) as usize;
    let root_string = to_string(&root);
    let connection = state.db.lock();
    let candidates: Vec<(String, String)> = {
        let mut statement = connection
            .prepare("SELECT path,name FROM documents WHERE root=?1")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![root_string], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).collect()
    };
    let mut filename_matches = Vec::new();
    for (path, name) in &candidates {
        if let Some(score) = fuzzy_filename_score(name, &query) {
            filename_matches.push(SearchResult {
                path: path.to_owned(),
                name: name.to_owned(),
                snippet: "文件名匹配".into(),
                score,
            });
        }
    }
    filename_matches.sort_by(|a, b| b.score.total_cmp(&a.score));

    let query_characters = query
        .chars()
        .filter(|character| !character.is_whitespace())
        .count();
    let mut content_candidates: Vec<(String, String, f64)> = Vec::new();
    let mode = if query_characters >= 3 {
        let mut statement = connection
            .prepare(
                "SELECT documents.path,documents.name,bm25(documents_fts)
                 FROM documents_fts JOIN documents ON documents.id=documents_fts.rowid
                 WHERE documents_fts MATCH ?1 AND documents.root=?2
                 ORDER BY bm25(documents_fts) LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![trigram_query(&query), root_string, limit], |row| {
                Ok((row.get(0)?, row.get(1)?, -row.get::<_, f64>(2)?))
            })
            .map_err(|e| e.to_string())?;
        content_candidates.extend(rows.filter_map(Result::ok));
        "index"
    } else {
        content_candidates.extend(
            candidates
                .iter()
                .map(|(path, name)| (path.clone(), name.clone(), 0.0)),
        );
        "scan"
    };
    drop(connection);
    let partial = state.index_status.lock().running;
    let mut results = Vec::new();
    for (path, name, score) in content_candidates {
        if state.search_generation.load(Ordering::Acquire) != generation {
            break;
        }
        let Ok(content) = read_text(Path::new(&path)) else {
            continue;
        };
        if let Some(snippet) = snippet_for_query(&content, &query) {
            results.push(SearchResult {
                path,
                name,
                snippet,
                score,
            });
        }
        if mode == "scan" && results.len() >= limit {
            break;
        }
    }
    let mut seen: HashSet<String> = filename_matches
        .iter()
        .map(|item| item.path.clone())
        .collect();
    filename_matches.extend(
        results
            .drain(..)
            .filter(|item| seen.insert(item.path.clone())),
    );
    filename_matches.truncate(limit);
    Ok(SearchResponse {
        results: filename_matches,
        partial,
        mode: mode.into(),
    })
}

fn update_index_path(state: &AppState, root: &Path, path: &Path) -> Result<(), String> {
    let root_string = to_string(root);
    let path_string = to_string(path);
    let document = if path.is_file() && is_markdown(path) {
        let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
        let content = read_text(path)?;
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        Some((metadata, content, name))
    } else {
        None
    };
    let mut connection = state.db.lock();
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    let existing_id: Option<i64> = transaction
        .query_row(
            "SELECT id FROM documents WHERE path=?1",
            params![path_string],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((metadata, content, name)) = document {
        transaction
            .execute(
                "INSERT INTO documents(path,root,name,modified_ms,size) VALUES(?1,?2,?3,?4,?5)
                 ON CONFLICT(path) DO UPDATE SET root=excluded.root,name=excluded.name,modified_ms=excluded.modified_ms,size=excluded.size",
                params![path_string, root_string, name, metadata.modified().map(now_ms).unwrap_or_default(), metadata.len()],
            )
            .map_err(|e| e.to_string())?;
        let id: i64 = transaction
            .query_row(
                "SELECT id FROM documents WHERE path=?1",
                params![path_string],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        transaction
            .execute(
                "INSERT OR REPLACE INTO documents_fts(rowid,name,content) VALUES(?1,?2,?3)",
                params![id, name, content],
            )
            .map_err(|e| e.to_string())?;
    } else {
        if let Some(id) = existing_id {
            transaction
                .execute("DELETE FROM documents_fts WHERE rowid=?1", params![id])
                .map_err(|e| e.to_string())?;
        }
        transaction
            .execute("DELETE FROM documents WHERE path=?1", params![path_string])
            .map_err(|e| e.to_string())?;
    }
    transaction.commit().map_err(|e| e.to_string())
}

fn ignored_watch_path(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).ok().is_none_or(|relative| {
        relative
            .components()
            .any(|component| ignored_name(&component.as_os_str().to_string_lossy()))
    })
}

fn apply_watch_batch(
    app: &AppHandle,
    root: &Path,
    pending: &HashMap<PathBuf, String>,
    reconcile: bool,
) {
    let state = app.state::<AppState>();
    if state.current_root.lock().as_deref() != Some(root) {
        return;
    }
    if reconcile {
        let generation = state.index_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let _ = index_root_sync(app.clone(), root.to_path_buf(), generation, false);
        app.emit("tree-changed", to_string(root)).ok();
        return;
    }
    for (path, kind) in pending {
        let mut updated = false;
        for attempt in 0..3 {
            if update_index_path(&state, root, path).is_ok() {
                updated = true;
                break;
            }
            if attempt < 2 {
                thread::sleep(Duration::from_millis(80 * (attempt + 1)));
            }
        }
        if updated {
            app.emit(
                "external-change",
                ExternalChangeEvent {
                    path: to_string(path),
                    kind: kind.clone(),
                },
            )
            .ok();
        }
    }
    if !pending.is_empty() {
        app.emit("tree-changed", to_string(root)).ok();
    }
}

fn queue_watch_event(
    root: &Path,
    event: Event,
    pending: &mut HashMap<PathBuf, String>,
    reconcile: &mut bool,
) {
    let kind = format!("{:?}", event.kind);
    for path in event.paths {
        if ignored_watch_path(root, &path) {
            continue;
        }
        if is_markdown(&path) {
            pending.insert(path, kind.clone());
        } else if path.is_dir()
            || (!path.exists() && (kind.contains("Remove") || kind.contains("Name")))
        {
            *reconcile = true;
        }
    }
}

#[tauri::command]
fn start_watch(app: AppHandle, state: State<AppState>, root: String) -> Result<(), String> {
    let root = canonical(root)?;
    let current = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    if root != current {
        return Err("监听目标不是当前根目录".into());
    }
    let watched_root = root.clone();
    let (sender, receiver) = mpsc::channel::<Event>();
    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            if let Ok(event) = result {
                sender.send(event).ok();
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    *state.watcher.lock() = Some(watcher);
    thread::spawn(move || {
        let mut pending = HashMap::new();
        let mut reconcile = false;
        loop {
            match receiver.recv_timeout(Duration::from_millis(400)) {
                Ok(event) => queue_watch_event(&watched_root, event, &mut pending, &mut reconcile),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() || reconcile {
                        apply_watch_batch(&app, &watched_root, &pending, reconcile);
                        pending.clear();
                        reconcile = false;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if !pending.is_empty() || reconcile {
                        apply_watch_batch(&app, &watched_root, &pending, reconcile);
                    }
                    break;
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn load_expanded_paths(state: State<AppState>, root: String) -> Result<Vec<String>, String> {
    let root = canonical(root)?;
    let current = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    if root != current {
        return Err("展开状态目标不是当前根目录".into());
    }
    let connection = state.db.lock();
    let mut statement = connection
        .prepare("SELECT path FROM expanded_nodes WHERE root=?1")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![to_string(&root)], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command]
fn set_path_expanded(state: State<AppState>, path: String, expanded: bool) -> Result<(), String> {
    let path = guarded_path(&state, &path)?;
    if !path.is_dir() {
        return Err("展开状态只能用于文件夹".into());
    }
    let root = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    if expanded {
        state
            .db
            .lock()
            .execute(
                "INSERT INTO expanded_nodes(path,root) VALUES(?1,?2) ON CONFLICT(path) DO UPDATE SET root=excluded.root",
                params![to_string(&path), to_string(&root)],
            )
            .map_err(|e| e.to_string())?;
    } else {
        state
            .db
            .lock()
            .execute(
                "DELETE FROM expanded_nodes WHERE path=?1",
                params![to_string(&path)],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_reading_position(state: State<AppState>, position: ReadingPosition) -> Result<(), String> {
    let path = guarded_path(&state, &position.path)?;
    state.db.lock().execute(
        "INSERT INTO reading_positions(path,heading_id,heading_ratio,document_ratio,updated_ms) VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(path) DO UPDATE SET heading_id=excluded.heading_id,heading_ratio=excluded.heading_ratio,document_ratio=excluded.document_ratio,updated_ms=excluded.updated_ms",
        params![to_string(&path), position.heading_id, position.heading_ratio.clamp(0.0, 1.0), position.document_ratio.clamp(0.0, 1.0), now_ms(SystemTime::now())]
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_reading_position(
    state: State<AppState>,
    path: String,
) -> Result<Option<ReadingPosition>, String> {
    let path = guarded_path(&state, &path)?;
    state
        .db
        .lock()
        .query_row(
            "SELECT heading_id,heading_ratio,document_ratio FROM reading_positions WHERE path=?1",
            params![to_string(&path)],
            |row| {
                Ok(ReadingPosition {
                    path: to_string(&path),
                    heading_id: row.get(0)?,
                    heading_ratio: row.get(1)?,
                    document_ratio: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
}

fn valid_highlight_color(color: &str) -> bool {
    matches!(color, "yellow" | "green" | "blue" | "pink")
}

fn validate_highlight_draft(highlight: &NewTextHighlight) -> Result<(), String> {
    if highlight.quote.trim().is_empty() || highlight.quote.chars().count() > 5_000 {
        return Err("高亮文本必须为 1–5000 个字符".into());
    }
    if highlight.prefix.chars().count() > 160 || highlight.suffix.chars().count() > 160 {
        return Err("高亮上下文过长".into());
    }
    if highlight.end_offset <= highlight.start_offset {
        return Err("高亮范围无效".into());
    }
    if !valid_highlight_color(&highlight.color) {
        return Err("不支持的高亮颜色".into());
    }
    Ok(())
}

fn highlight_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TextHighlight> {
    Ok(TextHighlight {
        id: row.get(0)?,
        path: row.get(1)?,
        root: row.get(2)?,
        quote: row.get(3)?,
        prefix: row.get(4)?,
        suffix: row.get(5)?,
        start_offset: row.get::<_, i64>(6)?.max(0) as usize,
        end_offset: row.get::<_, i64>(7)?.max(0) as usize,
        heading_id: row.get(8)?,
        color: row.get(9)?,
        created_ms: row.get(10)?,
        updated_ms: row.get(11)?,
    })
}

const HIGHLIGHT_COLUMNS: &str =
    "id,path,root,quote,prefix,suffix,start_offset,end_offset,heading_id,color,created_ms,updated_ms";

#[tauri::command]
fn list_document_highlights(
    state: State<AppState>,
    path: String,
) -> Result<Vec<TextHighlight>, String> {
    let path = guarded_path(&state, &path)?;
    let connection = state.db.lock();
    let sql = format!(
        "SELECT {HIGHLIGHT_COLUMNS} FROM text_highlights WHERE path=?1 ORDER BY start_offset, created_ms"
    );
    let mut statement = connection.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![to_string(&path)], highlight_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_recent_highlights(
    state: State<AppState>,
    limit: Option<usize>,
) -> Result<Vec<TextHighlight>, String> {
    let root = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    let connection = state.db.lock();
    let sql = format!(
        "SELECT {HIGHLIGHT_COLUMNS} FROM text_highlights WHERE root=?1 ORDER BY updated_ms DESC LIMIT ?2"
    );
    let mut statement = connection.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(
            params![to_string(&root), limit.unwrap_or(80).clamp(1, 200)],
            highlight_from_row,
        )
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn create_text_highlight(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<AppState>,
    highlight: NewTextHighlight,
) -> Result<TextHighlight, String> {
    validate_highlight_draft(&highlight)?;
    let path = guarded_path(&state, &highlight.path)?;
    if !path.is_file() || !is_markdown(&path) {
        return Err("只能在 Markdown 文档中创建高亮".into());
    }
    let root = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    let timestamp = now_ms(SystemTime::now());
    let path_string = to_string(&path);
    let root_string = to_string(&root);
    let connection = state.db.lock();
    connection
        .execute(
            "INSERT INTO text_highlights(path,root,quote,prefix,suffix,start_offset,end_offset,heading_id,color,created_ms,updated_ms)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
            params![path_string, root_string, highlight.quote, highlight.prefix, highlight.suffix,
                highlight.start_offset as i64, highlight.end_offset as i64, highlight.heading_id, highlight.color, timestamp],
        )
        .map_err(|e| e.to_string())?;
    let id = connection.last_insert_rowid();
    let sql = format!("SELECT {HIGHLIGHT_COLUMNS} FROM text_highlights WHERE id=?1");
    let created = connection
        .query_row(&sql, params![id], highlight_from_row)
        .map_err(|e| e.to_string())?;
    drop(connection);
    app.emit(
        "highlights-updated",
        HighlightsChanged {
            path: path_string,
            source: window.label().to_owned(),
        },
    )
    .ok();
    Ok(created)
}

#[tauri::command]
fn update_text_highlight_color(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<AppState>,
    id: i64,
    color: String,
) -> Result<(), String> {
    if !valid_highlight_color(&color) {
        return Err("不支持的高亮颜色".into());
    }
    let root = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    let root_string = to_string(&root);
    let connection = state.db.lock();
    let path: String = connection
        .query_row(
            "SELECT path FROM text_highlights WHERE id=?1 AND root=?2",
            params![id, root_string],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("高亮不存在或不属于当前目录")?;
    connection
        .execute(
            "UPDATE text_highlights SET color=?1,updated_ms=?2 WHERE id=?3 AND root=?4",
            params![color, now_ms(SystemTime::now()), id, root_string],
        )
        .map_err(|e| e.to_string())?;
    drop(connection);
    app.emit(
        "highlights-updated",
        HighlightsChanged {
            path,
            source: window.label().to_owned(),
        },
    )
    .ok();
    Ok(())
}

#[tauri::command]
fn delete_text_highlight(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<AppState>,
    id: i64,
) -> Result<(), String> {
    let root = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    let root_string = to_string(&root);
    let connection = state.db.lock();
    let path: String = connection
        .query_row(
            "SELECT path FROM text_highlights WHERE id=?1 AND root=?2",
            params![id, root_string],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("高亮不存在或不属于当前目录")?;
    connection
        .execute(
            "DELETE FROM text_highlights WHERE id=?1 AND root=?2",
            params![id, root_string],
        )
        .map_err(|e| e.to_string())?;
    drop(connection);
    app.emit(
        "highlights-updated",
        HighlightsChanged {
            path,
            source: window.label().to_owned(),
        },
    )
    .ok();
    Ok(())
}

#[tauri::command]
fn clear_root_highlights(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<AppState>,
) -> Result<usize, String> {
    let root = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    let removed = state
        .db
        .lock()
        .execute(
            "DELETE FROM text_highlights WHERE root=?1",
            params![to_string(&root)],
        )
        .map_err(|e| e.to_string())?;
    app.emit(
        "highlights-updated",
        HighlightsChanged {
            path: "*".into(),
            source: window.label().to_owned(),
        },
    )
    .ok();
    Ok(removed)
}

#[tauri::command]
fn load_preferences(state: State<AppState>) -> Result<Option<ReaderPreferences>, String> {
    if !state.preferences_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&state.preferences_path).map_err(|e| e.to_string())?;
    let backup = state.preferences_path.with_extension("legacy.json");
    let raw = serde_json::from_str::<serde_json::Value>(&content).ok();
    let valid_v2 = raw.as_ref().is_some_and(|value| {
        value.get("schemaVersion").and_then(|item| item.as_u64()) == Some(2)
            && matches!(value.get("styleMode").and_then(|item| item.as_str()), Some("canonical" | "legacy"))
            && matches!(value.get("typographyProfile").and_then(|item| item.as_str()), Some("reading" | "study"))
            && matches!(value.get("appearance").and_then(|item| item.as_str()), Some("warm" | "white" | "night" | "nord"))
            && matches!(value.get("theme").and_then(|item| item.as_str()), Some("paper" | "humanist" | "chinese" | "editorial" | "swiss" | "modern-textbook" | "solarized" | "night" | "nord" | "eink" | "technical"))
    });
    if !valid_v2 && !backup.exists() {
        fs::copy(&state.preferences_path, &backup).map_err(|e| e.to_string())?;
    }
    Ok(serde_json::from_str(&content).ok())
}

#[tauri::command]
fn save_preferences(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<AppState>,
    preferences: ReaderPreferences,
) -> Result<(), String> {
    let temporary = state.preferences_path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&preferences).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(&temporary, &state.preferences_path).map_err(|e| e.to_string())?;
    app.emit(
        "preferences-updated",
        PreferencesChanged {
            source: window.label().to_owned(),
            preferences,
        },
    )
    .ok();
    Ok(())
}

#[tauri::command]
fn list_recent_roots(state: State<AppState>, limit: u32) -> Result<Vec<RecentRoot>, String> {
    let connection = state.db.lock();
    let mut statement = connection
        .prepare("SELECT path,opened_ms FROM recent_roots ORDER BY opened_ms DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![limit.clamp(1, 20)], |row| {
            Ok(RecentRoot {
                path: row.get(0)?,
                opened_ms: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

#[tauri::command]
fn get_index_diagnostics(state: State<AppState>) -> Result<IndexDiagnostics, String> {
    let current_root = state.current_root.lock().clone();
    let connection = state.db.lock();
    let schema_version = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let indexed_documents = connection
        .query_row("SELECT count(*) FROM documents", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let indexed_roots = connection
        .query_row("SELECT count(DISTINCT root) FROM documents", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    let highlight_count = if let Some(root) = &current_root {
        connection
            .query_row(
                "SELECT count(*) FROM text_highlights WHERE root=?1",
                params![to_string(root)],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?
    } else {
        0
    };
    let raw_content_tables: u64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='documents_fts_content'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    drop(connection);
    Ok(IndexDiagnostics {
        schema_version,
        database_bytes: sqlite_storage_bytes(&state.db_path),
        indexed_documents,
        indexed_roots,
        highlight_count,
        stores_raw_content: raw_content_tables > 0,
        current_root: current_root.as_deref().map(to_string),
        status: state.index_status.lock().clone(),
    })
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn collect_font_family(
    logfont: *const windows_sys::Win32::Graphics::Gdi::LOGFONTW,
    _metric: *const windows_sys::Win32::Graphics::Gdi::TEXTMETRICW,
    _font_type: u32,
    data: isize,
) -> i32 {
    if logfont.is_null() || data == 0 {
        return 1;
    }
    let names = &mut *(data as *mut Vec<String>);
    let face = &(*logfont).lfFaceName;
    let length = face
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(face.len());
    let name = String::from_utf16_lossy(&face[..length]).trim().to_owned();
    if !name.is_empty() && !name.starts_with('@') {
        names.push(name);
    }
    1
}

#[tauri::command]
#[cfg(target_os = "windows")]
fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    use windows_sys::Win32::Graphics::Gdi::{
        CreateFontW, DeleteObject, EnumFontFamiliesExW, GetDC, GetGlyphIndicesW, ReleaseDC,
        SelectObject, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DEFAULT_PITCH, DEFAULT_QUALITY,
        FF_DONTCARE, FW_NORMAL, GDI_ERROR, GGI_MARK_NONEXISTING_GLYPHS, LOGFONTW,
        OUT_DEFAULT_PRECIS,
    };

    unsafe fn supports_sample(
        device: windows_sys::Win32::Graphics::Gdi::HDC,
        family: &str,
        sample: &str,
        minimum: usize,
    ) -> bool {
        let face: Vec<u16> = family.encode_utf16().chain(Some(0)).collect();
        let font = CreateFontW(
            -16,
            0,
            0,
            0,
            FW_NORMAL as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET as u32,
            OUT_DEFAULT_PRECIS as u32,
            CLIP_DEFAULT_PRECIS as u32,
            DEFAULT_QUALITY as u32,
            (DEFAULT_PITCH | FF_DONTCARE) as u32,
            face.as_ptr(),
        );
        if font.is_null() {
            return false;
        }
        let previous = SelectObject(device, font);
        let text: Vec<u16> = sample.encode_utf16().collect();
        let mut glyphs = vec![0xffff; text.len()];
        let result = GetGlyphIndicesW(
            device,
            text.as_ptr(),
            text.len() as i32,
            glyphs.as_mut_ptr(),
            GGI_MARK_NONEXISTING_GLYPHS,
        );
        if !previous.is_null() {
            SelectObject(device, previous);
        }
        DeleteObject(font);
        result != GDI_ERROR as u32
            && glyphs.iter().filter(|glyph| **glyph != 0xffff).count() >= minimum
    }

    let device = unsafe { GetDC(std::ptr::null_mut()) };
    if device.is_null() {
        return Err("无法访问 Windows 系统字体库".into());
    }

    let mut request: LOGFONTW = unsafe { std::mem::zeroed() };
    request.lfCharSet = DEFAULT_CHARSET;
    let mut names: Vec<String> = Vec::new();
    unsafe {
        EnumFontFamiliesExW(
            device,
            &request,
            Some(collect_font_family),
            &mut names as *mut Vec<String> as isize,
            0,
        );
    }

    names.sort_by_key(|name| name.to_lowercase());
    names.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    let fonts: Vec<SystemFont> = names
        .into_iter()
        .map(|family| {
            let supports_cjk = unsafe { supports_sample(device, &family, "中文阅读漢字", 4) };
            let supports_latin = unsafe { supports_sample(device, &family, "AaZz09", 6) };
            SystemFont {
                family,
                supports_cjk,
                supports_latin,
            }
        })
        .collect();
    unsafe {
        ReleaseDC(std::ptr::null_mut(), device);
    }
    Ok(fonts)
}

#[tauri::command]
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    Ok(Vec::new())
}

#[tauri::command]
#[cfg(target_os = "macos")]
fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    use core_text::{font, font_collection};
    fn supports(font: &font::CTFont, sample: &str, minimum: usize) -> bool {
        let characters: Vec<u16> = sample.encode_utf16().collect();
        let mut glyphs = vec![0; characters.len()];
        // Both buffers have exactly count elements and live across the Core Text call.
        unsafe {
            font.get_glyphs_for_characters(
                characters.as_ptr(),
                glyphs.as_mut_ptr(),
                characters.len() as _,
            );
        }
        glyphs.iter().filter(|glyph| **glyph != 0).count() >= minimum
    }
    let mut fonts = Vec::new();
    for name in font_collection::get_family_names().iter() {
        let family = name.to_string();
        if family.starts_with('.') {
            continue;
        }
        if let Ok(face) = font::new_from_name(&family, 16.0) {
            fonts.push(SystemFont {
                supports_cjk: supports(&face, "中文阅读漢字", 4),
                supports_latin: supports(&face, "AaZz09", 6),
                family,
            });
        }
    }
    fonts.sort_by_key(|font| font.family.to_lowercase());
    fonts.dedup_by(|a, b| a.family.eq_ignore_ascii_case(&b.family));
    Ok(fonts)
}

#[cfg(not(target_os = "windows"))]
fn shell_open(path: &Path) -> Result<(), String> {
    // TextEdit avoids reopening this app when JingReader is the default Markdown viewer.
    #[cfg(target_os = "macos")]
    let result = Command::new("/usr/bin/open")
        .args(["-a", "TextEdit"])
        .arg(path)
        .status();
    #[cfg(not(target_os = "macos"))]
    let result = Command::new("xdg-open").arg(path).status();
    match result {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("外部应用打开失败：{status}")),
        Err(error) => Err(format!("无法启动外部应用：{error}")),
    }
}

#[cfg(target_os = "windows")]
fn shell_open(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{UI::Shell::ShellExecuteW, UI::WindowsAndMessaging::SW_SHOWNORMAL};
    let operation: Vec<u16> = OsStr::new("open").encode_wide().chain(Some(0)).collect();
    let file: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if result <= 32 {
        Err(format!("系统无法打开文件（错误码 {result}）"))
    } else {
        Ok(())
    }
}

#[tauri::command]
fn open_external(state: State<AppState>, path: String, editor: String) -> Result<(), String> {
    let path = guarded_path(&state, &path)?;
    if editor == "vscode" {
        #[cfg(target_os = "macos")]
        {
            let status = Command::new("/usr/bin/open")
                .args(["-b", "com.microsoft.VSCode"])
                .arg(&path)
                .status()
                .map_err(|error| format!("无法启动 VS Code：{error}"))?;
            if status.success() {
                Ok(())
            } else {
                Err("未找到 VS Code，请先安装该应用".into())
            }
        }
        #[cfg(not(target_os = "macos"))]
        Command::new("code")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|_| "未找到 VS Code 的 code 命令，请确认它已加入 PATH".into())
    } else {
        shell_open(&path)
    }
}

#[tauri::command]
fn print_document(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|error| error.to_string())
}

#[tauri::command]
fn consume_startup_target(state: State<AppState>) -> Option<String> {
    let mut startup = state.startup_target.lock();
    startup.frontend_ready = true;
    if let Some(target) = startup.path.take() {
        return Some(target);
    }
    drop(startup);
    state
        .db
        .lock()
        .query_row(
            "SELECT path FROM recent_roots ORDER BY opened_ms DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten()
}

fn first_path_argument(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && Path::new(arg).exists())
        .cloned()
}

fn requests_new_window(args: &[String]) -> bool {
    args.iter().skip(1).any(|arg| arg == "--new-window")
}

// Finder can deliver an open event before the webview has registered its listener.
fn dispatch_open_target(app: &AppHandle, path: String) {
    let state = app.state::<AppState>();
    let mut startup = state.startup_target.lock();
    if startup.frontend_ready {
        app.emit_to("main", "open-target-argument", path).ok();
    } else {
        startup.path = Some(path);
    }
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize().ok();
        window.show().ok();
        window.set_focus().ok();
    }
}

#[cfg(target_os = "windows")]
fn is_managed_windows_install(executable: &Path, local_app_data: &Path) -> bool {
    let Some(parent) = executable.parent() else {
        return false;
    };
    parent
        .to_string_lossy()
        .eq_ignore_ascii_case(&local_app_data.join("JingReader").to_string_lossy())
}

#[cfg(target_os = "windows")]
fn repair_installed_context_menu() -> Result<(), String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or("LOCALAPPDATA 不可用")?;
    if !is_managed_windows_install(&executable, &local_app_data) {
        return Ok(());
    }

    let executable = executable.to_string_lossy();
    let icon = format!("\"{executable}\"");
    let current_user = RegKey::predef(HKEY_CURRENT_USER);
    for (key_path, argument) in [
        ("Software\\Classes\\Directory\\shell\\JingReader", "%1"),
        (
            "Software\\Classes\\Directory\\Background\\shell\\JingReader",
            "%V",
        ),
        (
            "Software\\Classes\\SystemFileAssociations\\.md\\shell\\JingReader",
            "%1",
        ),
    ] {
        let (key, _) = current_user
            .create_subkey(key_path)
            .map_err(|error| error.to_string())?;
        key.set_value("", &"使用静读 Markdown 打开")
            .map_err(|error| error.to_string())?;
        key.set_value("Icon", &icon)
            .map_err(|error| error.to_string())?;
        let (command, _) = key
            .create_subkey("command")
            .map_err(|error| error.to_string())?;
        command
            .set_value("", &format!("\"{executable}\" \"{argument}\""))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = first_path_argument(&args) {
                if requests_new_window(&args) {
                    let state = app.state::<AppState>();
                    if open_in_new_window_impl(app, &state, &path).is_err() {
                        dispatch_open_target(app, path);
                    }
                } else {
                    dispatch_open_target(app, path);
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                window.show().ok();
                window.set_focus().ok();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|_window, _event| {
            #[cfg(target_os = "macos")]
            if _window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                    // Keep the main webview/state for Dock reopen and Finder open events.
                    api.prevent_close();
                    _window.hide().ok();
                }
            }
        })
        .setup(|app| {
            #[cfg(target_os = "windows")]
            repair_installed_context_menu().ok();
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("jingreader.sqlite3");
            let db = init_db(&db_path).map_err(std::io::Error::other)?;
            let startup_target = first_path_argument(&std::env::args().collect::<Vec<_>>());
            app.manage(AppState {
                current_root: Mutex::new(None),
                db: Mutex::new(db),
                watcher: Mutex::new(None),
                preferences_path: data_dir.join("settings.json"),
                db_path,
                startup_target: Mutex::new(StartupTarget {
                    path: startup_target,
                    frontend_ready: false,
                }),
                window_targets: Mutex::new(HashMap::new()),
                index_generation: AtomicU64::new(0),
                search_generation: AtomicU64::new(0),
                index_status: Mutex::new(IndexStatus::default()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_target,
            open_in_new_window,
            consume_window_target,
            list_directory,
            read_document,
            read_asset,
            read_remote_image,
            index_root,
            rebuild_index,
            cancel_index,
            search_documents,
            start_watch,
            load_expanded_paths,
            set_path_expanded,
            save_reading_position,
            get_reading_position,
            list_document_highlights,
            list_recent_highlights,
            create_text_highlight,
            update_text_highlight_color,
            delete_text_highlight,
            clear_root_highlights,
            load_preferences,
            save_preferences,
            list_recent_roots,
            get_index_diagnostics,
            list_system_fonts,
            open_external,
            print_document,
            consume_startup_target
        ])
        .build(tauri::generate_context!())
        .expect("启动静读 Markdown 失败")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            match _event {
                tauri::RunEvent::Opened { urls } => {
                    // The reader has a single-root model; open the first local document.
                    if let Some(path) = urls.iter().find_map(|url| url.to_file_path().ok()) {
                        dispatch_open_target(_app, to_string(&path));
                    }
                }
                tauri::RunEvent::Reopen { .. } => {
                    if let Some(window) = _app.get_webview_window("main") {
                        window.unminimize().ok();
                        window.show().ok();
                        window.set_focus().ok();
                    }
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn platform_bundle_configs_match_tauri_schema() {
        for overlay in [
            include_str!("../tauri.macos.conf.json"),
            include_str!("../tauri.windows.conf.json"),
        ] {
            let mut config: serde_json::Value =
                serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
            let overlay: serde_json::Value = serde_json::from_str(overlay).unwrap();
            for section in ["app", "bundle"] {
                if let Some(values) = overlay[section].as_object() {
                    for (key, value) in values {
                        config[section][key] = value.clone();
                    }
                }
            }
            serde_json::from_value::<tauri::Config>(config).unwrap();
        }
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn enumerates_macos_font_families_and_glyph_coverage() {
        let fonts = list_system_fonts().unwrap();
        assert!(fonts.len() > 10);
        assert!(fonts.iter().any(|font| font.supports_latin));
        assert!(fonts.iter().any(|font| font.supports_cjk));
    }

    #[cfg(unix)]
    #[test]
    fn finder_urls_preserve_unicode_and_spaces() {
        let path = Path::new("/Users/reader/中文 资料/第一篇.md");
        let url = Url::from_file_path(path).unwrap();
        assert_eq!(url.to_file_path().unwrap(), path);
        assert_eq!(to_string(path), "/Users/reader/中文 资料/第一篇.md");
    }
    #[test]
    fn detects_markdown_extensions() {
        assert!(is_markdown(Path::new("README.MD")));
        assert!(is_markdown(Path::new("notes.markdown")));
        assert!(!is_markdown(Path::new("notes.txt")));
    }
    #[test]
    #[cfg(target_os = "windows")]
    fn only_managed_install_location_repairs_context_menu() {
        let local = Path::new(r"C:\Users\reader\AppData\Local");
        assert!(is_managed_windows_install(
            Path::new(r"C:\Users\reader\AppData\Local\JingReader\JingReader.exe"),
            local
        ));
        assert!(!is_managed_windows_install(
            Path::new(r"D:\Portable\JingReader-Portable.exe"),
            local
        ));
    }
    #[test]
    fn remote_images_reject_private_networks_and_credentials() {
        assert!(validate_remote_image_url("http://127.0.0.1/private.png").is_err());
        assert!(validate_remote_image_url("http://[::1]/private.png").is_err());
        assert!(validate_remote_image_url("https://user:secret@example.com/image.png").is_err());
        assert!(validate_remote_image_url("file:///C:/secret.png").is_err());
    }
    #[test]
    fn remote_image_mime_comes_from_magic_bytes() {
        assert_eq!(
            sniff_remote_image_mime(b"\x89PNG\r\n\x1a\nrest"),
            Some("image/png")
        );
        assert_eq!(sniff_remote_image_mime(b"GIF89a-data"), Some("image/gif"));
        assert_eq!(sniff_remote_image_mime(b"<svg><script/></svg>"), None);
        assert_eq!(sniff_remote_image_mime(b"not an image"), None);
    }
    #[test]
    fn ignores_cache_and_hidden_directories() {
        assert!(ignored_name(".git"));
        assert!(ignored_name("node_modules"));
        assert!(!ignored_name("学习笔记"));
    }
    #[test]
    fn decodes_utf8_and_utf16() {
        assert_eq!(decode_text("中文".as_bytes()), "中文");
        assert_eq!(decode_text(&[0xFF, 0xFE, 0x2D, 0x4E]), "中");
    }
    #[test]
    fn creates_safe_trigram_query() {
        assert_eq!(trigram_query("长文 \"阅读\""), "\"长文 \"\"阅读\"\"\"");
    }
    #[test]
    fn contentless_trigram_index_matches_chinese_substrings() {
        let path = std::env::temp_dir().join(format!(
            "jingreader-index-test-{}-{}.sqlite3",
            std::process::id(),
            now_ms(SystemTime::now())
        ));
        let connection = init_db(&path).unwrap();
        connection
            .execute(
                "INSERT INTO documents(path,root,name,modified_ms,size) VALUES('a.md','root','a.md',0,1)",
                [],
            )
            .unwrap();
        let id = connection.last_insert_rowid();
        connection
            .execute(
                "INSERT INTO documents_fts(rowid,name,content) VALUES(?1,'a.md','机器学习方法')",
                params![id],
            )
            .unwrap();
        let matches: u64 = connection
            .query_row(
                "SELECT count(*) FROM documents_fts WHERE documents_fts MATCH ?1",
                params![trigram_query("机器学习")],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(matches, 1);
        assert!(!connection
            .prepare("PRAGMA table_info(documents)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .any(|column| column == "content"));
        let raw_content_table: u64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='documents_fts_content'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(raw_content_table, 0);
        drop(connection);
        let _ = fs::remove_file(path);
    }
    #[test]
    fn v2_migration_removes_cached_body_but_preserves_reader_state() {
        let path = std::env::temp_dir().join(format!(
            "jingreader-migration-test-{}-{}.sqlite3",
            std::process::id(),
            now_ms(SystemTime::now())
        ));
        {
            let connection = Connection::open(&path).unwrap();
            connection.execute_batch(
                "CREATE TABLE documents(id INTEGER PRIMARY KEY,path TEXT UNIQUE,root TEXT,name TEXT,content TEXT,modified_ms INTEGER,size INTEGER);
                 CREATE VIRTUAL TABLE documents_fts USING fts5(name,content);
                 CREATE TABLE reading_positions(path TEXT PRIMARY KEY,heading_id TEXT,heading_ratio REAL NOT NULL,document_ratio REAL NOT NULL,updated_ms INTEGER NOT NULL);
                 CREATE TABLE recent_roots(path TEXT PRIMARY KEY,opened_ms INTEGER NOT NULL);
                 CREATE TABLE expanded_nodes(path TEXT PRIMARY KEY,root TEXT NOT NULL);
                 INSERT INTO documents(path,root,name,content,modified_ms,size) VALUES('secret.md','root','secret.md','private body',0,12);
                 INSERT INTO documents_fts(name,content) VALUES('secret.md','private body');
                 INSERT INTO reading_positions VALUES('secret.md','chapter',0.4,0.6,1);
                 INSERT INTO recent_roots VALUES('root',2);
                 INSERT INTO expanded_nodes VALUES('root/sub','root');
                 PRAGMA user_version=1;"
            ).unwrap();
        }
        let connection = init_db(&path).unwrap();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        let positions: u64 = connection
            .query_row("SELECT count(*) FROM reading_positions", [], |row| {
                row.get(0)
            })
            .unwrap();
        let recents: u64 = connection
            .query_row("SELECT count(*) FROM recent_roots", [], |row| row.get(0))
            .unwrap();
        let expanded: u64 = connection
            .query_row("SELECT count(*) FROM expanded_nodes", [], |row| row.get(0))
            .unwrap();
        let raw_shadow: u64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name='documents_fts_content'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let highlights_table: u64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='text_highlights'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, DB_SCHEMA_VERSION);
        assert_eq!((positions, recents, expanded), (1, 1, 1));
        assert_eq!(raw_shadow, 0);
        assert_eq!(highlights_table, 1);
        assert!(!connection
            .prepare("PRAGMA table_info(documents)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .any(|column| column == "content"));
        drop(connection);
        for file in [
            path.clone(),
            PathBuf::from(format!("{}-wal", path.display())),
            PathBuf::from(format!("{}-shm", path.display())),
        ] {
            let _ = fs::remove_file(file);
        }
    }
    #[test]
    fn highlight_schema_is_idempotent_and_preserves_excerpts() {
        let path = std::env::temp_dir().join(format!(
            "jingreader-highlight-test-{}-{}.sqlite3",
            std::process::id(),
            now_ms(SystemTime::now())
        ));
        {
            let connection = init_db(&path).unwrap();
            connection.execute(
                "INSERT INTO text_highlights(path,root,quote,prefix,suffix,start_offset,end_offset,heading_id,color,created_ms,updated_ms)
                 VALUES('a.md','root','重点','之前','之后',10,12,'chapter','green',1,1)",
                [],
            ).unwrap();
        }
        let connection = init_db(&path).unwrap();
        let stored: (String, String, String) = connection
            .query_row(
                "SELECT quote,prefix,color FROM text_highlights",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(stored, ("重点".into(), "之前".into(), "green".into()));
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, DB_SCHEMA_VERSION);
        drop(connection);
        for file in [
            path.clone(),
            PathBuf::from(format!("{}-wal", path.display())),
            PathBuf::from(format!("{}-shm", path.display())),
        ] {
            let _ = fs::remove_file(file);
        }
    }
    #[test]
    fn snippets_are_unicode_safe() {
        let snippet =
            snippet_for_query("前文。机器学习帮助我们阅读长文。后文。", "机器学习").unwrap();
        assert!(snippet.contains("机器学习"));
    }
    #[test]
    fn fuzzy_filename_matching_handles_substrings_and_subsequences() {
        assert!(fuzzy_filename_score("README.md", "read").is_some());
        assert!(fuzzy_filename_score("architecture-notes.md", "archnotes").is_some());
        assert!(fuzzy_filename_score("README.md", "xyz").is_none());
    }
    #[test]
    fn parses_new_window_command_line_without_confusing_the_flag_for_a_path() {
        let existing = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let args = vec![
            "jingreader.exe".to_string(),
            "--new-window".to_string(),
            existing.clone(),
        ];
        assert!(requests_new_window(&args));
        assert_eq!(first_path_argument(&args), Some(existing));
        assert!(!requests_new_window(&args[..1]));
    }
    #[test]
    fn validates_lightweight_highlight_records() {
        let valid = NewTextHighlight {
            path: "C:\\notes\\a.md".into(),
            quote: "需要记住的内容".into(),
            prefix: "前文".into(),
            suffix: "后文".into(),
            start_offset: 10,
            end_offset: 17,
            heading_id: Some("chapter".into()),
            color: "yellow".into(),
        };
        assert!(validate_highlight_draft(&valid).is_ok());
        assert!(validate_highlight_draft(&NewTextHighlight {
            color: "red".into(),
            ..valid
        })
        .is_err());
    }
    #[test]
    fn old_preferences_gain_default_font_choices() {
        let json = r#"{"theme":"paper","fontSize":18.5,"lineHeight":1.82,"contentWidth":780,"paragraphSpacing":0.85,"fontFamily":"serif","showTree":true,"showOutline":true,"readingRuler":false}"#;
        let preferences: ReaderPreferences = serde_json::from_str(json).unwrap();
        assert!(preferences.chinese_font.is_empty());
        assert!(preferences.latin_font.is_empty());
        assert_eq!(preferences.remote_image_policy, "ask");
        assert_eq!(preferences.pdf_style, "paper");
        assert!(preferences.pdf_include_highlights);
        assert!(preferences.allowed_remote_hosts.is_empty());
        assert!(preferences.favorite_fonts.is_empty());
        assert!(preferences.recent_fonts.is_empty());
        assert_eq!(preferences.heading_scale, 1.0);
        assert_eq!(preferences.paragraph_style, "spacing");
        assert_eq!(preferences.reading_focus, "off");
        assert!(preferences.show_frontmatter);
        assert!(preferences.show_reading_stats);
        assert!(preferences.custom_profiles.is_empty());
    }
    #[test]
    fn versioned_preferences_round_trip_typography_and_appearance() {
        let mut preferences = ReaderPreferences::default();
        preferences.schema_version = 2;
        preferences.style_mode = "canonical".into();
        preferences.typography_profile = "study".into();
        preferences.appearance = "nord".into();
        preferences.legacy_appearance = Some("night".into());
        preferences.typography_overrides = serde_json::json!({"reading":{"chineseFont":"Noto Serif SC","latinFont":"Georgia","headingFont":"Georgia","codeFont":"Consolas"},"study":{"lineHeight":1.9}});
        let persisted = serde_json::to_string(&preferences).unwrap();
        let loaded: ReaderPreferences = serde_json::from_str(&persisted).unwrap();
        assert_eq!(loaded.schema_version, 2);
        assert_eq!(loaded.appearance, "nord");
        assert_eq!(loaded.legacy_appearance.as_deref(), Some("night"));
        assert_eq!(loaded.typography_profile, "study");
        assert_eq!(loaded.typography_overrides["reading"]["chineseFont"], "Noto Serif SC");
        assert_eq!(loaded.typography_overrides["study"]["lineHeight"], 1.9);
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn enumerates_windows_font_families() {
        let fonts = list_system_fonts().unwrap();
        assert!(fonts.len() > 10);
        assert!(fonts.iter().all(|font| !font.family.starts_with('@')));
        assert!(fonts.iter().any(|font| font.supports_latin));
        assert!(fonts.iter().any(|font| font.supports_cjk));
    }
}
