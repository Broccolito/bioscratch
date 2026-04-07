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
        .add_filter("Text files", &["md", "markdown", "txt", "json", "yaml", "yml", "toml", "csv", "xml", "html", "css", "js", "ts", "py", "rs", "go", "java", "c", "cpp", "h", "sh", "log"])
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
