// Ask about unsaved changes before a window closes or the app quits, like
// Word or TextEdit. Rust intercepts the close/quit, the frontend walks the
// user through each unsaved document (Save / Delete / Cancel), then confirms.
//
//   window close → "close-requested" to that window → close_window_confirmed
//   ⌘Q / quit    → "quit-requested" to every window → window_ready_to_quit
//                  from each (app exits when all are ready) or cancel_quit

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

static QUITTING: AtomicBool = AtomicBool::new(false);
static READY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn ready_windows() -> &'static Mutex<HashSet<String>> {
    READY.get_or_init(|| Mutex::new(HashSet::new()))
}

pub fn is_quitting() -> bool {
    QUITTING.load(Ordering::SeqCst)
}

/// Start a quit: every window reviews its unsaved documents first.
pub fn request_quit(app: &AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    if let Ok(mut ready) = ready_windows().lock() {
        ready.clear();
    }
    let windows = app.webview_windows();
    if windows.is_empty() {
        app.exit(0);
        return;
    }
    for window in windows.values() {
        window.emit("quit-requested", ()).ok();
    }
}

/// A window has no unsaved changes left; quit once every window has said so.
#[tauri::command]
pub fn window_ready_to_quit(app: AppHandle, window: tauri::WebviewWindow) {
    if !is_quitting() {
        return;
    }
    let all_ready = {
        let Ok(mut ready) = ready_windows().lock() else { return };
        ready.insert(window.label().to_string());
        app.webview_windows().keys().all(|label| ready.contains(label))
    };
    if all_ready {
        app.exit(0);
    }
}

/// The user chose Cancel in a save prompt during quit.
#[tauri::command]
pub fn cancel_quit() {
    QUITTING.store(false, Ordering::SeqCst);
    if let Ok(mut ready) = ready_windows().lock() {
        ready.clear();
    }
}

/// The window's unsaved documents were saved or discarded: close it for real.
/// `destroy` skips CloseRequested, so this doesn't loop back into the prompt.
#[tauri::command]
pub fn close_window_confirmed(window: tauri::WebviewWindow) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}
