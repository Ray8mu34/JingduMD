//! Source-backed highlights: compare before replacing, back up before writing.
use super::*;
use std::io::Write;
static WRITING: Mutex<()> = Mutex::new(());
static BACKUP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn without_markers(content: &str) -> String {
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
}

#[cfg(windows)]
fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
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
        return Err(format!(
            "无法替换原文件：{}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}
#[cfg(not(windows))]
fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
    fs::rename(temp, target).map_err(|e| e.to_string())
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

fn backup(
    db: &Connection,
    data: &Path,
    path: &Path,
    bytes: &[u8],
    ids: &[i64],
) -> Result<PathBuf, String> {
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
    if !path.is_file() || !is_markdown(&path) || content.len() > 64 * 1024 * 1024 {
        return Err("目标不是可写的 Markdown 文档，或内容超过 64MB".into());
    }
    if without_markers(&expected) != without_markers(&content) {
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
        file.write_all(&encode_like(&bytes, &content))
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        if fs::read(&path).map_err(|e| e.to_string())? != bytes {
            return Err("原文件在保存过程中变化，已取消写入。".into());
        }
        replace_file(&temp, &path)?;
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
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| format!("{e}；写入前备份：{}", to_string(&directory)))?;
    let root = state.current_root.lock().clone().ok_or("尚未打开文件夹")?;
    annotations::observe(&db, &to_string(&path), &to_string(&root), &content)?;
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
        replace_file(&temp, &source).unwrap();
        assert_eq!(fs::read(&source).unwrap(), b"new");
        assert!(!temp.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
