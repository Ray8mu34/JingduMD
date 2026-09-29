//! Annotation identity, recovery and portable backups. Never writes document files.
use super::*;
use sha2::{Digest, Sha256};
use tauri_plugin_dialog::DialogExt;

const MAX_BACKUP: u64 = 20 * 1024 * 1024;
static RECOVERING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn migrate(db: &Connection, version: i64) -> Result<(), String> {
    if version >= 4 {
        return Ok(());
    }
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    let columns: HashSet<String> = tx
        .prepare("PRAGMA table_info(text_highlights)")
        .map_err(|e| e.to_string())?
        .query_map([], |r| r.get(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    for (name, kind) in [
        ("document_id", "TEXT"),
        ("uid", "TEXT"),
        ("deleted_ms", "INTEGER"),
    ] {
        if !columns.contains(name) {
            tx.execute_batch(&format!(
                "ALTER TABLE text_highlights ADD COLUMN {name} {kind};"
            ))
            .map_err(|e| e.to_string())?;
        }
    }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS annotation_documents (
      id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, root TEXT NOT NULL,
      fingerprint TEXT, original_path TEXT);
      INSERT OR IGNORE INTO annotation_documents(id,path,root)
        SELECT lower(hex(randomblob(16))),path,min(root) FROM text_highlights GROUP BY path;
      UPDATE text_highlights SET document_id=(SELECT id FROM annotation_documents d WHERE d.path=text_highlights.path) WHERE document_id IS NULL;
      UPDATE text_highlights SET uid=lower(hex(randomblob(16))) WHERE uid IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS highlight_uid_idx ON text_highlights(uid);
      CREATE INDEX IF NOT EXISTS highlight_document_idx ON text_highlights(document_id);
      PRAGMA user_version=4;")
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

fn fingerprint(content: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(content.replace("\r\n", "\n").as_bytes())
    )
}

fn file_fingerprint(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 * 1024 {
        return None;
    }
    read_text(path).ok().map(|text| fingerprint(&text))
}

pub fn observe(db: &Connection, path: &str, root: &str, content: &str) -> Result<(), String> {
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM annotation_documents WHERE path=?1)",
            [path],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Ok(());
    }
    db.execute(
        "UPDATE annotation_documents SET fingerprint=?1,root=?2 WHERE path=?3",
        params![fingerprint(content), root, path],
    )
    .map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE text_highlights SET root=?1 WHERE path=?2",
        params![root, path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn ensure_document(
    db: &Connection,
    path: &str,
    root: &str,
    content: &str,
) -> Result<String, String> {
    db.execute("INSERT OR IGNORE INTO annotation_documents(id,path,root,fingerprint) VALUES(lower(hex(randomblob(16))),?1,?2,?3)", params![path,root,fingerprint(content)]).map_err(|e| e.to_string())?;
    observe(db, path, root, content)?;
    db.query_row(
        "SELECT id FROM annotation_documents WHERE path=?1",
        [path],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationDocument {
    id: String,
    path: String,
    root: String,
    fingerprint: Option<String>,
    original_path: Option<String>,
}

fn documents(db: &Connection) -> Result<Vec<AnnotationDocument>, String> {
    let mut query = db.prepare("SELECT id,path,root,fingerprint,original_path FROM annotation_documents WHERE EXISTS(SELECT 1 FROM text_highlights h WHERE h.document_id=annotation_documents.id) ORDER BY path").map_err(|e| e.to_string())?;
    let rows = query
        .query_map([], |row| {
            Ok(AnnotationDocument {
                id: row.get(0)?,
                path: row.get(1)?,
                root: row.get(2)?,
                fingerprint: row.get(3)?,
                original_path: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

// Upgrade old records while their source is still available; imported path hints
// are never dereferenced. A missing old file remains recoverable manually.
fn hydrate(db: &Connection) -> Result<(), String> {
    for doc in documents(db)? {
        if doc.fingerprint.is_none() && doc.original_path.is_none() {
            if let Some(hash) = file_fingerprint(Path::new(&doc.path)) {
                db.execute(
                    "UPDATE annotation_documents SET fingerprint=?1 WHERE id=?2",
                    params![hash, doc.id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDocument {
    id: String,
    path: String,
    missing: bool,
    has_fingerprint: bool,
    active: u64,
    deleted: u64,
    preview: String,
}

#[tauri::command]
pub fn annotation_library(state: WindowState) -> Result<Vec<LibraryDocument>, String> {
    let db = state.db.lock();
    hydrate(&db)?;
    documents(&db)?.into_iter().map(|doc| {
        let (active,deleted): (u64,u64) = db.query_row("SELECT coalesce(sum(deleted_ms IS NULL),0),coalesce(sum(deleted_ms IS NOT NULL),0) FROM text_highlights WHERE document_id=?1", [&doc.id], |r| Ok((r.get(0)?,r.get(1)?))).map_err(|e| e.to_string())?;
        let preview: String = db.query_row("SELECT quote FROM text_highlights WHERE document_id=?1 ORDER BY deleted_ms IS NOT NULL,created_ms LIMIT 1", [&doc.id], |r| r.get(0)).map_err(|e| e.to_string())?;
        Ok(LibraryDocument { id: doc.id, missing: doc.original_path.is_some() || !Path::new(&doc.path).is_file(), has_fingerprint: doc.fingerprint.is_some(), path: doc.original_path.unwrap_or(doc.path), active, deleted, preview: preview.chars().take(140).collect() })
    }).collect()
}

#[tauri::command]
pub fn managed_highlights(
    state: WindowState,
    document_id: String,
    deleted: bool,
) -> Result<Vec<TextHighlight>, String> {
    let db = state.db.lock();
    let mut query = db.prepare(&format!("SELECT {HIGHLIGHT_COLUMNS} FROM text_highlights WHERE document_id=?1 AND (deleted_ms IS NOT NULL)=?2 ORDER BY created_ms")).map_err(|e| e.to_string())?;
    let rows = query
        .query_map(params![document_id, deleted], highlight_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn changed(app: &AppHandle) {
    app.emit(
        "highlights-updated",
        HighlightsChanged {
            path: "*".into(),
            source: "annotation-library".into(),
        },
    )
    .ok();
}

fn relink(
    db: &Connection,
    document_id: &str,
    path: &str,
    root: &str,
    hash: &str,
    merge: bool,
) -> Result<(), String> {
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM annotation_documents WHERE id=?1)",
            [document_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("标注记录已不存在，请刷新列表".into());
    }
    let other: Option<String> = tx
        .query_row(
            "SELECT id FROM annotation_documents WHERE path=?1 AND id<>?2",
            params![path, document_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(other) = other {
        if !merge {
            return Err("目标已有标注，请手动确认关联".into());
        }
        tx.execute(
            "UPDATE text_highlights SET document_id=?1 WHERE document_id=?2",
            params![document_id, other],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM annotation_documents WHERE id=?1", [&other])
            .map_err(|e| e.to_string())?;
    }
    tx.execute("UPDATE annotation_documents SET path=?1,root=?2,fingerprint=?3,original_path=NULL WHERE id=?4", params![path,root,hash,document_id]).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE text_highlights SET path=?1,root=?2 WHERE document_id=?3",
        params![path, root, document_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    recovered: usize,
    pending: usize,
    skipped_files: usize,
}

fn recover(db: &Connection, root: &Path) -> Result<RecoveryReport, String> {
    hydrate(db)?;
    let docs = documents(db)?;
    let missing: Vec<_> = docs
        .iter()
        .filter(|d| {
            d.original_path.is_some() || matches!(Path::new(&d.path).try_exists(), Ok(false))
        })
        .collect();
    let wanted: HashSet<_> = missing
        .iter()
        .filter_map(|d| d.fingerprint.clone())
        .collect();
    let mut report = RecoveryReport {
        pending: missing.len(),
        ..Default::default()
    };
    if wanted.is_empty() {
        return Ok(report);
    }
    let mut candidates: HashMap<String, Vec<String>> = HashMap::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0 || !ignored_name(&entry.file_name().to_string_lossy())
        })
    {
        let Ok(entry) = entry else {
            report.skipped_files += 1;
            continue;
        };
        if !entry.file_type().is_file() || !is_markdown(entry.path()) {
            continue;
        }
        let Ok(path) = canonical(entry.path()) else {
            report.skipped_files += 1;
            continue;
        };
        if !path.starts_with(root) {
            continue;
        }
        if let Some(hash) = file_fingerprint(&path) {
            if wanted.contains(&hash) {
                candidates.entry(hash).or_default().push(to_string(&path));
            }
        } else {
            report.skipped_files += 1;
        }
    }
    for doc in &missing {
        let Some(hash) = &doc.fingerprint else {
            continue;
        };
        let Some(paths) = candidates.get(hash) else {
            continue;
        };
        // Both ends must be unambiguous. Never treat a copy of a live document as a move.
        if paths.len() != 1
            || missing
                .iter()
                .filter(|d| d.fingerprint.as_ref() == Some(hash))
                .count()
                != 1
            || docs.iter().any(|d| {
                d.id != doc.id
                    && (d.path == paths[0]
                        || (d.fingerprint.as_ref() == Some(hash) && Path::new(&d.path).is_file()))
            })
        {
            continue;
        }
        // Do not migrate if the source reappeared during the scan.
        if doc.original_path.is_none() && !matches!(Path::new(&doc.path).try_exists(), Ok(false)) {
            continue;
        }
        // The file or annotation may have changed while a large directory was scanned.
        let unchanged: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM annotation_documents WHERE id=?1 AND path=?2 AND fingerprint=?3)", params![doc.id,doc.path,hash], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !unchanged || file_fingerprint(Path::new(&paths[0])).as_ref() != Some(hash) {
            continue;
        }
        relink(db, &doc.id, &paths[0], &to_string(root), hash, false)?;
        report.recovered += 1;
    }
    report.pending -= report.recovered;
    Ok(report)
}

#[tauri::command]
pub async fn recover_highlights(
    app: AppHandle,
    state: WindowState,
) -> Result<RecoveryReport, String> {
    if RECOVERING.swap(true, Ordering::AcqRel) {
        return Err("正在找回标注，请稍候".into());
    }
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            RECOVERING.store(false, Ordering::Release);
        }
    }
    let reset = Reset;
    tauri::async_runtime::spawn_blocking(move || {
        let _reset = reset;

        // A separate connection keeps reading and navigation responsive during hashing.
        let root = state
            .current_root
            .lock()
            .clone()
            .ok_or("请先打开文件夹，再扫描找回高亮")?;
        let db = Connection::open(&state.db_path).map_err(|e| e.to_string())?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let result = recover(&db, &root)?;
        if result.recovered > 0 {
            changed(&app);
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn relink_highlights(
    app: AppHandle,
    state: WindowState,
    document_id: String,
    path: String,
) -> Result<(), String> {
    let target = guarded_path(&state, &path)?;
    if !is_markdown(&target) {
        return Err("请选择 Markdown 文件".into());
    }
    let hash = file_fingerprint(&target).ok_or("文件无法读取或超过 64MB")?;
    let root = state
        .current_root
        .lock()
        .clone()
        .ok_or("请先打开目标文件夹")?;
    relink(
        &state.db.lock(),
        &document_id,
        &to_string(&target),
        &to_string(&root),
        &hash,
        true,
    )?;
    changed(&app);
    Ok(())
}

#[tauri::command]
pub fn restore_highlight(app: AppHandle, state: WindowState, id: i64) -> Result<(), String> {
    state
        .db
        .lock()
        .execute(
            "UPDATE text_highlights SET deleted_ms=NULL WHERE id=?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
    changed(&app);
    Ok(())
}

#[tauri::command]
pub fn manage_annotation_document(
    app: AppHandle,
    state: WindowState,
    document_id: String,
    action: String,
) -> Result<(), String> {
    manage_document(&state.db.lock(), &document_id, &action)?;
    changed(&app);
    Ok(())
}

fn manage_document(db: &Connection, document_id: &str, action: &str) -> Result<(), String> {
    let db = db.unchecked_transaction().map_err(|e| e.to_string())?;
    match action {
        "trash" => db.execute("UPDATE text_highlights SET deleted_ms=strftime('%s','now')*1000 WHERE document_id=?1 AND deleted_ms IS NULL", [&document_id]),
        "restore" => db.execute("UPDATE text_highlights SET deleted_ms=NULL WHERE document_id=?1", [&document_id]),
        "purge" => db.execute("DELETE FROM text_highlights WHERE document_id=?1 AND deleted_ms IS NOT NULL", [&document_id]),
        _ => return Err("未知的标注操作".into()),
    }.map_err(|e| e.to_string())?;
    db.execute("DELETE FROM annotation_documents WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM text_highlights WHERE document_id=?1)", [&document_id]).map_err(|e| e.to_string())?;
    db.commit().map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupHighlight {
    uid: String,
    document_id: String,
    deleted_ms: Option<u64>,
    #[serde(flatten)]
    highlight: TextHighlight,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    format: String,
    version: u32,
    documents: Vec<AnnotationDocument>,
    highlights: Vec<BackupHighlight>,
}

fn export_backup(db: &Connection) -> Result<String, String> {
    hydrate(db)?;
    let mut query = db.prepare(&format!("SELECT {HIGHLIGHT_COLUMNS},uid,document_id,deleted_ms FROM text_highlights ORDER BY id")).map_err(|e| e.to_string())?;
    let highlights = query
        .query_map([], |r| {
            Ok(BackupHighlight {
                uid: r.get(12)?,
                document_id: r.get(13)?,
                deleted_ms: r.get(14)?,
                highlight: highlight_from_row(r)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if highlights.len() > 50_000 {
        return Err("标注超过单份备份的 50000 条上限".into());
    }
    let json = serde_json::to_string_pretty(&Backup {
        format: "jingreader-highlights".into(),
        version: 1,
        documents: documents(db)?,
        highlights,
    })
    .map_err(|e| e.to_string())?;
    if json.len() as u64 > MAX_BACKUP {
        return Err("备份超过 20MB 上限".into());
    }
    Ok(json)
}

fn hex_id(value: &str, size: usize) -> bool {
    value.len() == size && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn import_backup(db: &Connection, json: &str) -> Result<usize, String> {
    if json.len() as u64 > MAX_BACKUP {
        return Err("备份超过 20MB 上限".into());
    }
    let backup: Backup = serde_json::from_str(json).map_err(|_| "不是有效的静读高亮备份")?;
    if backup.format != "jingreader-highlights"
        || backup.version != 1
        || backup.highlights.len() > 50_000
        || backup.documents.len() > 50_000
    {
        return Err("不支持的备份格式或记录过多".into());
    }
    let mut ids = HashSet::new();
    for doc in &backup.documents {
        if !hex_id(&doc.id, 32)
            || !ids.insert(&doc.id)
            || doc.path.len() > 32768
            || doc.root.len() > 32768
            || doc.original_path.as_ref().is_some_and(|p| p.len() > 32768)
            || doc.fingerprint.as_ref().is_some_and(|h| !hex_id(h, 64))
        {
            return Err("备份中的文档信息无效".into());
        }
    }
    for entry in &backup.highlights {
        let h = &entry.highlight;
        if !hex_id(&entry.uid, 32)
            || !ids.contains(&entry.document_id)
            || h.end_offset > i64::MAX as usize
            || h.created_ms > i64::MAX as u64
            || h.updated_ms > i64::MAX as u64
            || entry.deleted_ms.is_some_and(|t| t > i64::MAX as u64)
            || h.heading_id.as_ref().is_some_and(|s| s.len() > 8192)
        {
            return Err("备份中的高亮信息无效".into());
        }
        validate_highlight_draft(&NewTextHighlight {
            path: h.path.clone(),
            quote: h.quote.clone(),
            prefix: h.prefix.clone(),
            suffix: h.suffix.clone(),
            start_offset: h.start_offset,
            end_offset: h.end_offset,
            heading_id: h.heading_id.clone(),
            color: h.color.clone(),
        })?;
    }
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    for doc in backup.documents {
        // Foreign path strings are hints only. Reconciliation is limited to the folder
        // the user actually opened; importing a backup cannot read arbitrary paths.
        tx.execute("INSERT OR IGNORE INTO annotation_documents(id,path,root,fingerprint,original_path) VALUES(?1,?2,'',?3,?4)", params![doc.id,format!("import://{}",doc.id),doc.fingerprint,doc.original_path.unwrap_or(doc.path)]).map_err(|e| e.to_string())?;
    }
    let mut added = 0;
    for entry in backup.highlights {
        let (path, root): (String, String) = tx
            .query_row(
                "SELECT path,root FROM annotation_documents WHERE id=?1",
                [&entry.document_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let h = entry.highlight;
        added += tx.execute("INSERT OR IGNORE INTO text_highlights(path,root,quote,prefix,suffix,start_offset,end_offset,heading_id,color,created_ms,updated_ms,uid,document_id,deleted_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)", params![path,root,h.quote,h.prefix,h.suffix,h.start_offset as i64,h.end_offset as i64,h.heading_id,h.color,h.created_ms,h.updated_ms,entry.uid,entry.document_id,entry.deleted_ms]).map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM annotation_documents WHERE NOT EXISTS(SELECT 1 FROM text_highlights h WHERE h.document_id=annotation_documents.id)", []).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(added)
}

#[tauri::command]
pub async fn export_annotations(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = export_backup(&app.state::<WindowRegistry>().db.lock())?;
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("静读高亮备份", &["json"])
            .set_file_name("静读高亮备份.jingreader-highlights.json")
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        if path.extension().and_then(OsStr::to_str) != Some("json") {
            return Err("请保存为 .json 备份文件".into());
        }
        fs::write(&path, data).map_err(|e| e.to_string())?;
        Ok(Some(to_string(&path)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_annotations(app: AppHandle) -> Result<Option<usize>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("静读高亮备份", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        // Read at most the limit, including files which grow after metadata was checked.
        let mut data = String::new();
        fs::File::open(&path)
            .map_err(|e| e.to_string())?
            .take(MAX_BACKUP + 1)
            .read_to_string(&mut data)
            .map_err(|e| e.to_string())?;
        let count = import_backup(&app.state::<WindowRegistry>().db.lock(), &data)?;
        changed(&app);
        Ok(Some(count))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "jingreader-annotations-{}-{}-{}",
                std::process::id(),
                now_ms(SystemTime::now()),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(canonical(&path).unwrap())
        }
        fn file(&self, name: &str, content: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, content).unwrap();
            path
        }
        fn db(&self) -> Connection {
            init_db(&self.0.join("state.sqlite")).unwrap()
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn add(db: &Connection, path: &Path, root: &Path) -> String {
        let id = ensure_document(
            db,
            &to_string(path),
            &to_string(root),
            &read_text(path).unwrap(),
        )
        .unwrap();
        db.execute("INSERT INTO text_highlights(path,root,quote,prefix,suffix,start_offset,end_offset,color,created_ms,updated_ms,document_id,uid) VALUES(?1,?2,'重点内容','','',0,4,'green',1,1,?3,lower(hex(randomblob(16))))", params![to_string(path),to_string(root),id]).unwrap();
        id
    }
    fn count(db: &Connection) -> i64 {
        db.query_row("SELECT count(*) FROM text_highlights", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn moved_document_recovers_without_writing_source() {
        let s = Sandbox::new();
        let db = s.db();
        let old = s.file("old.md", "# 文章\r\n重点内容\r\n");
        let id = add(&db, &old, &s.0);
        let new = s.0.join("renamed.md");
        fs::rename(&old, &new).unwrap();
        let before = fs::read(&new).unwrap();
        let report = recover(&db, &s.0).unwrap();
        assert_eq!((report.recovered, report.pending), (1, 0));
        let doc = documents(&db).unwrap().pop().unwrap();
        assert_eq!((doc.id, doc.path), (id, to_string(&new)));
        assert_eq!(fs::read(&new).unwrap(), before);
        assert_eq!(recover(&db, &s.0).unwrap().recovered, 0);
        assert_eq!(count(&db), 1);
    }
    #[test]
    fn copies_ambiguous_and_modified_documents_are_not_guessed() {
        let s = Sandbox::new();
        let db = s.db();
        let old = s.file("old.md", "重点内容");
        add(&db, &old, &s.0);
        let a = s.file("a.md", "重点内容");
        assert_eq!(recover(&db, &s.0).unwrap().recovered, 0); // A copy, not a move.
        fs::remove_file(&old).unwrap();
        let b = s.file("b.md", "重点内容");
        assert_eq!(recover(&db, &s.0).unwrap().pending, 1); // Two candidates.
        fs::remove_file(&b).unwrap();
        fs::write(&a, "重点内容发生变化").unwrap();
        assert_eq!(recover(&db, &s.0).unwrap().pending, 1);
        fs::write(&a, "重点内容").unwrap();
        assert_eq!(recover(&db, &s.0).unwrap().recovered, 1);
    }
    #[test]
    fn edited_then_moved_document_uses_observed_content() {
        let s = Sandbox::new();
        let db = s.db();
        let old = s.file("old.md", "重点内容");
        add(&db, &old, &s.0);
        fs::write(&old, "前面新增一段\n重点内容").unwrap();
        observe(
            &db,
            &to_string(&old),
            &to_string(&s.0),
            &read_text(&old).unwrap(),
        )
        .unwrap();
        let folder = s.0.join("new-folder");
        fs::create_dir(&folder).unwrap();
        fs::rename(&old, folder.join("new.md")).unwrap();
        assert_eq!(recover(&db, &folder).unwrap().recovered, 1);
        assert_eq!(documents(&db).unwrap()[0].root, to_string(&folder));
    }
    #[test]
    fn identical_missing_documents_require_manual_association() {
        let s = Sandbox::new();
        let db = s.db();
        let a = s.file("a.md", "重点内容");
        let b = s.file("b.md", "重点内容");
        add(&db, &a, &s.0);
        add(&db, &b, &s.0);
        fs::remove_file(a).unwrap();
        fs::remove_file(b).unwrap();
        s.file("new.md", "重点内容");
        let report = recover(&db, &s.0).unwrap();
        assert_eq!((report.recovered, report.pending), (0, 2));
    }
    #[test]
    fn legacy_migration_preserves_records_and_is_repeatable() {
        let s = Sandbox::new();
        let db = s.db();
        let old = s.file("old.md", "重点内容");
        add(&db, &old, &s.0);
        // Recreate exactly the pre-v4 highlight schema with a real legacy row.
        db.execute_batch("DROP INDEX highlight_uid_idx; DROP INDEX highlight_document_idx; ALTER TABLE text_highlights DROP COLUMN document_id; ALTER TABLE text_highlights DROP COLUMN uid; ALTER TABLE text_highlights DROP COLUMN deleted_ms; DROP TABLE annotation_documents; PRAGMA user_version=3;").unwrap();
        drop(db);
        let db = s.db();
        hydrate(&db).unwrap();
        let before = export_backup(&db).unwrap();
        assert!(before.contains("重点内容"));
        assert!(documents(&db).unwrap()[0].fingerprint.is_some());
        drop(db);
        let db = s.db();
        assert_eq!(export_backup(&db).unwrap(), before);
        let new = s.0.join("new.md");
        fs::rename(old, new).unwrap();
        assert_eq!(recover(&db, &s.0).unwrap().recovered, 1);
    }
    #[test]
    fn old_missing_records_keep_quotes_for_manual_merge() {
        let s = Sandbox::new();
        let db = s.db();
        let old = s.file("old.md", "旧文重点内容");
        let id = add(&db, &old, &s.0);
        db.execute("UPDATE annotation_documents SET fingerprint=NULL", [])
            .unwrap();
        fs::remove_file(old).unwrap();
        let target = s.file("target.md", "新文重点内容");
        add(&db, &target, &s.0);
        assert_eq!(recover(&db, &s.0).unwrap().pending, 1);
        relink(
            &db,
            &id,
            &to_string(&target),
            &to_string(&s.0),
            &file_fingerprint(&target).unwrap(),
            true,
        )
        .unwrap();
        assert_eq!(documents(&db).unwrap().len(), 1);
        assert_eq!(count(&db), 2);
        let paths: i64 = db
            .query_row(
                "SELECT count(DISTINCT path) FROM text_highlights",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(paths, 1);
    }
    #[test]
    fn backup_round_trip_deduplicates_and_preserves_deletions() {
        let source = Sandbox::new();
        let db = source.db();
        let path = source.file("a.md", "重点内容");
        add(&db, &path, &source.0);
        let backup = export_backup(&db).unwrap();
        db.execute("UPDATE text_highlights SET deleted_ms=123,color='pink'", [])
            .unwrap();
        assert_eq!(import_backup(&db, &backup).unwrap(), 0);
        let deleted: i64 = db
            .query_row("SELECT deleted_ms FROM text_highlights", [], |r| r.get(0))
            .unwrap();
        assert_eq!(deleted, 123);
        let dest = Sandbox::new();
        let other = dest.db();
        dest.file("不同名字.md", "重点内容");
        assert_eq!(
            import_backup(&other, &export_backup(&db).unwrap()).unwrap(),
            1
        );
        assert!(documents(&other).unwrap()[0].original_path.is_some());
        assert_eq!(recover(&other, &dest.0).unwrap().recovered, 1);
        assert_eq!(import_backup(&other, &backup).unwrap(), 0);
        assert_eq!(count(&other), 1);
        let color: String = other
            .query_row("SELECT color FROM text_highlights", [], |r| r.get(0))
            .unwrap();
        assert_eq!(color, "pink");
    }
    #[test]
    fn invalid_backup_is_atomic_and_import_does_not_read_foreign_paths() {
        let s = Sandbox::new();
        let db = s.db();
        let path = s.file("a.md", "重点内容");
        add(&db, &path, &s.0);
        let mut backup: Backup = serde_json::from_str(&export_backup(&db).unwrap()).unwrap();
        let dest = Sandbox::new();
        let other = dest.db();
        backup.highlights[0].highlight.color = "invalid".into();
        assert!(import_backup(&other, &serde_json::to_string(&backup).unwrap()).is_err());
        assert_eq!(count(&other), 0);
        backup.highlights[0].highlight.color = "blue".into();
        backup.documents[0].fingerprint = None;
        assert_eq!(
            import_backup(&other, &serde_json::to_string(&backup).unwrap()).unwrap(),
            1
        );
        hydrate(&other).unwrap();
        assert!(documents(&other).unwrap()[0].fingerprint.is_none());
        assert!(documents(&other).unwrap()[0].path.starts_with("import://"));
        assert_eq!(fingerprint("a\r\nb"), fingerprint("a\nb"));
    }
    #[test]
    fn recycle_restore_and_purge_only_remove_deleted_records() {
        let s = Sandbox::new();
        let db = s.db();
        let path = s.file("a.md", "重点内容");
        let id = add(&db, &path, &s.0);
        manage_document(&db, &id, "trash").unwrap();
        let deleted: bool = db
            .query_row(
                "SELECT deleted_ms IS NOT NULL FROM text_highlights",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(deleted);
        assert_eq!(count(&db), 1);
        manage_document(&db, &id, "restore").unwrap();
        manage_document(&db, &id, "purge").unwrap();
        assert_eq!(count(&db), 1); // Active highlights cannot be purged.
        manage_document(&db, &id, "trash").unwrap();
        manage_document(&db, &id, "purge").unwrap();
        assert_eq!(count(&db), 0);
        let docs: i64 = db
            .query_row("SELECT count(*) FROM annotation_documents", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(docs, 0);
        assert_eq!(fs::read_to_string(path).unwrap(), "重点内容");
    }
    #[test]
    fn reopening_after_an_old_app_preserves_new_identity() {
        let s = Sandbox::new();
        let db = s.db();
        let path = s.file("a.md", "重点内容");
        add(&db, &path, &s.0);
        let before = export_backup(&db).unwrap();
        db.execute_batch("PRAGMA user_version=3;").unwrap();
        drop(db);
        let db = s.db();
        assert_eq!(export_backup(&db).unwrap(), before);
    }
}
