//! Source-backed highlights: compare before replacing, back up before writing.
use super::*;
use std::io::Write;
static WRITING: Mutex<()> = Mutex::new(());
static BACKUP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) fn without_markers(content: &str) -> String {
    let mut result = String::new();
    let mut remaining = content;
    while let Some(at) = remaining.find("==") {
        result.push_str(&remaining[..at]);
        remaining = &remaining[at + 2..];
        if let Some(first) = remaining.chars().next() {
            if "🔴🟠🟡🟢🔵🟣".contains(first) {
                remaining = &remaining[first.len_utf8()..];
            }
        }
    }
    result.push_str(remaining);
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    content: String,
    backup_path: String,
    revision: String,
}

pub(super) fn revision(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(windows)]
fn replace_once(temp: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(
            target: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let temp: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe {
        ReplaceFileW(
            target.as_ptr(),
            temp.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}
#[cfg(not(windows))]
fn replace_once(temp: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(temp, target)
}

fn replace_file(temp: &Path, target: &Path, expected: &[u8]) -> Result<(), String> {
    // Indexers, previews and antivirus scanners may briefly open the original
    // without sharing deletion. ReplaceFileW reports 1175 (or 32/33) then;
    // both file names remain intact. Retry only these non-destructive failures.
    let delays = [20, 40, 80, 160, 320, 320, 320];
    for attempt in 0..=delays.len() {
        if fs::read(target).map_err(|e| e.to_string())? != expected {
            return Err("原文件在等待保存时已被外部修改，已取消写入。".into());
        }
        if fs::metadata(target).map_err(|e| e.to_string())?.permissions().readonly() {
            return Err("文件为只读，未修改原文。".into());
        }
        match replace_once(temp, target) {
            Ok(()) => return Ok(()),
            Err(error) => {
                let transient = cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33 | 1175));
                if !transient || attempt == delays.len() {
                    return Err(if transient {
                        format!("文件仍被其他程序占用，暂时无法替换；请关闭该文件的其他预览或编辑窗口后重试。未覆盖原文。({error})")
                    } else { format!("无法替换原文件：{error}") });
                }
                std::thread::sleep(std::time::Duration::from_millis(delays[attempt]));
            }
        }
    }
    unreachable!()
}

fn encode_like(bytes: &[u8], content: &str) -> Vec<u8> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little = bytes[0] == 0xff;
        let mut result = bytes[..2].to_vec();
        for unit in content.encode_utf16() {
            result.extend(if little {
                unit.to_le_bytes()
            } else {
                unit.to_be_bytes()
            });
        }
        result
    } else if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        [vec![0xef, 0xbb, 0xbf], content.as_bytes().to_vec()].concat()
    } else {
        content.as_bytes().to_vec()
    }
}

// Shared by marker-only writes and explicit source saves. Always replace an
// existing file, preserving its encoding/BOM and permissions; never recreate a
// deleted or renamed source. The caller has already made a byte-for-byte backup.
fn replace_content(path: &Path, bytes: &[u8], content: &str) -> Result<Vec<u8>, String> {
    let permissions = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
    if permissions.readonly() {
        return Err("文件为只读，未修改原文。".into());
    }
    let encoded = encode_like(bytes, content);
    let temp = path.with_file_name(format!(
        ".jingreader-{}-{}.tmp",
        std::process::id(),
        BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(&encoded)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        fs::set_permissions(&temp, permissions).map_err(|e| e.to_string())?;
        if fs::read(path).map_err(|e| e.to_string())? != bytes {
            return Err("原文件在保存过程中变化，已取消写入。".into());
        }
        if fs::metadata(path)
            .map_err(|e| e.to_string())?
            .permissions()
            .readonly()
        {
            return Err("文件为只读，未修改原文。".into());
        }
        if to_string(&canonical(path)?) != to_string(path) {
            return Err("文件路径在保存过程中变化，已取消写入。".into());
        }
        replace_file(&temp, path, bytes)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map(|_| encoded)
}

fn save_source(
    db: &Connection,
    data: &Path,
    path: &Path,
    expected: &str,
    expected_revision: &str,
    content: &str,
) -> Result<Vec<u8>, String> {
    if !path.is_file() || !is_markdown(path) || content.len() > 64 * 1024 * 1024 {
        return Err("目标不是已有的 Markdown 文档，或内容超过 64MB。".into());
    }
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.permissions().readonly() {
        return Err("文件为只读，未修改原文。".into());
    }
    if metadata.len() > 64 * 1024 * 1024 {
        return Err("文档超过 64MB 安全上限".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("无法读取原文：{e}"))?;
    if revision(&bytes) != expected_revision || decode_text(&bytes) != expected {
        return Err("原文件已在外部修改，未覆盖磁盘内容。请复制保留需要的源码，返回阅读并重新打开最新内容后再修改。".into());
    }
    if content == expected {
        return Ok(bytes);
    }
    let _ = db;
    let _ = recovery::capture(data, path, &bytes);
    replace_content(path, &bytes, content)
}

#[tauri::command]
pub fn save_document(
    state: WindowState,
    path: String,
    expected: String,
    revision: String,
    content: String,
) -> Result<DocumentPayload, String> {
    let _writing = WRITING.lock();
    let file = guarded_path(&state, &path)?;
    if to_string(&file) != path {
        return Err("文件路径已变化，未修改原文。".into());
    }
    let db = state.db.lock();
    let data = state.db_path.parent().ok_or("找不到应用数据目录")?;
    let bytes = save_source(&db, data, &file, &expected, &revision, &content)?;
    // A successful disk commit remains a success even if ancillary annotation
    // bookkeeping fails. The next read reconciles the annotation catalogue.
    if let Some(root) = state.current_root.lock().clone() {
        let _ = annotations::observe(&db, &path, &to_string(&root), &content);
    }
    Ok(DocumentPayload {
        path,
        name: file
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        content,
        modified_ms: fs::metadata(&file)
            .and_then(|m| m.modified())
            .map(now_ms)
            .unwrap_or_default(),
        size: bytes.len() as u64,
        revision: self::revision(&bytes),
    })
}

fn backup(
    db: &Connection,
    data: &Path,
    path: &Path,
    bytes: &[u8],
    ids: &[i64],
) -> Result<PathBuf, String> {
    if ids.is_empty() {
        // Recovery is best-effort and coalesced; a recovery-store failure must
        // never make an otherwise valid ordinary save fail.
        let _ = recovery::capture(data, path, bytes);
        return Ok(data.join("recovery.sqlite3"));
    }
    let directory = data.join("highlight-backups").join(format!(
        "{}-{}",
        now_ms(SystemTime::now()),
        BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&directory).map_err(|e| format!("无法创建备份：{e}"))?;
    let original = directory.join("original.md");
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&original)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("原文备份失败：{e}"))?;
    // VACUUM INTO includes committed WAL data, unlike copying just the .sqlite3.
    if !ids.is_empty() {
        db.execute(
            "VACUUM INTO ?1",
            [to_string(&directory.join("annotations.sqlite3"))],
        )
        .map_err(|e| format!("数据库备份失败：{e}"))?;
    }
    let manifest = serde_json::json!({"sourcePath": to_string(path), "migratedIds": ids, "originalFile": "original.md", "encoding": "original bytes", "createdMs": now_ms(SystemTime::now())});
    fs::write(
        directory.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(directory)
}

#[tauri::command]
pub fn write_file_highlights(
    app: AppHandle,
    state: WindowState,
    path: String,
    expected: String,
    content: String,
    migrated_ids: Vec<i64>,
    migration_backup: Option<String>,
    migrated_records: Option<Vec<TextHighlight>>,
) -> Result<WriteResult, String> {
    let _writing = WRITING.lock();
    let path = guarded_path(&state, &path)?;
    if !path.is_file() || !is_readable(&path) || content.len() > 64 * 1024 * 1024 || expected.len() > 64 * 1024 * 1024 {
        return Err("目标不是可标注的 Markdown/Notebook 文档，或内容超过 64MB".into());
    }
    if notebook::is_notebook(&path) {
        if !migrated_ids.is_empty() { return Err("Notebook 不支持旧标注迁移。".into()); }
        notebook::validate_highlight_change(&expected, &content)?;
    } else if without_markers(&expected) != without_markers(&content) {
        return Err("高亮操作只能修改语法标记，不能改写正文。".into());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    if decode_text(&bytes) != expected {
        return Err("原文件已变化。请重新打开文章后再添加高亮，未覆盖外部修改。".into());
    }
    let db = state.db.lock();
    for id in &migrated_ids {
        let valid: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM text_highlights WHERE id=?1 AND path=?2 AND deleted_ms IS NULL)", params![id, to_string(&path)], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !valid {
            return Err("旧标注已变化，请重新迁移。".into());
        }
        let snapshot = migrated_records
            .as_ref()
            .and_then(|records| records.iter().find(|r| r.id == *id))
            .ok_or("缺少迁移标注快照")?;
        let current = db
            .query_row(
                &format!("SELECT {HIGHLIGHT_COLUMNS} FROM text_highlights WHERE id=?1"),
                [id],
                highlight_from_row,
            )
            .map_err(|e| e.to_string())?;
        if current.updated_ms != snapshot.updated_ms
            || current.quote != snapshot.quote
            || current.color != snapshot.color
            || current.prefix != snapshot.prefix
            || current.suffix != snapshot.suffix
        {
            return Err("旧标注在迁移过程中变化，请重试。".into());
        }
    }
    let data = state.db_path.parent().ok_or("找不到应用数据目录")?;
    let has_batch_backup = if let Some(session) = migration_backup {
        let allowed = data
            .join("highlight-backups")
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let session = PathBuf::from(session)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !session.starts_with(&allowed) || !session.join("annotations.sqlite3").is_file() {
            return Err("迁移数据库备份不存在".into());
        }
        true
    } else {
        false
    };
    let directory = backup(
        &db,
        data,
        &path,
        &bytes,
        if has_batch_backup { &[] } else { &migrated_ids },
    )?;
    let mut written_revision = String::new();
    let result = (|| {
        written_revision = revision(&replace_content(&path, &bytes, &content)?);
        // Keep migrated records recoverable in the existing recycle bin. The
        // snapshot and source file remain authoritative even after DB failures.
        let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
        for id in &migrated_ids {
            tx.execute(
                "UPDATE text_highlights SET deleted_ms=?1 WHERE id=?2",
                params![now_ms(SystemTime::now()), id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })();
    result?;
    let root = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    if !notebook::is_notebook(&path) {
        annotations::observe(&db, &to_string(&path), &to_string(&root), &content)?;
    }
    app.emit(
        "highlights-updated",
        HighlightsChanged {
            path: to_string(&path),
            source: state.label.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(WriteResult {
        content,
        backup_path: to_string(&directory),
        revision: written_revision,
    })
}

#[tauri::command]
pub fn begin_file_highlight_migration(state: WindowState) -> Result<String, String> {
    let _writing = WRITING.lock();
    let db = state.db.lock();
    let directory = state
        .db_path
        .parent()
        .ok_or("找不到应用数据目录")?
        .join("highlight-backups")
        .join(format!(
            "migration-{}-{}",
            now_ms(SystemTime::now()),
            BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    db.execute(
        "VACUUM INTO ?1",
        [to_string(&directory.join("annotations.sqlite3"))],
    )
    .map_err(|e| format!("迁移前数据库备份失败：{e}"))?;
    Ok(to_string(&directory))
}

#[tauri::command]
pub fn highlight_migration_files(state: WindowState) -> Result<Vec<String>, String> {
    let root = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    let db = state.db.lock();
    let mut query = db.prepare("SELECT DISTINCT path FROM text_highlights WHERE root=?1 AND deleted_ms IS NULL ORDER BY path").map_err(|e| e.to_string())?;
    let rows = query
        .query_map([to_string(&root)], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn replacement_retries_a_real_windows_delete_sharing_lock() {
        use std::os::windows::fs::OpenOptionsExt;
        let (dir, path, db) = source_fixture();
        fs::write(&path, b"original").unwrap();
        let lock = fs::OpenOptions::new().read(true).share_mode(3).open(&path).unwrap();
        let temp = dir.join("replacement.tmp");
        fs::write(&temp, b"updated").unwrap();
        let error = replace_once(&temp, &path).unwrap_err();
        assert!(matches!(error.raw_os_error(), Some(32 | 33 | 1175)));
        let unlock = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(100));
            drop(lock);
        });
        replace_file(&temp, &path, b"original").unwrap();
        unlock.join().unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"updated");
        drop(db);
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn retry_never_overwrites_an_external_edit_or_a_persistent_lock() {
        use std::os::windows::fs::OpenOptionsExt;
        let (dir, path, db) = source_fixture();
        fs::write(&path, b"original").unwrap();
        let lock = fs::OpenOptions::new().read(true).share_mode(3).open(&path).unwrap();
        assert!(replace_content(&path, b"original", "updated").unwrap_err().contains("占用"));
        assert_eq!(fs::read(&path).unwrap(), b"original");
        let external_path = path.clone();
        let edit = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(30));
            fs::write(&external_path, b"external edit").unwrap();
            drop(lock);
        });
        let error = replace_content(&path, b"original", "updated").unwrap_err();
        assert!(error.contains("外部修改") || error.contains("变化"), "{error}");
        edit.join().unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"external edit");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "Failed writes must remove temporary files");
        drop(db);
        fs::remove_dir_all(dir).unwrap();
    }
    fn source_fixture() -> (PathBuf, PathBuf, Connection) {
        let dir = std::env::temp_dir().join(format!(
            "jingreader-source-edit-{}-{}",
            std::process::id(),
            BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("article.md");
        (dir, path, Connection::open_in_memory().unwrap())
    }
    #[test]
    fn notebook_source_is_read_only() {
        let (dir, _, db) = source_fixture();
        let path = dir.join("test.ipynb");
        let content = r#"{"nbformat":4,"cells":[]}"#;
        fs::write(&path, content).unwrap();
        assert!(save_source(&db, &dir, &path, content, &revision(content.as_bytes()), "changed").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
        assert!(!dir.join("recovery.sqlite3").exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn source_save_checks_bytes_preserves_encoding_and_backs_up_original() {
        let (dir, path, db) = source_fixture();
        for prefix in [
            vec![],
            vec![0xef, 0xbb, 0xbf],
            vec![0xff, 0xfe],
            vec![0xfe, 0xff],
        ] {
            let bytes = encode_like(&prefix, "原文\r\n");
            fs::write(&path, &bytes).unwrap();
            let result =
                save_source(&db, &dir, &path, "原文\r\n", &revision(&bytes), "改正\r\n").unwrap();
            assert_eq!(fs::read(&path).unwrap(), result);
            assert_eq!(decode_text(&result), "改正\r\n");
            assert!(result.starts_with(&prefix));
            assert!(dir.join("recovery.sqlite3").is_file());
            assert!(!dir.join("highlight-backups").exists());
        }
        // A legacy GBK document is backed up byte-for-byte; changed text is UTF-8.
        let bytes = GBK.encode("中文").0.into_owned();
        fs::write(&path, &bytes).unwrap();
        let result = save_source(&db, &dir, &path, "中文", &revision(&bytes), "中文修改").unwrap();
        assert_eq!(result, "中文修改".as_bytes());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn source_save_noop_conflict_backup_failure_readonly_and_deleted_are_safe() {
        let (dir, path, db) = source_fixture();
        let bytes = b"original\r\n";
        fs::write(&path, bytes).unwrap();
        let rev = revision(bytes);
        assert_eq!(
            save_source(&db, &dir, &path, "original\r\n", &rev, "original\r\n").unwrap(),
            bytes
        );
        assert!(!dir.join("highlight-backups").exists());
        // Encoding-only changes have equal decoded content but must still conflict.
        let external = [vec![0xef, 0xbb, 0xbf], bytes.to_vec()].concat();
        fs::write(&path, &external).unwrap();
        assert!(save_source(&db, &dir, &path, "original\r\n", &rev, "edited").is_err());
        assert_eq!(fs::read(&path).unwrap(), external);
        fs::write(&path, bytes).unwrap();
        fs::create_dir(dir.join("recovery.sqlite3")).unwrap();
        // A blocked recovery store must not block normal editing.
        assert!(save_source(&db, &dir, &path, "original\r\n", &rev, "edited").is_ok());
        assert_eq!(fs::read(&path).unwrap(), b"edited");
        fs::write(&path, bytes).unwrap();
        let permissions = fs::metadata(&path).unwrap().permissions();
        let mut readonly = permissions.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&path, readonly).unwrap();
        assert!(save_source(&db, &dir, &path, "original\r\n", &rev, "edited").is_err());
        fs::set_permissions(&path, permissions).unwrap();
        fs::remove_file(&path).unwrap();
        assert!(save_source(&db, &dir, &path, "original\r\n", &rev, "edited").is_err());
        assert!(!path.exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn replacement_rejects_a_changed_baseline_and_cleans_its_temp_file() {
        let (dir, path, _) = source_fixture();
        fs::write(&path, b"external").unwrap();
        assert!(replace_content(&path, b"original", "draft").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn preserves_bom_and_utf16() {
        for original in [
            vec![0xff, 0xfe],
            vec![0xfe, 0xff],
            vec![0xef, 0xbb, 0xbf],
            vec![],
        ] {
            let encoded = encode_like(&original, "==🟣中文==\r\n");
            assert_eq!(decode_text(&encoded), "==🟣中文==\r\n");
            assert!(encoded.starts_with(&original));
        }
    }
    #[test]
    fn backup_contains_original_and_database() {
        let dir = std::env::temp_dir().join(format!(
            "jingreader-source-backup-{}",
            now_ms(SystemTime::now())
        ));
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE notes(value TEXT); INSERT INTO notes VALUES('旧高亮');")
            .unwrap();
        let backup = backup(&db, &dir, Path::new("article.md"), b"original\r\n", &[1]).unwrap();
        assert_eq!(
            fs::read(backup.join("original.md")).unwrap(),
            b"original\r\n"
        );
        let snapshot = Connection::open(backup.join("annotations.sqlite3")).unwrap();
        assert_eq!(
            snapshot
                .query_row("SELECT value FROM notes", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "旧高亮"
        );
        drop(snapshot);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn source_guard_accepts_only_marker_changes() {
        assert_eq!(
            without_markers("原文 **==🟡重点==**\r\n"),
            without_markers("原文 **重点**\r\n")
        );
        assert_ne!(without_markers("原文"), without_markers("改写原文"));
    }
    #[test]
    fn atomically_replaces_existing_file() {
        let dir =
            std::env::temp_dir().join(format!("jingreader-replace-{}", now_ms(SystemTime::now())));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("source.md");
        let temp = dir.join("replacement.tmp");
        fs::write(&source, b"old").unwrap();
        fs::write(&temp, b"new").unwrap();
        replace_file(&temp, &source, b"old").unwrap();
        assert_eq!(fs::read(&source).unwrap(), b"new");
        assert!(!temp.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
