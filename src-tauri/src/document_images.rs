//! Explicit local image insertion. No network, overwrite, or implicit cleanup.
use super::*;
use std::io::Write;
use std::sync::LazyLock;

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
struct Imported {
    owner: String,
    path: PathBuf,
    revision: String,
}
static PENDING: LazyLock<Mutex<HashMap<String, Imported>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
];
const LIMIT: u64 = 50 * 1024 * 1024;

#[derive(Serialize)]
pub struct ImageInsertion {
    reference: String,
    receipt: String,
}

fn copy_image(document: &Path, source: &Path) -> Result<(PathBuf, String), String> {
    let document = document
        .canonicalize()
        .map_err(|e| format!("原文路径不可用：{e}"))?;
    if !document.is_file() || !is_markdown(&document) {
        return Err("原 Markdown 文件不存在，未插入图片。".into());
    }
    if fs::metadata(&document)
        .map_err(|e| e.to_string())?
        .permissions()
        .readonly()
    {
        return Err("Markdown 文件为只读，未插入图片。".into());
    }
    let extension = source
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if !EXTENSIONS.contains(&extension.as_str()) {
        return Err("不支持或不安全的图片类型。".into());
    }
    let mut input = fs::File::open(source).map_err(|e| format!("无法读取图片：{e}"))?;
    if !input.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("请选择本地图片文件。".into());
    }
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut input)
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("图片超过 50MB 安全上限。".into());
    }
    if bytes.is_empty() {
        return Err("图片文件为空。".into());
    }
    let parent = document.parent().ok_or("找不到文档目录")?;
    let images = parent.join("images");
    // Do not follow a pre-existing images symlink/junction to another location.
    if fs::symlink_metadata(&images).is_ok() && !ordinary_directory(&images)? {
        return Err("images 不是当前文档目录中的普通文件夹，请先检查该路径。".into());
    }
    fs::create_dir_all(&images).map_err(|e| format!("无法创建 images 文件夹：{e}"))?;
    if !ordinary_directory(&images)? {
        return Err("images 路径已变化，未复制图片。".into());
    }
    let stem: String = source
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("image")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(60)
        .collect();
    // Prefix avoids Windows device names while keeping the selected name recognizable.
    let stem = format!("image-{}", if stem.is_empty() { "picture" } else { &stem });
    for suffix in 0..10000 {
        let name = if suffix == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{suffix}.{extension}")
        };
        let path = images.join(name);
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法复制图片：{error}")),
        };
        if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err(format!("图片复制失败，未插入引用：{error}"));
        }
        return Ok((path, file_highlights::revision(&bytes)));
    }
    Err("同名图片过多，请重命名图片后重试。".into())
}

fn ordinary_directory(path: &Path) -> Result<bool, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Ok(false);
        }
    }
    Ok(meta.is_dir() && !meta.file_type().is_symlink() && canonical(path)? == path)
}

#[tauri::command]
pub fn import_document_image(
    state: WindowState,
    document_path: String,
    source_path: String,
) -> Result<ImageInsertion, String> {
    let document = guarded_path(&state, &document_path)?;
    if to_string(&document) != document_path {
        return Err("文档路径已变化，未插入图片。".into());
    }
    let source = canonical(&source_path)?;
    let (path, revision) = copy_image(&document, &source)?;
    let name = path.file_name().unwrap().to_string_lossy();
    let reference = format!("![](images/{name})");
    let receipt = format!(
        "{}-{}",
        now_ms(SystemTime::now()),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    PENDING.lock().insert(
        receipt.clone(),
        Imported {
            owner: state.label.clone(),
            path,
            revision,
        },
    );
    Ok(ImageInsertion { reference, receipt })
}

#[tauri::command]
pub fn finish_document_image(
    state: WindowState,
    receipt: String,
    keep: bool,
) -> Result<(), String> {
    let mut pending = PENDING.lock();
    let entry = pending.get(&receipt).ok_or("图片插入记录已过期")?;
    if entry.owner != state.label {
        return Err("图片不属于当前标签页".into());
    }
    if !keep {
        if canonical(&entry.path)? != entry.path {
            return Err("图片路径已变化，保留副本，请手动检查。".into());
        }
        let bytes = fs::read(&entry.path).map_err(|e| e.to_string())?;
        if file_highlights::revision(&bytes) != entry.revision {
            return Err("图片已被外部修改，保留该副本。".into());
        }
        fs::remove_file(&entry.path).map_err(|e| e.to_string())?;
    }
    pending.remove(&receipt);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_copy_never_overwrites_and_rejects_invalid_input() {
        let dir = std::env::temp_dir().join(format!(
            "jingreader-images-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        let doc = dir.join("article.md");
        let image = dir.join("截图 (1).png");
        fs::write(&doc, "文档").unwrap();
        fs::write(&image, b"test image bytes").unwrap();
        let (first, _) = copy_image(&doc, &image).unwrap();
        let (second, _) = copy_image(&doc, &image).unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read(&first).unwrap(), b"test image bytes");
        assert_eq!(
            first.parent().unwrap(),
            dir.join("images").canonicalize().unwrap()
        );
        assert!(copy_image(&doc, &doc).is_err());
        fs::remove_file(&doc).unwrap();
        assert!(copy_image(&doc, &image).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
