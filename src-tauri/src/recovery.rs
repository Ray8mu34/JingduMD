//! Bounded local recovery points, independent of the editor's undo history.
use super::*;
use rusqlite::OptionalExtension;

const INTERVAL: u64 = 5 * 60 * 1000;
const RETENTION: u64 = 7 * 24 * 60 * 60 * 1000;
const MAX_FILE: usize = 8 * 1024 * 1024;
const MAX_TOTAL: i64 = 60 * 1024 * 1024;

fn open(data: &Path) -> Result<Connection, String> {
    fs::create_dir_all(data).map_err(|e| e.to_string())?;
    let db = Connection::open(data.join("recovery.sqlite3")).map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_millis(100))
        .map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA auto_vacuum=FULL; PRAGMA max_page_count=16384;
        CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY,path TEXT NOT NULL,created_ms INTEGER NOT NULL,digest TEXT NOT NULL,body BLOB NOT NULL);
        CREATE INDEX IF NOT EXISTS recovery_path ON snapshots(path,created_ms DESC,id DESC);").map_err(|e| e.to_string())?;
    Ok(db)
}

fn prune(db: &Connection, now: u64) -> Result<(), String> {
    db.execute(
        "DELETE FROM snapshots WHERE created_ms < ?1",
        [now.saturating_sub(RETENTION)],
    )
    .map_err(|e| e.to_string())?;
    loop {
        let size: i64 = db
            .query_row(
                "SELECT coalesce(sum(length(body)),0) FROM snapshots",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if size <= MAX_TOTAL {
            break;
        }
        db.execute("DELETE FROM snapshots WHERE id=(SELECT id FROM snapshots ORDER BY created_ms,id LIMIT 1)", []).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn maintain(data: &Path) -> Result<(), String> {
    if !data.join("recovery.sqlite3").exists() {
        return Ok(());
    }
    prune(&open(data)?, now_ms(SystemTime::now()))
}

pub fn capture(data: &Path, path: &Path, bytes: &[u8]) -> Result<(), String> {
    capture_at(data, path, bytes, now_ms(SystemTime::now()))
}

fn capture_at(data: &Path, path: &Path, bytes: &[u8], now: u64) -> Result<(), String> {
    let mut db = open(data)?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    prune(&tx, now)?;
    let path = to_string(path);
    let latest: Option<(u64,String)> = tx.query_row("SELECT created_ms,digest FROM snapshots WHERE path=?1 ORDER BY created_ms DESC,id DESC LIMIT 1", [&path], |r| Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e| e.to_string())?;
    let digest = file_highlights::revision(bytes);
    if bytes.len() <= MAX_FILE
        && !latest.is_some_and(|(time, hash)| now.saturating_sub(time) < INTERVAL || hash == digest)
    {
        // Make space before insertion so the physical SQLite size is bounded too.
        while tx
            .query_row(
                "SELECT coalesce(sum(length(body)),0) FROM snapshots",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?
            + bytes.len() as i64
            > MAX_TOTAL
        {
            tx.execute("DELETE FROM snapshots WHERE id=(SELECT id FROM snapshots ORDER BY created_ms,id LIMIT 1)", []).map_err(|e| e.to_string())?;
        }
        tx.execute("DELETE FROM snapshots WHERE path=?1 AND id NOT IN (SELECT id FROM snapshots WHERE path=?1 ORDER BY created_ms DESC,id DESC LIMIT 2)", [&path]).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO snapshots(path,created_ms,digest,body) VALUES(?1,?2,?3,?4)",
            params![path, now, digest, bytes],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rapid_saves_are_coalesced_deduplicated_capped_and_expired() {
        let dir = std::env::temp_dir().join(format!(
            "jingreader-recovery-{}-{}",
            std::process::id(),
            now_ms(SystemTime::now())
        ));
        let path = Path::new("article.md");
        for n in 0..50 {
            capture_at(&dir, path, format!("draft {n}").as_bytes(), 1000 + n).unwrap();
        }
        let db = open(&dir).unwrap();
        let count = || {
            db.query_row("SELECT count(*) FROM snapshots", [], |r| r.get::<_, i64>(0))
                .unwrap()
        };
        assert_eq!(count(), 1);
        for n in 1..10 {
            capture_at(
                &dir,
                path,
                format!("version {n}").as_bytes(),
                1000 + n * INTERVAL,
            )
            .unwrap();
        }
        assert_eq!(count(), 3);
        capture_at(&dir, path, b"version 9", 1000 + 10 * INTERVAL).unwrap();
        assert_eq!(count(), 3);
        prune(&db, RETENTION + 100 * INTERVAL).unwrap();
        assert_eq!(count(), 0);
        drop(db);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn total_storage_is_bounded_and_large_files_are_skipped() {
        let dir = std::env::temp_dir().join(format!(
            "jingreader-recovery-size-{}-{}",
            std::process::id(),
            now_ms(SystemTime::now())
        ));
        for n in 0..10 {
            capture_at(
                &dir,
                Path::new(&format!("{n}.md")),
                &vec![n; MAX_FILE],
                1000,
            )
            .unwrap();
        }
        capture_at(&dir, Path::new("large.md"), &vec![0; MAX_FILE + 1], 1000).unwrap();
        let db = open(&dir).unwrap();
        let size: i64 = db
            .query_row("SELECT sum(length(body)) FROM snapshots", [], |r| r.get(0))
            .unwrap();
        assert!(size <= MAX_TOTAL);
        drop(db);
        assert!(fs::metadata(dir.join("recovery.sqlite3")).unwrap().len() <= 64 * 1024 * 1024);
        fs::remove_dir_all(dir).unwrap();
    }
}
