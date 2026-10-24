// Workspace folders: user-picked directories that the sidebar can browse,
// quick-open, search and index.
//
// File access in Bioscratch is otherwise granted one file at a time (open
// dialog, drag-drop, OS "Open With"). Picking a folder through the native
// folder dialog grants that whole subtree instead. Picked folders are persisted
// to `workspace_folders.json` (written only by `show_folder_dialog`) and
// re-granted on startup, the same trust model as `recent_files.json`.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

static AUTHORIZED_ROOTS: OnceLock<Mutex<Vec<PathBuf>>> = OnceLock::new();
static FOLDERS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
// Each window cancels only its own previous search.
static SEARCH_GENERATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicU64>>>> = OnceLock::new();

fn next_search_generation(window_label: &str) -> Result<(Arc<AtomicU64>, u64), String> {
    let mut generations = SEARCH_GENERATIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Search lock failed")?;
    let counter = generations
        .entry(window_label.to_string())
        .or_insert_with(|| Arc::new(AtomicU64::new(0)))
        .clone();
    let generation = counter.fetch_add(1, Ordering::SeqCst) + 1;
    Ok((counter, generation))
}

const FOLDERS_FILE: &str = "workspace_folders.json";
/// Upper bound on files visited by one walk, so pointing the sidebar at a
/// home folder can't hang the app.
const MAX_WALK_FILES: usize = 50_000;
const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SEARCH_RESULTS: usize = 1_000;
const MAX_HITS_PER_FILE: usize = 50;
const PREVIEW_CHARS: usize = 160;
/// Front matter must start within the first bytes of the file and is never huge.
const MAX_FRONTMATTER_BYTES: usize = 64 * 1024;

/// Extensions searched by `search_workspace`; also the open dialog's filter.
pub const TEXT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "text", "csv", "tsv", "xml", "json", "json5", "yaml", "yml",
    "toml", "ini", "env", "cfg", "conf", "config", "html", "htm", "css", "scss", "sass",
    "less", "js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte", "astro", "c", "h",
    "cpp", "cc", "cxx", "hpp", "hxx", "cs", "java", "kt", "kts", "scala", "swift", "m",
    "mm", "zig", "v", "py", "pyw", "rb", "rbw", "lua", "pl", "pm", "php", "sh", "bash",
    "zsh", "fish", "ps1", "psm1", "bat", "cmd", "r", "rmd", "jl", "f", "f90", "f95", "for",
    "rs", "go", "ex", "exs", "erl", "hrl", "hs", "lhs", "ml", "mli", "fs", "fsx", "fsi",
    "clj", "cljs", "cljc", "lisp", "el", "vim", "dockerfile", "makefile", "cmake",
    "gradle", "properties", "plist", "tf", "tfvars", "hcl", "nix", "cabal", "tex", "rst",
    "adoc", "org", "wiki", "sql", "graphql", "gql", "proto", "thrift", "log", "diff",
    "patch",
];

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdwn", "mkdn"];

/// Directory names never worth walking into, even outside a git repo.
const SKIP_DIRS: &[&str] = &["node_modules", "__pycache__", ".git", "target", "dist-preview"];

fn authorized_roots() -> &'static Mutex<Vec<PathBuf>> {
    AUTHORIZED_ROOTS.get_or_init(|| Mutex::new(Vec::new()))
}

fn folders_lock() -> &'static Mutex<()> {
    FOLDERS_LOCK.get_or_init(|| Mutex::new(()))
}

/// True when `normalized` (already canonical) lies inside a granted folder.
pub fn is_under_authorized_root(normalized: &Path) -> bool {
    authorized_roots()
        .lock()
        .map(|roots| roots.iter().any(|root| normalized.starts_with(root)))
        .unwrap_or(false)
}

fn authorize_root(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !canonical.is_dir() {
        return Err("Workspace folder must be a directory".to_string());
    }
    {
        let mut roots = authorized_roots()
            .lock()
            .map_err(|_| "Workspace lock failed")?;
        if !roots.contains(&canonical) {
            roots.push(canonical.clone());
        }
    }
    // Local images inside the folder are loaded through the fs plugin.
    app.fs_scope()
        .allow_directory(&canonical, true)
        .map_err(|e| e.to_string())?;
    Ok(canonical)
}

/// Canonicalize `path` and require it to be inside a granted folder.
fn require_under_root(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("Workspace access requires an absolute path".to_string());
    }
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if is_under_authorized_root(&canonical) {
        Ok(canonical)
    } else {
        Err("Folder access was not authorized by a user selection".to_string())
    }
}

fn folders_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(data_dir.join(FOLDERS_FILE))
}

fn load_folders(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let path = folders_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn store_folders(app: &tauri::AppHandle, folders: &[String]) -> Result<(), String> {
    let path = folders_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string(folders).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn extension_of(path: &Path) -> String {
    // Extensionless files like `Makefile` match on their whole name, mirroring
    // the frontend's `split(".").pop()` check.
    path.extension()
        .or_else(|| path.file_name())
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn is_text_file(path: &Path) -> bool {
    TEXT_EXTENSIONS.contains(&extension_of(path).as_str())
}

fn is_markdown_file(path: &Path) -> bool {
    MARKDOWN_EXTENSIONS.contains(&extension_of(path).as_str())
}

/// Walk every non-hidden, non-ignored file under `root`, honoring .gitignore.
/// `visit` returns false to stop early. Returns true if the walk was cut off
/// by `MAX_WALK_FILES`.
fn walk_files(root: &Path, mut visit: impl FnMut(&Path) -> bool) -> bool {
    let home_library = std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library"));
    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .require_git(false)
        .git_global(false)
        .follow_links(false)
        .filter_entry(move |entry| {
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if !is_dir {
                return true;
            }
            let name = entry.file_name().to_str().unwrap_or("");
            if SKIP_DIRS.contains(&name) {
                return false;
            }
            // ~/Library is enormous and never holds notes.
            home_library.as_deref() != Some(entry.path())
        })
        .build();

    let mut visited = 0usize;
    for entry in walker.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        visited += 1;
        if visited > MAX_WALK_FILES {
            return true;
        }
        if !visit(entry.path()) {
            return false;
        }
    }
    false
}

// ---- Folder management ---------------------------------------------------

#[tauri::command]
pub async fn show_folder_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let picked = picked.into_path().map_err(|e| e.to_string())?;
    let root = path_string(&authorize_root(&app, &picked)?);

    let _guard = folders_lock().lock().map_err(|_| "Workspace lock failed")?;
    let mut folders = load_folders(&app)?;
    if !folders.contains(&root) {
        folders.push(root.clone());
        store_folders(&app, &folders)?;
    }
    drop(_guard);
    app.emit("workspace-folders-updated", folders).map_err(|e| e.to_string())?;
    Ok(Some(root))
}

#[tauri::command]
pub async fn read_workspace_folders(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let folders = {
        let _guard = folders_lock().lock().map_err(|_| "Workspace lock failed")?;
        load_folders(&app)?
    };
    // Missing folders (unmounted drive, deleted) stay persisted but aren't shown.
    Ok(folders
        .into_iter()
        .filter(|folder| authorize_root(&app, Path::new(folder)).is_ok())
        .collect())
}

/// Unpins a folder from the sidebar. Access already granted this session is
/// kept, so open tabs from that folder keep saving.
#[tauri::command]
pub async fn remove_workspace_folder(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<String>, String> {
    let _guard = folders_lock().lock().map_err(|_| "Workspace lock failed")?;
    let mut folders = load_folders(&app)?;
    folders.retain(|folder| folder != &path);
    store_folders(&app, &folders)?;
    drop(_guard);
    app.emit("workspace-folders-updated", folders.clone())
        .map_err(|e| e.to_string())?;
    Ok(folders)
}

// ---- Browsing --------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn list_dir(path: String, show_hidden: bool) -> Result<Vec<DirEntry>, String> {
    let dir = require_under_root(&path)?;
    let mut entries: Vec<DirEntry> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !show_hidden && name.starts_with('.') {
                return None;
            }
            // Follow symlinks for the dir/file distinction; skip broken links.
            let is_dir = fs::metadata(entry.path()).ok()?.is_dir();
            Some(DirEntry {
                name,
                path: path_string(&dir.join(entry.file_name())),
                is_dir,
            })
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[derive(Debug, Serialize)]
pub struct FileList {
    pub files: Vec<String>,
    pub truncated: bool,
}

/// Every file under `root`, for the quick switcher. The frontend filters to
/// openable types with `isOpenableTextFile` so the list has one definition.
#[tauri::command]
pub async fn list_workspace_files(root: String) -> Result<FileList, String> {
    let root = require_under_root(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        let truncated = walk_files(&root, |path| {
            files.push(path_string(path));
            true
        });
        FileList { files, truncated }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Reveal a file or folder in Finder.
#[tauri::command]
pub async fn reveal_in_finder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = require_under_root(&path)?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| e.to_string())
}

/// Open a non-text file (PDF, image, …) with its default macOS app.
#[tauri::command]
pub async fn open_with_default_app(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = require_under_root(&path)?;
    if path.is_dir() {
        return Err("Folders are browsed in the sidebar".to_string());
    }
    app.opener()
        .open_path(path_string(&path), None::<&str>)
        .map_err(|e| e.to_string())
}

// ---- Creating and renaming --------------------------------------------------

fn contains_authorized_root(path: &Path) -> bool {
    // A final symlink is renamed/trashed as a link, leaving its target alone.
    // Resolve real entries for case-insensitive filesystems before comparing.
    if fs::symlink_metadata(path).map(|m| m.file_type().is_symlink()).unwrap_or(false) {
        return false;
    }
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    authorized_roots()
        .lock()
        .map(|roots| roots.iter().any(|root| root.starts_with(&canonical)))
        .unwrap_or(true)
}

/// Resolve `path` without following a final symlink (so renaming a link
/// renames the link, not its target) and require it inside a granted folder.
fn require_entry_under_root(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    let name = path.file_name().ok_or("Invalid path")?;
    let parent = require_under_root(&path_string(path.parent().ok_or("Invalid path")?))?;
    let entry = parent.join(name);
    fs::symlink_metadata(&entry).map_err(|e| e.to_string())?;
    Ok(entry)
}

/// A single path component the user typed: trimmed, with no separators.
fn validate_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err("Enter a name".to_string());
    }
    if name.contains('/') || name.contains('\0') {
        return Err("Names can't contain \"/\"".to_string());
    }
    Ok(name.to_string())
}

fn same_file(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (fs::symlink_metadata(a), fs::symlink_metadata(b)) {
        (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
        _ => false,
    }
}

/// Create `Untitled.md` (kind "file") or an `Untitled` folder (kind "folder")
/// in `dir`, numbering it (`Untitled 2.md`, …) if the name is taken.
#[tauri::command]
pub async fn create_untitled(dir: String, kind: String) -> Result<String, String> {
    let dir = require_under_root(&dir)?;
    if !dir.is_dir() {
        return Err("Not a folder".to_string());
    }
    let folder = kind == "folder";
    for n in 1..1000 {
        let stem = if n == 1 { "Untitled".to_string() } else { format!("Untitled {n}") };
        let path = dir.join(if folder { stem } else { format!("{stem}.md") });
        let created = if folder {
            fs::create_dir(&path)
        } else {
            fs::OpenOptions::new().write(true).create_new(true).open(&path).map(|_| ())
        };
        match created {
            Ok(()) => return Ok(path_string(&path)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Too many untitled items in this folder".to_string())
}

/// Rename a file or folder in place (same parent folder). Returns the new path.
#[tauri::command]
pub async fn rename_path(path: String, new_name: String) -> Result<String, String> {
    let from = require_entry_under_root(&path)?;
    if contains_authorized_root(&from) {
        return Err("This folder contains an opened folder. Rename it in Finder, then open it again".to_string());
    }
    let name = validate_name(&new_name)?;
    let to = from.parent().ok_or("Invalid path")?.join(&name);
    if to == from {
        return Ok(path_string(&from));
    }
    // On macOS's case-insensitive disks "notes.md" → "Notes.md" points at the
    // same file; that rename is allowed, any other existing name is not.
    if fs::symlink_metadata(&to).is_ok() && !same_file(&from, &to) {
        return Err(format!("\"{name}\" already exists"));
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())?;
    Ok(path_string(&to))
}

fn trash_context() -> trash::TrashContext {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut context = trash::TrashContext::default();
        // Finder's AppleScript method can block on an Automation permission
        // prompt. NSFileManager moves items to Trash without that permission.
        context.set_delete_method(DeleteMethod::NsFileManager);
        context
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::TrashContext::default()
    }
}

/// Move a file or folder to the system Trash (recoverable).
#[tauri::command]
pub async fn move_to_trash(path: String) -> Result<(), String> {
    let entry = require_entry_under_root(&path)?;
    if contains_authorized_root(&entry) {
        return Err("Remove an opened folder from the sidebar instead".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || trash_context().delete(&entry).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

// ---- Full-text search ------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct SearchHit {
    /// 1-based line number.
    pub line: usize,
    /// The matching line, trimmed to a window around the first match.
    pub preview: String,
}

#[derive(Debug, Serialize)]
pub struct FileHits {
    pub path: String,
    pub hits: Vec<SearchHit>,
}

#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub files: Vec<FileHits>,
    pub truncated: bool,
    /// True when a newer search started before this one finished.
    pub cancelled: bool,
}

fn preview_around(line: &str, match_char_index: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= PREVIEW_CHARS {
        return line.trim().to_string();
    }
    let start = match_char_index.saturating_sub(PREVIEW_CHARS / 3);
    let end = (start + PREVIEW_CHARS).min(chars.len());
    let mut out: String = chars[start..end].iter().collect();
    if start > 0 {
        out.insert(0, '…');
    }
    if end < chars.len() {
        out.push('…');
    }
    out.trim().to_string()
}

/// Case-insensitive line matches of `query` within one file's text.
fn search_text(text: &str, query_lower: &str) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let lower = line.to_lowercase();
        if let Some(byte_index) = lower.find(query_lower) {
            // Lowercasing can change byte lengths, so locate the match by char
            // count in the lowered line; it maps 1:1 for nearly all text.
            let char_index = lower[..byte_index].chars().count();
            hits.push(SearchHit {
                line: index + 1,
                preview: preview_around(line, char_index),
            });
            if hits.len() >= MAX_HITS_PER_FILE {
                break;
            }
        }
    }
    hits
}

/// Search `root` for `query`. With `paths`, only those files are searched (the
/// notes matching a tag filter); each must lie inside `root`.
#[tauri::command]
pub async fn search_workspace(
    window: tauri::WebviewWindow,
    root: String,
    query: String,
    paths: Option<Vec<String>>,
) -> Result<SearchResults, String> {
    let root = require_under_root(&root)?;
    let (search_generation, generation) = next_search_generation(window.label())?;
    let query_lower = query.trim().to_lowercase();
    if query_lower.is_empty() {
        return Ok(SearchResults { files: vec![], truncated: false, cancelled: false });
    }
    let only: Option<Vec<PathBuf>> = paths.map(|paths| {
        paths
            .iter()
            .filter_map(|p| fs::canonicalize(p).ok())
            .filter(|p| p.starts_with(&root))
            .collect()
    });

    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        let mut total_hits = 0usize;
        let mut cancelled = false;
        let mut hit_limit = false;
        let mut visit = |path: &Path| {
            if search_generation.load(Ordering::SeqCst) != generation {
                cancelled = true;
                return false;
            }
            if !is_text_file(path) {
                return true;
            }
            let too_big = fs::metadata(path)
                .map(|m| m.len() > MAX_SEARCH_FILE_BYTES)
                .unwrap_or(true);
            if too_big {
                return true;
            }
            // Non-UTF-8 files are skipped, matching what the editor can open.
            let Ok(text) = fs::read_to_string(path) else {
                return true;
            };
            let hits = search_text(&text, &query_lower);
            if !hits.is_empty() {
                total_hits += hits.len();
                files.push(FileHits { path: path_string(path), hits });
                if total_hits >= MAX_SEARCH_RESULTS {
                    hit_limit = true;
                    return false;
                }
            }
            true
        };
        let walk_truncated = match &only {
            Some(list) => {
                for path in list {
                    if !visit(path) {
                        break;
                    }
                }
                false
            }
            None => walk_files(&root, &mut visit),
        };
        SearchResults {
            files,
            truncated: walk_truncated || hit_limit,
            cancelled,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

// ---- Note metadata index (front matter, which holds note tags) --------------

#[derive(Debug, Serialize)]
pub struct NoteMetadata {
    pub path: String,
    /// Raw YAML between the `---` fences; parsed by the frontend (lib/tags.ts).
    pub frontmatter: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MetadataIndex {
    pub notes: Vec<NoteMetadata>,
    pub truncated: bool,
}

/// Extract the YAML of a leading `---` front-matter block, if any.
fn extract_frontmatter(text: &str) -> Option<String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines();
    if lines.next()?.trim_end() != "---" {
        return None;
    }
    let mut yaml = Vec::new();
    for line in lines {
        let trimmed = line.trim_end();
        if trimmed == "---" || trimmed == "..." {
            return Some(yaml.join("\n"));
        }
        yaml.push(line);
    }
    None
}

fn read_note_metadata(path: &Path) -> Option<NoteMetadata> {
    use std::io::Read;
    let file = fs::File::open(path).ok()?;
    let mut head = Vec::with_capacity(4096);
    file.take(MAX_FRONTMATTER_BYTES as u64)
        .read_to_end(&mut head)
        .ok()?;
    let frontmatter = extract_frontmatter(&String::from_utf8_lossy(&head))?;
    Some(NoteMetadata { path: path_string(path), frontmatter: Some(frontmatter) })
}

/// Front matter of every Markdown note under `root`.
#[tauri::command]
pub async fn read_workspace_metadata(root: String) -> Result<MetadataIndex, String> {
    let root = require_under_root(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut notes = Vec::new();
        let truncated = walk_files(&root, |path| {
            if is_markdown_file(path) {
                if let Some(meta) = read_note_metadata(path) {
                    notes.push(meta);
                }
            }
            true
        });
        MetadataIndex { notes, truncated }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{extension_of, extract_frontmatter, preview_around, search_text, validate_name};
    use std::path::Path;

    #[cfg(target_os = "macos")]
    #[test]
    fn trash_uses_native_file_manager_without_finder_automation() {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        assert!(matches!(super::trash_context().delete_method(), DeleteMethod::NsFileManager));
    }

    #[test]
    fn frontmatter_requires_leading_fence_and_closing_fence() {
        assert_eq!(
            extract_frontmatter("---\ntags: [a, b]\nstatus: draft\n---\n# Body").as_deref(),
            Some("tags: [a, b]\nstatus: draft")
        );
        assert_eq!(extract_frontmatter("---\ntitle: x\n...\nbody").as_deref(), Some("title: x"));
        assert_eq!(extract_frontmatter("# Heading\n---\ntags: a\n---"), None);
        assert_eq!(extract_frontmatter("---\nunterminated: true\n"), None);
        assert_eq!(extract_frontmatter("\u{feff}---\na: 1\n---").as_deref(), Some("a: 1"));
    }

    #[test]
    fn search_is_case_insensitive_and_reports_one_based_lines() {
        let hits = search_text("alpha\nBeta gamma\nbeta again", "beta");
        assert_eq!(hits.iter().map(|h| h.line).collect::<Vec<_>>(), vec![2, 3]);
        assert_eq!(hits[0].preview, "Beta gamma");
    }

    #[test]
    fn long_lines_are_windowed_around_the_match() {
        let line = format!("{}needle{}", "x".repeat(400), "y".repeat(400));
        let preview = preview_around(&line, 400);
        assert!(preview.contains("needle"));
        assert!(preview.starts_with('…') && preview.ends_with('…'));
        assert!(preview.chars().count() <= super::PREVIEW_CHARS + 2);
    }

    #[test]
    fn create_and_rename_inside_a_granted_folder() {
        use super::{authorized_roots, create_untitled, rename_path};
        let tmp = std::env::temp_dir().join(format!("bioscratch-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let root = std::fs::canonicalize(&tmp).unwrap();
        authorized_roots().lock().unwrap().push(root.clone());
        let dir = root.to_string_lossy().to_string();
        use tauri::async_runtime::block_on as run;

        // New items are numbered when the name is taken.
        let a = run(create_untitled(dir.clone(), "file".into())).unwrap();
        let b = run(create_untitled(dir.clone(), "file".into())).unwrap();
        let f = run(create_untitled(dir.clone(), "folder".into())).unwrap();
        assert!(a.ends_with("/Untitled.md") && b.ends_with("/Untitled 2.md") && f.ends_with("/Untitled"));

        // Rename, refuse clobbering, allow a case-only change.
        let notes = run(rename_path(a.clone(), "Notes.md".into())).unwrap();
        assert!(notes.ends_with("/Notes.md"));
        assert!(run(rename_path(b.clone(), "Notes.md".into())).is_err());
        let lower = run(rename_path(notes.clone(), "notes.md".into())).unwrap();
        assert!(lower.ends_with("/notes.md"));
        assert!(run(rename_path(f.clone(), "a/b".into())).is_err());

        // An opened (granted) folder itself can't be renamed or trashed from the tree.
        assert!(run(rename_path(dir.clone(), "Other".into())).is_err());
        assert!(run(super::move_to_trash(dir.clone())).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn renaming_an_ancestor_cannot_invalidate_a_pinned_root() {
        use super::{authorized_roots, contains_authorized_root, rename_path};
        use std::os::unix::fs::symlink;
        let tmp = std::env::temp_dir().join(format!("bioscratch-root-rename-test-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join("parent/pinned")).unwrap();
        let root = std::fs::canonicalize(&tmp).unwrap();
        let parent = root.join("parent");
        let pinned = parent.join("pinned");
        authorized_roots().lock().unwrap().extend([root.clone(), pinned.clone()]);
        use tauri::async_runtime::block_on as run;

        assert!(run(rename_path(parent.to_string_lossy().into(), "renamed".into())).is_err());
        assert!(pinned.is_dir());
        // A link to the pinned root can still be renamed: its target stays put.
        let link = root.join("link");
        symlink(&pinned, &link).unwrap();
        assert!(!contains_authorized_root(&link));
        let renamed_link = run(rename_path(link.to_string_lossy().into(), "renamed-link".into())).unwrap();
        assert!(std::fs::symlink_metadata(renamed_link).unwrap().file_type().is_symlink());
        assert!(pinned.is_dir());
        authorized_roots().lock().unwrap().retain(|p| p != &root && p != &pinned);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn searches_cancel_only_earlier_searches_in_the_same_window() {
        use super::next_search_generation;
        use std::sync::atomic::Ordering;
        let (first, first_generation) = next_search_generation("search-test-window-a").unwrap();
        let (other, other_generation) = next_search_generation("search-test-window-b").unwrap();
        assert_eq!(first.load(Ordering::SeqCst), first_generation);
        let (_, newer_generation) = next_search_generation("search-test-window-a").unwrap();
        assert_ne!(first.load(Ordering::SeqCst), first_generation);
        assert_eq!(first.load(Ordering::SeqCst), newer_generation);
        assert_eq!(other.load(Ordering::SeqCst), other_generation);
    }

    #[test]
    fn ordinary_folders_honor_gitignore_without_a_git_repository() {
        let tmp = std::env::temp_dir().join(format!("bioscratch-ignore-test-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join("ignored-folder")).unwrap();
        std::fs::write(tmp.join(".gitignore"), "ignored.md\nignored-folder/\n").unwrap();
        std::fs::write(tmp.join("ignored.md"), "not searched").unwrap();
        std::fs::write(tmp.join("ignored-folder/note.md"), "not indexed").unwrap();
        std::fs::write(tmp.join("kept.md"), "searched and indexed").unwrap();
        let mut files = Vec::new();
        assert!(!super::walk_files(&tmp, |path| {
            files.push(path.strip_prefix(&tmp).unwrap().to_path_buf());
            true
        }));
        assert_eq!(files, vec![std::path::PathBuf::from("kept.md")]);
        std::fs::remove_dir_all(tmp).unwrap();
    }

    #[test]
    fn names_are_single_trimmed_components() {
        assert_eq!(validate_name("  Notes.md ").as_deref(), Ok("Notes.md"));
        assert!(validate_name("").is_err());
        assert!(validate_name("..").is_err());
        assert!(validate_name("a/b").is_err());
    }

    #[test]
    fn extensionless_files_match_on_their_name() {
        assert_eq!(extension_of(Path::new("/repo/Makefile")), "makefile");
        assert_eq!(extension_of(Path::new("/notes/Lab.MD")), "md");
    }
}
