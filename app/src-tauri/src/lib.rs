use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

mod dev_bridge;

// Static storage so the pending file path is always accessible — even if
// RunEvent::Opened fires before setup() has registered Tauri managed state.
static PENDING_FILE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static AUTHORIZED_FILES: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

fn pending_file_storage() -> &'static Mutex<Option<String>> {
    PENDING_FILE.get_or_init(|| Mutex::new(None))
}

fn preferred_open_file_window(windows: &[(String, bool)]) -> Option<String> {
    windows
        .iter()
        .find(|(_, focused)| *focused)
        .or_else(|| windows.iter().find(|(label, _)| label == "main"))
        .or_else(|| windows.first())
        .map(|(label, _)| label.clone())
}

fn authorized_files() -> &'static Mutex<HashSet<PathBuf>> {
    AUTHORIZED_FILES.get_or_init(|| Mutex::new(HashSet::new()))
}

fn normalized_access_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("File access requires an absolute path".to_string());
    }
    if path.exists() {
        return fs::canonicalize(path).map_err(|e| e.to_string());
    }
    let parent = path.parent().ok_or("Invalid file path")?;
    let filename = path.file_name().ok_or("Invalid file path")?;
    let canonical_parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    Ok(canonical_parent.join(filename))
}

fn authorize_document_path(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    let normalized = normalized_access_path(path)?;
    authorized_files()
        .lock()
        .map_err(|_| "File access lock failed")?
        .insert(normalized.clone());

    // Local images are resolved by the fs plugin. Grant only the selected
    // document's directory instead of every file below the user's home folder.
    if let Some(parent) = normalized.parent() {
        app.fs_scope()
            .allow_directory(parent, true)
            .map_err(|e| e.to_string())?;
    }
    Ok(normalized)
}

fn require_authorized_path(path: &str) -> Result<PathBuf, String> {
    let normalized = normalized_access_path(Path::new(path))?;
    let allowed = authorized_files()
        .lock()
        .map_err(|_| "File access lock failed")?
        .contains(&normalized);
    if allowed {
        Ok(normalized)
    } else {
        Err("File access was not authorized by a user selection".to_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct UserTheme {
    pub filename: String,
    pub content: String,
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    let path = require_authorized_path(&path)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    let path = require_authorized_path(&path)?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn show_open_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .add_filter(
            "Text files",
            &[
                "md",
                "markdown",
                "txt",
                "text",
                "csv",
                "tsv",
                "xml",
                "json",
                "json5",
                "yaml",
                "yml",
                "toml",
                "ini",
                "env",
                "cfg",
                "conf",
                "config",
                "html",
                "htm",
                "css",
                "scss",
                "sass",
                "less",
                "js",
                "jsx",
                "ts",
                "tsx",
                "mjs",
                "cjs",
                "vue",
                "svelte",
                "astro",
                "c",
                "h",
                "cpp",
                "cc",
                "cxx",
                "hpp",
                "hxx",
                "cs",
                "java",
                "kt",
                "kts",
                "scala",
                "swift",
                "m",
                "mm",
                "zig",
                "v",
                "py",
                "pyw",
                "rb",
                "rbw",
                "lua",
                "pl",
                "pm",
                "php",
                "sh",
                "bash",
                "zsh",
                "fish",
                "ps1",
                "psm1",
                "bat",
                "cmd",
                "r",
                "rmd",
                "jl",
                "f",
                "f90",
                "f95",
                "for",
                "rs",
                "go",
                "ex",
                "exs",
                "erl",
                "hrl",
                "hs",
                "lhs",
                "ml",
                "mli",
                "fs",
                "fsx",
                "fsi",
                "clj",
                "cljs",
                "cljc",
                "lisp",
                "el",
                "vim",
                "dockerfile",
                "makefile",
                "cmake",
                "gradle",
                "properties",
                "plist",
                "tf",
                "tfvars",
                "hcl",
                "nix",
                "cabal",
                "tex",
                "rst",
                "adoc",
                "org",
                "wiki",
                "sql",
                "graphql",
                "gql",
                "proto",
                "thrift",
                "log",
                "diff",
                "patch",
            ],
        )
        .blocking_pick_file();
    match path {
        Some(p) => {
            let path = p.to_string();
            authorize_document_path(&app, Path::new(&path))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn show_save_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("Plain text", &["txt"])
        .add_filter("All files", &["*"])
        .set_file_name("blank.md")
        .blocking_save_file();
    match path {
        Some(p) => {
            let path = p.to_string();
            authorize_document_path(&app, Path::new(&path))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_recent_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let recent_path = data_dir.join("recent_files.json");
    if recent_path.exists() {
        let content = fs::read_to_string(&recent_path).map_err(|e| e.to_string())?;
        let files: Vec<String> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        for file in &files {
            let _ = authorize_document_path(&app, Path::new(file));
        }
        Ok(files)
    } else {
        Ok(vec![])
    }
}

#[tauri::command]
async fn save_recent_files(app: tauri::AppHandle, files: Vec<String>) -> Result<(), String> {
    for file in &files {
        require_authorized_path(file)?;
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let recent_path = data_dir.join("recent_files.json");
    let content = serde_json::to_string(&files).map_err(|e| e.to_string())?;
    fs::write(&recent_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_autosave(app: tauri::AppHandle, key: String, content: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let autosave_dir = data_dir.join("autosave");
    fs::create_dir_all(&autosave_dir).map_err(|e| e.to_string())?;
    let safe_key = key.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    fs::write(autosave_dir.join(format!("{}.md", safe_key)), content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_autosave(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let safe_key = key.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let path = data_dir.join("autosave").join(format!("{}.md", safe_key));
    if path.exists() {
        Ok(Some(fs::read_to_string(&path).map_err(|e| e.to_string())?))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn delete_autosave(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let safe_key = key.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let path = data_dir.join("autosave").join(format!("{}.md", safe_key));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn list_user_themes(app: tauri::AppHandle) -> Result<Vec<UserTheme>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let themes_dir = data_dir.join("user_themes");
    if !themes_dir.exists() {
        return Ok(vec![]);
    }
    let mut themes = vec![];
    for entry in fs::read_dir(&themes_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            themes.push(UserTheme { filename, content });
        }
    }
    Ok(themes)
}

#[tauri::command]
async fn save_user_theme(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let themes_dir = data_dir.join("user_themes");
    fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;
    // Sanitize filename: only allow safe characters
    let safe_name: String = filename
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let safe_name = if safe_name.ends_with(".yaml") {
        safe_name
    } else {
        format!("{}.yaml", safe_name)
    };
    fs::write(themes_dir.join(&safe_name), content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_user_theme(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let themes_dir = data_dir.join("user_themes");
    // Only allow filenames without path separators for safety
    let safe_name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?
        .to_string();
    let path = themes_dir.join(&safe_name);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn export_html(path: String, html: String) -> Result<(), String> {
    let path = require_authorized_path(&path)?;
    fs::write(path, html).map_err(|e| e.to_string())
}

#[tauri::command]
async fn show_html_save_dialog(
    app: tauri::AppHandle,
    filename: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let default_name = filename.unwrap_or_else(|| "document.html".to_string());
    let path = app
        .dialog()
        .file()
        .add_filter("HTML", &["html"])
        .set_file_name(&default_name)
        .blocking_save_file();
    match path {
        Some(p) => {
            let path = p.to_string();
            authorize_document_path(&app, Path::new(&path))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn export_pdf_pandoc(
    app: tauri::AppHandle,
    markdown: String,
    filename: Option<String>,
    doc_path: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;

    let base = filename.as_deref().unwrap_or("document");
    let base = base.trim_end_matches(".md").trim_end_matches(".markdown");
    let suggested = format!("{}.pdf", base);

    let path = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&suggested)
        .blocking_save_file();

    let output_path = match path {
        Some(p) => p.to_string(),
        None => return Ok(()), // user cancelled
    };

    let temp_md = std::env::temp_dir().join("bioscratch_export.md");
    fs::write(&temp_md, &markdown).map_err(|e| e.to_string())?;

    // Resolve resource path: use the source document's directory so that
    // relative image paths (e.g. img/shiba.jpg) resolve correctly.
    let resource_path = doc_path
        .as_deref()
        .and_then(|p| std::path::Path::new(p).parent())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| std::env::temp_dir().to_string_lossy().to_string());

    // Prefer a Bioscratch-managed pandoc (installed via install_pdf_dependencies)
    // and fall back to whatever is on PATH.
    let pandoc_bin = resolve_pandoc(&app);

    // Producing a PDF needs a PDF engine. Prefer a LaTeX engine on PATH; otherwise
    // fall back to a Bioscratch-managed `typst` binary (a single static executable
    // that needs no further dependencies). If neither is available, signal the
    // frontend so it can offer an in-app install.
    let latex = latex_engine_available();
    let typst = resolve_typst(&app);
    if !latex && typst.is_none() {
        // Make sure pandoc itself exists first so we surface the right prompt.
        if !pandoc_runs(&pandoc_bin) {
            return Err("PANDOC_NOT_INSTALLED".to_string());
        }
        return Err("PDF_ENGINE_NOT_INSTALLED".to_string());
    }

    let mut cmd = std::process::Command::new(&pandoc_bin);
    cmd.arg(temp_md.to_str().unwrap_or(""))
        .arg("-o")
        .arg(&output_path)
        .arg("--standalone")
        .arg("--from=markdown-implicit_figures")
        .arg(format!("--resource-path={}", resource_path));
    if !latex {
        if let Some(typst_bin) = &typst {
            cmd.arg(format!("--pdf-engine={}", typst_bin.to_string_lossy()));
        }
    }

    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            // Sentinel the frontend recognises to offer an in-app install.
            "PANDOC_NOT_INSTALLED".to_string()
        } else {
            format!("Failed to run pandoc: {}", e)
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Pandoc error: {}", stderr));
    }

    Ok(())
}

#[tauri::command]
async fn show_pdf_save_dialog(
    app: tauri::AppHandle,
    filename: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let default_name = filename.unwrap_or_else(|| "document.pdf".to_string());
    let path = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&default_name)
        .blocking_save_file();
    match path {
        Some(p) => {
            let path = p.to_string();
            authorize_document_path(&app, Path::new(&path))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

/// Export a fully self-contained HTML document to PDF. The frontend builds the
/// HTML to mirror exactly what the editor shows (the YAML banner, KaTeX math,
/// syntax-highlighted code, rendered Mermaid SVG, tables, images), with the
/// app's own CSS inlined. We render it in an *offscreen* WKWebView — a clean,
/// block-flow document that paginates correctly — and print it to PDF natively.
/// No Markdown→LaTeX round-trip, so the output is honest to the HTML.
#[tauri::command]
fn export_pdf_html(app: tauri::AppHandle, html: String, output_path: String) -> Result<(), String> {
    let output_path = require_authorized_path(&output_path)?
        .to_string_lossy()
        .to_string();
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let html_owned = html;
        let out = output_path;
        app.run_on_main_thread(move || {
            let res = unsafe { render_html_to_pdf(&html_owned, &out) };
            let _ = tx.send(res);
        })
        .map_err(|e| format!("Could not schedule PDF render: {e}"))?;
        rx.recv()
            .map_err(|e| format!("PDF export did not complete: {e}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, html, output_path);
        Err("PDF export is only supported on macOS.".to_string())
    }
}

/// Render `html` in an offscreen WKWebView and capture it to a PDF at
/// `output_path` using `-[WKWebView createPDFWithConfiguration:completionHandler:]`
/// (macOS 11+). This API captures the rendered content directly to PDF data —
/// no print/pagination machinery — so it can't run away, and the output is an
/// exact, honest reproduction of the HTML. Must run on the main thread.
#[cfg(target_os = "macos")]
unsafe fn render_html_to_pdf(html: &str, output_path: &str) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::time::{Duration, Instant};

    let config: *mut AnyObject = msg_send![class!(WKWebViewConfiguration), new];
    if config.is_null() {
        return Err("Could not create WKWebViewConfiguration.".to_string());
    }
    // 8.5in content width at 96dpi sets the layout/line width; createPDF captures
    // the full content height regardless of this initial frame height.
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(816.0, 1056.0));
    let alloc: *mut AnyObject = msg_send![class!(WKWebView), alloc];
    let webview: *mut AnyObject = msg_send![alloc, initWithFrame: frame, configuration: config];
    if webview.is_null() {
        return Err("Could not create the offscreen WebView.".to_string());
    }

    // Load the self-contained document (CDN assets resolve via absolute URLs).
    let html_ns = NSString::from_str(html);
    let nil: *mut AnyObject = std::ptr::null_mut();
    let _: *mut AnyObject = msg_send![webview, loadHTMLString: &*html_ns, baseURL: nil];

    let run_loop: *mut AnyObject = msg_send![class!(NSRunLoop), currentRunLoop];
    let mode = NSString::from_str("kCFRunLoopDefaultMode");

    // Wait for the load to finish, then a short settle for fonts/remote images.
    let start = Instant::now();
    let mut settle_start: Option<Instant> = None;
    loop {
        let date: *mut AnyObject = msg_send![class!(NSDate), dateWithTimeIntervalSinceNow: 0.02f64];
        let _: bool = msg_send![run_loop, runMode: &*mode, beforeDate: date];
        let loading: bool = msg_send![webview, isLoading];
        if !loading {
            if settle_start.is_none() {
                settle_start = Some(Instant::now());
            }
            if settle_start.unwrap().elapsed() >= Duration::from_millis(600) {
                break;
            }
        } else {
            settle_start = None;
        }
        if start.elapsed() >= Duration::from_secs(12) {
            break;
        }
    }

    // Capture to PDF. The completion handler runs asynchronously on this run loop.
    let pdf_config: *mut AnyObject = msg_send![class!(WKPDFConfiguration), new];

    let result: Rc<RefCell<Option<Result<Vec<u8>, String>>>> = Rc::new(RefCell::new(None));
    let result_cb = result.clone();
    let handler = block2::RcBlock::new(move |data: *mut AnyObject, error: *mut AnyObject| unsafe {
        if !error.is_null() {
            let desc: *mut AnyObject = msg_send![error, localizedDescription];
            *result_cb.borrow_mut() = Some(Err(format!(
                "createPDF failed: {}",
                nsstring_to_string(desc)
            )));
            return;
        }
        if data.is_null() {
            *result_cb.borrow_mut() = Some(Err("createPDF returned no data.".to_string()));
            return;
        }
        let len: usize = msg_send![data, length];
        let bytes: *const u8 = msg_send![data, bytes];
        let v = if bytes.is_null() || len == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(bytes, len).to_vec()
        };
        *result_cb.borrow_mut() = Some(Ok(v));
    });

    let _: () =
        msg_send![webview, createPDFWithConfiguration: pdf_config, completionHandler: &*handler];

    // Pump the run loop until the completion handler fires (hard ceiling).
    let pdf_start = Instant::now();
    loop {
        if result.borrow().is_some() {
            break;
        }
        let date: *mut AnyObject = msg_send![class!(NSDate), dateWithTimeIntervalSinceNow: 0.02f64];
        let _: bool = msg_send![run_loop, runMode: &*mode, beforeDate: date];
        if pdf_start.elapsed() >= Duration::from_secs(20) {
            return Err("createPDF timed out.".to_string());
        }
    }

    let outcome = result.borrow_mut().take().unwrap();
    let bytes = outcome?;
    if bytes.is_empty() {
        return Err("createPDF produced an empty PDF.".to_string());
    }
    std::fs::write(output_path, &bytes).map_err(|e| format!("Could not write PDF: {e}"))?;
    Ok(())
}

/// Convert an NSString pointer to a Rust String (best-effort).
#[cfg(target_os = "macos")]
unsafe fn nsstring_to_string(s: *mut objc2::runtime::AnyObject) -> String {
    use objc2::msg_send;
    if s.is_null() {
        return String::new();
    }
    let utf8: *const std::os::raw::c_char = msg_send![s, UTF8String];
    if utf8.is_null() {
        return String::new();
    }
    std::ffi::CStr::from_ptr(utf8)
        .to_string_lossy()
        .into_owned()
}

/// Resolve the pandoc executable to use: a Bioscratch-managed binary in the app
/// data dir if present, otherwise plain `pandoc` (resolved from PATH at run time).
fn resolve_pandoc(app: &tauri::AppHandle) -> std::path::PathBuf {
    if let Ok(dir) = app.path().app_data_dir() {
        let managed = dir.join("bin").join("pandoc");
        if managed.exists() {
            return managed;
        }
    }
    std::path::PathBuf::from("pandoc")
}

/// Recursively search `dir` for a file named exactly `name`.
fn find_file_named(dir: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_named(&path, name) {
                return Some(found);
            }
        } else if path.file_name().and_then(|n| n.to_str()) == Some(name) {
            return Some(path);
        }
    }
    None
}

/// Returns true if the given executable runs successfully with `--version`.
fn binary_runs(bin: &std::path::Path) -> bool {
    std::process::Command::new(bin)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// True if any common LaTeX-based PDF engine is available on PATH.
fn latex_engine_available() -> bool {
    ["pdflatex", "xelatex", "lualatex", "tectonic"]
        .iter()
        .any(|e| {
            std::process::Command::new(e)
                .arg("--version")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
}

/// Returns true if pandoc (managed or on PATH) can be executed.
fn pandoc_runs(bin: &std::path::Path) -> bool {
    binary_runs(bin)
}

/// Resolve a Bioscratch-managed `typst` binary (a self-contained PDF engine) if
/// one has been installed into the app data dir.
fn resolve_typst(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let managed = dir.join("bin").join("typst");
    if managed.exists() {
        Some(managed)
    } else {
        None
    }
}

/// True when a full PDF-export toolchain (pandoc + a PDF engine) is ready.
#[tauri::command]
async fn pdf_export_ready(app: tauri::AppHandle) -> Result<bool, String> {
    let has_pandoc = pandoc_runs(&resolve_pandoc(&app));
    let has_engine = latex_engine_available() || resolve_typst(&app).is_some();
    Ok(has_pandoc && has_engine)
}

/// Download `url`, extract it, locate a file named `bin_name`, and install it as
/// an executable at `bin_dir/bin_name`. Uses only tools that ship with macOS
/// (`curl`, plus `unzip` or `tar`), so no Homebrew/git/etc. is required.
fn download_and_extract_binary(
    url: &str,
    bin_name: &str,
    bin_dir: &std::path::Path,
    is_tar_xz: bool,
) -> Result<std::path::PathBuf, String> {
    let archive = std::env::temp_dir().join(format!("bioscratch_dl_{}", bin_name));
    let extract_dir = std::env::temp_dir().join(format!("bioscratch_extract_{}", bin_name));
    let _ = fs::remove_dir_all(&extract_dir);
    fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;

    // Download (follow redirects, fail loudly on HTTP errors).
    let dl = std::process::Command::new("curl")
        .args([
            "-L",
            "--fail",
            "--silent",
            "--show-error",
            "-o",
            archive.to_str().unwrap_or(""),
            url,
        ])
        .output()
        .map_err(|e| format!("Failed to start download: {}", e))?;
    if !dl.status.success() {
        return Err(format!(
            "Download failed: {}",
            String::from_utf8_lossy(&dl.stderr).trim()
        ));
    }

    // Extract. macOS `tar` (bsdtar) autodetects xz; `unzip` handles zips.
    let extract = if is_tar_xz {
        std::process::Command::new("tar")
            .args([
                "-xf",
                archive.to_str().unwrap_or(""),
                "-C",
                extract_dir.to_str().unwrap_or(""),
            ])
            .output()
    } else {
        std::process::Command::new("unzip")
            .args([
                "-o",
                "-q",
                archive.to_str().unwrap_or(""),
                "-d",
                extract_dir.to_str().unwrap_or(""),
            ])
            .output()
    }
    .map_err(|e| format!("Failed to extract archive: {}", e))?;
    if !extract.status.success() {
        return Err(format!(
            "Extract failed: {}",
            String::from_utf8_lossy(&extract.stderr).trim()
        ));
    }

    // Locate the binary in the extracted tree and install it.
    let found = find_file_named(&extract_dir, bin_name)
        .ok_or_else(|| format!("{} binary not found in downloaded archive", bin_name))?;
    let dest = bin_dir.join(bin_name);
    fs::copy(&found, &dest).map_err(|e| format!("Failed to install {}: {}", bin_name, e))?;
    let _ = std::process::Command::new("chmod")
        .args(["+x", dest.to_str().unwrap_or("")])
        .status();

    let _ = fs::remove_file(&archive);
    let _ = fs::remove_dir_all(&extract_dir);
    Ok(dest)
}

/// Download and install the PDF-export toolchain into the app data dir.
///
/// Relies only on tools that ship with macOS (`curl`, `unzip`, `tar`, `chmod`),
/// so it works even with no Homebrew, no git, and no pre-existing pandoc/LaTeX.
/// Installs pandoc if it is missing, and a self-contained `typst` PDF engine if
/// no LaTeX engine is present — leaving PDF export fully functional afterward.
#[tauri::command]
async fn install_pdf_dependencies(app: tauri::AppHandle) -> Result<String, String> {
    const PANDOC_VERSION: &str = "3.2";
    const TYPST_VERSION: &str = "v0.12.0";

    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bin_dir = data_dir.join("bin");
    fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

    let mut installed: Vec<String> = Vec::new();

    // 1. Pandoc — only if it can't already be run (managed or on PATH).
    if !pandoc_runs(&resolve_pandoc(&app)) {
        let pandoc_arch = match std::env::consts::ARCH {
            "aarch64" => "arm64",
            _ => "x86_64",
        };
        let url = format!(
            "https://github.com/jgm/pandoc/releases/download/{0}/pandoc-{0}-{1}-macOS.zip",
            PANDOC_VERSION, pandoc_arch
        );
        let dest = download_and_extract_binary(&url, "pandoc", &bin_dir, false)?;
        if !binary_runs(&dest) {
            return Err("Installed Pandoc failed to run.".to_string());
        }
        installed.push("Pandoc".to_string());
    }

    // 2. A PDF engine — install the self-contained typst binary only if there is
    //    no LaTeX engine on PATH and no managed typst already present.
    if !latex_engine_available() && resolve_typst(&app).is_none() {
        let typst_arch = match std::env::consts::ARCH {
            "aarch64" => "aarch64-apple-darwin",
            _ => "x86_64-apple-darwin",
        };
        let url = format!(
            "https://github.com/typst/typst/releases/download/{0}/typst-{1}.tar.xz",
            TYPST_VERSION, typst_arch
        );
        let dest = download_and_extract_binary(&url, "typst", &bin_dir, true)?;
        if !binary_runs(&dest) {
            return Err("Installed PDF engine (typst) failed to run.".to_string());
        }
        installed.push("PDF engine".to_string());
    }

    if installed.is_empty() {
        Ok("PDF tools already installed.".to_string())
    } else {
        Ok(format!("Installed {}.", installed.join(" and ")))
    }
}

fn validated_external_url(value: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(value.trim()).map_err(|_| "Invalid URL".to_string())?;
    if matches!(parsed.scheme(), "https" | "http" | "mailto") {
        Ok(parsed)
    } else {
        Err("Unsupported URL scheme".to_string())
    }
}

#[tauri::command]
async fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let parsed = validated_external_url(&url)?;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_new_window(app: tauri::AppHandle, file_path: Option<String>) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    if let Some(path) = &file_path {
        require_authorized_path(path)?;
    }
    let label = format!(
        "bioscratch-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let url_str = match &file_path {
        Some(p) => format!("/?file={}", urlencoding_simple(p)),
        None => "/".to_string(),
    };
    let title = match &file_path {
        Some(p) => format!(
            "Bioscratch – {}",
            std::path::Path::new(p)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("untitled")
        ),
        None => "Bioscratch".to_string(),
    };
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url_str.into()))
        .title(title)
        .inner_size(900.0, 680.0)
        .center()
        .resizable(true)
        .initialization_script(
            "document.addEventListener('contextmenu',\
             function(e){e.preventDefault();},{capture:true});",
        )
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn urlencoding_simple(s: &str) -> String {
    s.chars()
        .flat_map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '/' {
                vec![c]
            } else {
                format!("%{:02X}", c as u32).chars().collect()
            }
        })
        .collect()
}

// ---- Update checking ----

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub is_update_available: bool,
    pub download_url: Option<String>,
    pub release_url: Option<String>,
    pub release_notes: Option<String>,
}

#[tauri::command]
async fn check_for_updates() -> Result<UpdateInfo, String> {
    const CURRENT: &str = env!("CARGO_PKG_VERSION");

    let output = std::process::Command::new("curl")
        .args([
            "-s",
            "--max-time",
            "10",
            "-H",
            "Accept: application/vnd.github.v3+json",
            "-H",
            "User-Agent: Bioscratch-App",
            "https://api.github.com/repos/Broccolito/bioscratch/releases/latest",
        ])
        .output()
        .map_err(|e| format!("Network error: {}", e))?;

    let body = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| "Invalid response from update server".to_string())?;

    // GitHub returns {"message": "Not Found"} when no releases exist
    if json.get("message").is_some() {
        return Ok(UpdateInfo {
            current_version: CURRENT.to_string(),
            latest_version: CURRENT.to_string(),
            is_update_available: false,
            download_url: None,
            release_url: None,
            release_notes: None,
        });
    }

    let tag = json["tag_name"].as_str().unwrap_or("v0.1.0");
    let latest_version = tag.trim_start_matches('v').to_string();
    let release_url = json["html_url"].as_str().map(String::from);
    // Truncate long release notes
    let release_notes = json["body"]
        .as_str()
        .map(|s| s.chars().take(600).collect::<String>());

    // Pick the best .dmg asset for the current arch
    #[cfg(target_arch = "aarch64")]
    let arch_hint = "aarch64";
    #[cfg(target_arch = "x86_64")]
    let arch_hint = "x86_64";
    #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
    let arch_hint = "";

    let download_url = json["assets"]
        .as_array()
        .and_then(|assets| {
            let arch_match = assets.iter().find(|a| {
                let name = a["name"].as_str().unwrap_or("");
                name.ends_with(".dmg") && (arch_hint.is_empty() || name.contains(arch_hint))
            });
            arch_match.or_else(|| {
                assets
                    .iter()
                    .find(|a| a["name"].as_str().unwrap_or("").ends_with(".dmg"))
            })
        })
        .and_then(|a| a["browser_download_url"].as_str())
        .filter(|url| validated_update_url(url).is_ok())
        .map(String::from);

    let is_update_available = version_newer(&latest_version, CURRENT);

    Ok(UpdateInfo {
        current_version: CURRENT.to_string(),
        latest_version,
        is_update_available,
        download_url,
        release_url,
        release_notes,
    })
}

fn version_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> { v.split('.').filter_map(|p| p.parse().ok()).collect() };
    let lat = parse(latest);
    let cur = parse(current);
    for i in 0..lat.len().max(cur.len()) {
        let l = lat.get(i).copied().unwrap_or(0);
        let c = cur.get(i).copied().unwrap_or(0);
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }
    false
}

fn validated_update_url(value: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(value.trim()).map_err(|_| "Invalid update URL".to_string())?;
    let path = url.path();
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !path.starts_with("/Broccolito/bioscratch/releases/download/")
        || !path.to_ascii_lowercase().ends_with(".dmg")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Update URL is not an official Bioscratch release asset".to_string());
    }
    Ok(url)
}

#[tauri::command]
async fn download_and_install(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = validated_update_url(&url)?;
    let download_dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let dest = download_dir.join("Bioscratch_update.dmg");
    let partial = download_dir.join("Bioscratch_update.download");
    let _ = fs::remove_file(&partial);
    let partial_clone = partial.clone();
    let url_clone = url.to_string();

    tauri::async_runtime::spawn_blocking(move || {
        let output = std::process::Command::new("curl")
            .args([
                "--fail",
                "--location",
                "--proto",
                "=https",
                "--proto-redir",
                "=https",
                "--max-time",
                "600",
                "--output",
            ])
            .arg(&partial_clone)
            .arg(&url_clone)
            .output()
            .map_err(|e| format!("Download failed: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "Download failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    // Verify both the DMG structure and Apple's notarization assessment before
    // replacing the previous download or asking Finder to open it.
    let verification_commands = [
        ("hdiutil", vec!["verify"]),
        (
            "spctl",
            vec![
                "--assess",
                "--type",
                "open",
                "--context",
                "context:primary-signature",
                "--verbose",
            ],
        ),
    ];
    for (program, args) in verification_commands {
        let status = std::process::Command::new(program)
            .args(args)
            .arg(&partial)
            .status()
            .map_err(|e| format!("Could not verify update with {program}: {e}"))?;
        if !status.success() {
            let _ = fs::remove_file(&partial);
            return Err(
                "Downloaded update failed integrity or notarization verification".to_string(),
            );
        }
    }

    if dest.exists() {
        fs::remove_file(&dest).map_err(|e| format!("Could not replace previous update: {e}"))?;
    }
    fs::rename(&partial, &dest).map_err(|e| format!("Could not finalize update: {e}"))?;

    std::process::Command::new("open")
        .arg(&dest)
        .spawn()
        .map_err(|e| format!("Failed to open installer: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Called by the frontend on mount to retrieve a file path that was passed
/// to the app via macOS "Open With" before the JS listener was ready.
#[tauri::command]
fn get_initial_file() -> Option<String> {
    pending_file_storage().lock().unwrap().take()
}

// ---- App entry point ----

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    // Note: the agent debug bridge is the in-tree `dev_bridge` module (started
    // below under `cfg!(debug_assertions)`), NOT the external
    // `tauri-plugin-debug-bridge` crate, whose auth protocol is incompatible
    // with `tauri-agent-tools`.

    builder
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};

            // ── Bioscratch (app) menu ──────────────────────────────────────
            let about = PredefinedMenuItem::about(app, Some("About Bioscratch"), None)?;
            let check_updates = MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?;
            let sep_a1 = PredefinedMenuItem::separator(app)?;
            let quit = PredefinedMenuItem::quit(app, Some("Quit Bioscratch"))?;
            let app_menu = SubmenuBuilder::new(app, "Bioscratch")
                .items(&[&about, &check_updates, &sep_a1, &quit])
                .build()?;

            // ── File menu ─────────────────────────────────────────────────
            let new_item     = MenuItem::with_id(app, "new",         "New Tab",        true, Some("CmdOrCtrl+T"))?;
            let open_item    = MenuItem::with_id(app, "open",        "Open…",          true, Some("CmdOrCtrl+O"))?;
            let sep_f1       = PredefinedMenuItem::separator(app)?;
            let save_item    = MenuItem::with_id(app, "save",        "Save",           true, Some("CmdOrCtrl+S"))?;
            let save_as_item = MenuItem::with_id(app, "save-as",     "Save As…",       true, Some("Shift+CmdOrCtrl+S"))?;
            let sep_f2       = PredefinedMenuItem::separator(app)?;
            let exp_html     = MenuItem::with_id(app, "export-html", "Export as HTML…",true, None::<&str>)?;
            let exp_pdf      = MenuItem::with_id(app, "export-pdf",  "Export as PDF…", true, None::<&str>)?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .items(&[&new_item, &open_item, &sep_f1, &save_item, &save_as_item, &sep_f2, &exp_html, &exp_pdf])
                .build()?;

            // ── Edit menu (OS-provided) ────────────────────────────────────
            let undo       = PredefinedMenuItem::undo(app,       Some("Undo"))?;
            let redo       = PredefinedMenuItem::redo(app,       Some("Redo"))?;
            let sep_e1     = PredefinedMenuItem::separator(app)?;
            let cut        = PredefinedMenuItem::cut(app,        Some("Cut"))?;
            let copy       = PredefinedMenuItem::copy(app,       Some("Copy"))?;
            let paste      = PredefinedMenuItem::paste(app,      Some("Paste"))?;
            let select_all = PredefinedMenuItem::select_all(app, Some("Select All"))?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .items(&[&undo, &redo, &sep_e1, &cut, &copy, &paste, &select_all])
                .build()?;

            // ── View menu ─────────────────────────────────────────────────
            let theme_item   = MenuItem::with_id(app, "theme",        "Theme…",              true, None::<&str>)?;
            let sep_v1       = PredefinedMenuItem::separator(app)?;
            let font_larger  = MenuItem::with_id(app, "font-larger",  "Increase Font Size",  true, Some("CmdOrCtrl+="))?;
            let font_smaller = MenuItem::with_id(app, "font-smaller", "Decrease Font Size",  true, Some("CmdOrCtrl+-"))?;
            let font_reset   = MenuItem::with_id(app, "font-reset",   "Actual Size",         true, Some("CmdOrCtrl+0"))?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .items(&[&theme_item, &sep_v1, &font_larger, &font_smaller, &font_reset])
                .build()?;

            // ── Window menu ───────────────────────────────────────────────
            let minimize   = PredefinedMenuItem::minimize(app, Some("Minimize"))?;
            let sep_w1     = PredefinedMenuItem::separator(app)?;
            let new_window = MenuItem::with_id(app, "new-window", "New Window", true, Some("Shift+CmdOrCtrl+N"))?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .items(&[&minimize, &sep_w1, &new_window])
                .build()?;

            // ── Help menu ─────────────────────────────────────────────────
            let learn_more     = MenuItem::with_id(app, "learn-more",      "Learn More…",           true, None::<&str>)?;
            let sep_h1         = PredefinedMenuItem::separator(app)?;
            let github_item    = MenuItem::with_id(app, "github",          "Bioscratch on GitHub",  true, None::<&str>)?;
            let report_issue   = MenuItem::with_id(app, "report-issue",    "Report an Issue",       true, None::<&str>)?;
            let request_feat   = MenuItem::with_id(app, "request-feature", "Request a Feature",     true, None::<&str>)?;
            let help_menu = SubmenuBuilder::new(app, "Help")
                .items(&[&learn_more, &sep_h1, &github_item, &report_issue, &request_feat])
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
                .build()?;

            app.set_menu(menu)?;

            if cfg!(debug_assertions) {
                if let Err(e) = dev_bridge::start_bridge(app.handle()).map(|_| ()) {
                    eprintln!("Warning: Failed to start dev bridge: {e}");
                }
            }

            // Create the main window here so we can attach an initialization
            // script. initialization_script becomes a WKUserScript injected at
            // atDocumentStart — the only reliable way to suppress WKWebView's
            // native macOS context menu before it fires.
            use tauri::{WebviewUrl, WebviewWindowBuilder};
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/".into()))
                .title("Bioscratch")
                .inner_size(1200.0, 900.0)
                .min_inner_size(800.0, 500.0)
                .initialization_script(
                    "document.addEventListener('contextmenu',\
                     function(e){e.preventDefault();},{capture:true});"
                )
                .build()?;

        app.on_menu_event(|app_handle, event| {
                match event.id().as_ref() {
                    "learn-more" => {
                        use tauri_plugin_opener::OpenerExt;
                        app_handle.opener()
                            .open_url("https://broccolito.github.io/bioscratch/", None::<&str>)
                            .ok();
                    }
                    "github" => {
                        use tauri_plugin_opener::OpenerExt;
                        app_handle.opener()
                            .open_url("https://github.com/Broccolito/bioscratch", None::<&str>)
                            .ok();
                    }
                    "report-issue" => {
                        use tauri_plugin_opener::OpenerExt;
                        app_handle.opener()
                            .open_url("https://github.com/Broccolito/bioscratch/issues/new", None::<&str>)
                            .ok();
                    }
                    "request-feature" => {
                        use tauri_plugin_opener::OpenerExt;
                        app_handle.opener()
                            .open_url("https://github.com/Broccolito/bioscratch/issues/new?labels=enhancement", None::<&str>)
                            .ok();
                    }
                    id => {
                        app_handle.emit("menu-action", id).ok();
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            show_open_dialog,
            show_save_dialog,
            get_app_data_dir,
            read_recent_files,
            save_recent_files,
            save_autosave,
            load_autosave,
            delete_autosave,
            export_html,
            show_html_save_dialog,
            show_pdf_save_dialog,
            export_pdf_html,
            export_pdf_pandoc,
            pdf_export_ready,
            install_pdf_dependencies,
            open_url,
            open_new_window,
            list_user_themes,
            save_user_theme,
            delete_user_theme,
            check_for_updates,
            download_and_install,
            quit_app,
            get_initial_file,
            dev_bridge::__dev_bridge_result,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // Handle macOS "Open With" / default-app file-open events.
            // RunEvent::Opened fires when the OS asks the app to open a file
            // (both when the app is already running and when it was just launched).
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if url.scheme() == "file" {
                        if let Ok(path) = url.to_file_path() {
                            let path_str = path.to_string_lossy().to_string();
                            let _ = authorize_document_path(app_handle, &path);
                            let windows = app_handle.webview_windows();
                            if windows.is_empty() {
                                // The app was launched by this file-open request.
                                // Keep it until the first webview registers its listener.
                                *pending_file_storage().lock().unwrap() = Some(path_str);
                            } else {
                                // `AppHandle::emit` broadcasts to every webview, which
                                // made every open Bioscratch window add the same file.
                                // Route the request only to the focused window (with a
                                // deterministic main/first fallback).
                                let candidates = windows
                                    .iter()
                                    .map(|(label, window)| {
                                        (label.clone(), window.is_focused().unwrap_or(false))
                                    })
                                    .collect::<Vec<_>>();
                                if let Some(label) = preferred_open_file_window(&candidates) {
                                    app_handle.emit_to(label, "open-file", path_str).ok();
                                }
                            }
                        }
                    }
                }
            }

            // Native drag/drop is an explicit user grant. Record dropped files
            // before the webview's asynchronous handler asks read_file for them.
            let dropped_paths = match &event {
                tauri::RunEvent::WindowEvent {
                    event: tauri::WindowEvent::DragDrop(
                        tauri::DragDropEvent::Drop { paths, .. }
                    ),
                    ..
                }
                | tauri::RunEvent::WebviewEvent {
                    event: tauri::WebviewEvent::DragDrop(
                        tauri::DragDropEvent::Drop { paths, .. }
                    ),
                    ..
                } => Some(paths),
                _ => None,
            };
            if let Some(paths) = dropped_paths {
                for path in paths {
                    let _ = authorize_document_path(app_handle, path);
                }
            }
        });
}

#[cfg(test)]
mod security_tests {
    use super::{preferred_open_file_window, validated_external_url, validated_update_url};

    #[test]
    fn file_open_targets_only_the_focused_window() {
        let windows = vec![
            ("main".to_string(), false),
            ("bioscratch-2".to_string(), true),
            ("bioscratch-3".to_string(), false),
        ];
        assert_eq!(
            preferred_open_file_window(&windows).as_deref(),
            Some("bioscratch-2")
        );
    }

    #[test]
    fn file_open_falls_back_to_main_then_first_window() {
        let with_main = vec![
            ("bioscratch-2".to_string(), false),
            ("main".to_string(), false),
        ];
        assert_eq!(
            preferred_open_file_window(&with_main).as_deref(),
            Some("main")
        );

        let without_main = vec![("bioscratch-2".to_string(), false)];
        assert_eq!(
            preferred_open_file_window(&without_main).as_deref(),
            Some("bioscratch-2")
        );
        assert_eq!(preferred_open_file_window(&[]), None);
    }

    #[test]
    fn external_urls_allow_only_browser_and_mail_schemes() {
        assert!(validated_external_url("https://example.com").is_ok());
        assert!(validated_external_url("http://example.com").is_ok());
        assert!(validated_external_url("mailto:test@example.com").is_ok());
        assert!(validated_external_url("javascript:alert(1)").is_err());
        assert!(validated_external_url("data:text/html,unsafe").is_err());
        assert!(validated_external_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn update_urls_are_pinned_to_official_https_dmg_assets() {
        let valid = "https://github.com/Broccolito/bioscratch/releases/download/v0.3.1/Bioscratch_0.3.1_aarch64.dmg";
        assert!(validated_update_url(valid).is_ok());
        assert!(validated_update_url(&valid.replacen("https", "http", 1)).is_err());
        assert!(
            validated_update_url(&valid.replace("Broccolito/bioscratch", "attacker/fork")).is_err()
        );
        assert!(validated_update_url(&valid.replace(".dmg", ".zip")).is_err());
        assert!(validated_update_url(&format!("{valid}?redirect=1")).is_err());
    }
}
