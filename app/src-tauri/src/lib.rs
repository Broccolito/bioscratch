use std::fs;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use serde::{Deserialize, Serialize};

struct PendingFile(Mutex<Option<String>>);

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
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn show_open_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .add_filter("Text files", &[
            "md","markdown","txt","text","csv","tsv","xml","json","json5","yaml","yml","toml","ini","env","cfg","conf","config",
            "html","htm","css","scss","sass","less","js","jsx","ts","tsx","mjs","cjs","vue","svelte","astro",
            "c","h","cpp","cc","cxx","hpp","hxx","cs","java","kt","kts","scala","swift","m","mm","zig","v",
            "py","pyw","rb","rbw","lua","pl","pm","php","sh","bash","zsh","fish","ps1","psm1","bat","cmd",
            "r","rmd","jl","f","f90","f95","for",
            "rs","go","ex","exs","erl","hrl","hs","lhs","ml","mli","fs","fsx","fsi","clj","cljs","cljc","lisp","el","vim",
            "dockerfile","makefile","cmake","gradle","properties","plist","tf","tfvars","hcl","nix","cabal",
            "tex","rst","adoc","org","wiki",
            "sql","graphql","gql","proto","thrift","log","diff","patch",
        ])
        .blocking_pick_file();
    Ok(path.map(|p| p.to_string()))
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
    Ok(path.map(|p| p.to_string()))
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
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let recent_path = data_dir.join("recent_files.json");
    if recent_path.exists() {
        let content = fs::read_to_string(&recent_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(vec![])
    }
}

#[tauri::command]
async fn save_recent_files(
    app: tauri::AppHandle,
    files: Vec<String>,
) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let recent_path = data_dir.join("recent_files.json");
    let content = serde_json::to_string(&files).map_err(|e| e.to_string())?;
    fs::write(&recent_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_autosave(
    app: tauri::AppHandle,
    key: String,
    content: String,
) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let autosave_dir = data_dir.join("autosave");
    fs::create_dir_all(&autosave_dir).map_err(|e| e.to_string())?;
    let safe_key = key.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    fs::write(
        autosave_dir.join(format!("{}.md", safe_key)),
        content,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn load_autosave(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let safe_key = key.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let path = data_dir
        .join("autosave")
        .join(format!("{}.md", safe_key));
    if path.exists() {
        Ok(Some(
            fs::read_to_string(&path).map_err(|e| e.to_string())?,
        ))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn delete_autosave(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let safe_key = key.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let path = data_dir
        .join("autosave")
        .join(format!("{}.md", safe_key));
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
            let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            themes.push(UserTheme { filename, content });
        }
    }
    Ok(themes)
}

#[tauri::command]
async fn save_user_theme(app: tauri::AppHandle, filename: String, content: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let themes_dir = data_dir.join("user_themes");
    fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;
    // Sanitize filename: only allow safe characters
    let safe_name: String = filename.chars().map(|c| {
        if c.is_alphanumeric() || c == '_' || c == '-' || c == '.' { c } else { '_' }
    }).collect();
    let safe_name = if safe_name.ends_with(".yaml") { safe_name } else { format!("{}.yaml", safe_name) };
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
    fs::write(&path, html).map_err(|e| e.to_string())
}

#[tauri::command]
async fn show_html_save_dialog(app: tauri::AppHandle, filename: Option<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let default_name = filename.unwrap_or_else(|| "document.html".to_string());
    let path = app
        .dialog()
        .file()
        .add_filter("HTML", &["html"])
        .set_file_name(&default_name)
        .blocking_save_file();
    Ok(path.map(|p| p.to_string()))
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

    let output = std::process::Command::new("pandoc")
        .arg(temp_md.to_str().unwrap_or(""))
        .arg("-o")
        .arg(&output_path)
        .arg("--standalone")
        .arg("--from=markdown-implicit_figures")
        .arg(format!("--resource-path={}", resource_path))
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Pandoc not found. Please install it: brew install pandoc".to_string()
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
async fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(&url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_new_window(app: tauri::AppHandle, file_path: Option<String>) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let label = format!("bioscratch-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());
    let url_str = match &file_path {
        Some(p) => format!("/?file={}", urlencoding_simple(p)),
        None => "/".to_string(),
    };
    let title = match &file_path {
        Some(p) => format!("Bioscratch – {}", std::path::Path::new(p)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("untitled")),
        None => "Bioscratch".to_string(),
    };
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url_str.into()))
        .title(title)
        .inner_size(900.0, 680.0)
        .center()
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn urlencoding_simple(s: &str) -> String {
    s.chars().flat_map(|c| {
        if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '/' {
            vec![c]
        } else {
            format!("%{:02X}", c as u32).chars().collect()
        }
    }).collect()
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
            "-s", "--max-time", "10",
            "-H", "Accept: application/vnd.github.v3+json",
            "-H", "User-Agent: Bioscratch-App",
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
    let release_notes = json["body"].as_str().map(|s| s.chars().take(600).collect::<String>());

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
            arch_match.or_else(|| assets.iter().find(|a| a["name"].as_str().unwrap_or("").ends_with(".dmg")))
        })
        .and_then(|a| a["browser_download_url"].as_str())
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
    let parse = |v: &str| -> Vec<u32> {
        v.split('.').filter_map(|p| p.parse().ok()).collect()
    };
    let lat = parse(latest);
    let cur = parse(current);
    for i in 0..lat.len().max(cur.len()) {
        let l = lat.get(i).copied().unwrap_or(0);
        let c = cur.get(i).copied().unwrap_or(0);
        if l > c { return true; }
        if l < c { return false; }
    }
    false
}

#[tauri::command]
async fn download_and_install(url: String) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dest = format!("{}/Downloads/Bioscratch_update.dmg", home);
    let dest_clone = dest.clone();
    let url_clone = url.clone();

    tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new("curl")
            .args(["-L", "-o", &dest_clone, &url_clone])
            .status()
            .map_err(|e| format!("Download failed: {}", e))
            .and_then(|s| if s.success() { Ok(()) } else { Err("Download failed".to_string()) })
    })
    .await
    .map_err(|e| e.to_string())??;

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
fn get_initial_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

// ---- App entry point ----

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(feature = "debug-bridge")]
    let builder = builder.plugin(tauri_plugin_debug_bridge::init());

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
            let theme_item = MenuItem::with_id(app, "theme", "Theme…", true, None::<&str>)?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .items(&[&theme_item])
                .build()?;

            // ── Window menu ───────────────────────────────────────────────
            let minimize   = PredefinedMenuItem::minimize(app, Some("Minimize"))?;
            let sep_w1     = PredefinedMenuItem::separator(app)?;
            let new_window = MenuItem::with_id(app, "new-window", "New Window", true, Some("Shift+CmdOrCtrl+N"))?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .items(&[&minimize, &sep_w1, &new_window])
                .build()?;

            // ── Help menu ─────────────────────────────────────────────────
            let github_item = MenuItem::with_id(app, "github", "Bioscratch on GitHub", true, None::<&str>)?;
            let help_menu = SubmenuBuilder::new(app, "Help")
                .items(&[&github_item])
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
                .build()?;

            app.set_menu(menu)?;

            app.manage(PendingFile(Mutex::new(None)));

        app.on_menu_event(|app_handle, event| {
                match event.id().as_ref() {
                    "github" => {
                        use tauri_plugin_opener::OpenerExt;
                        app_handle.opener()
                            .open_url("https://github.com/Broccolito/bioscratch", None::<&str>)
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
            export_pdf_pandoc,
            open_url,
            open_new_window,
            list_user_themes,
            save_user_theme,
            delete_user_theme,
            check_for_updates,
            download_and_install,
            quit_app,
            get_initial_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, _event| {
            // Handle macOS "Open With" / default-app file-open events.
            // RunEvent::Opened fires when the OS asks the app to open a file
            // (both when the app is already running and when it was just launched).
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = _event {
                for url in &urls {
                    if url.scheme() == "file" {
                        if let Ok(path) = url.to_file_path() {
                            let path_str = path.to_string_lossy().to_string();
                            // Store so the frontend can retrieve it on mount
                            // (handles the "launched to open a file" case).
                            let state = _app_handle.state::<PendingFile>();
                            *state.0.lock().unwrap() = Some(path_str.clone());
                            // Also emit for the "app already running" case.
                            _app_handle.emit("open-file", path_str).ok();
                        }
                    }
                }
            }
        });
}
