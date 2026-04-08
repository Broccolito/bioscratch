use std::fs;
use tauri::Manager;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContent {
    pub path: String,
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
async fn export_html(path: String, html: String) -> Result<(), String> {
    fs::write(&path, html).map_err(|e| e.to_string())
}

#[tauri::command]
async fn show_html_save_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .add_filter("HTML", &["html"])
        .set_file_name("blank.html")
        .blocking_save_file();
    Ok(path.map(|p| p.to_string()))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(feature = "debug-bridge")]
    let builder = builder.plugin(tauri_plugin_debug_bridge::init());

    builder
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
            open_url,
            open_new_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
