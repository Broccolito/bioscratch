// Window close and application quit are confirmed by the frontend only after
// every dirty document has been saved or explicitly discarded.
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
struct QuitState {
    serial: u64,
    active: Option<u64>,
    ready: HashSet<String>,
    committed: bool,
}

impl QuitState {
    fn begin(&mut self) -> Option<u64> {
        // A repeated Dock/menu quit must not reset an in-progress review.
        if self.active.is_some() {
            return None;
        }
        self.serial += 1;
        self.active = Some(self.serial);
        self.ready.clear();
        self.committed = false;
        self.active
    }

    fn confirm(&mut self, generation: u64, label: &str, windows: &HashSet<String>) -> bool {
        if self.active != Some(generation) || !windows.contains(label) {
            return false;
        }
        self.ready.insert(label.to_string());
        let all_ready = windows.iter().all(|window| self.ready.contains(window));
        self.committed |= all_ready;
        all_ready
    }

    fn cancel(&mut self, generation: u64) -> bool {
        if self.active != Some(generation) || self.committed {
            return false;
        }
        self.active = None;
        self.ready.clear();
        true
    }
}

static QUIT: OnceLock<Mutex<QuitState>> = OnceLock::new();

fn quit_state() -> &'static Mutex<QuitState> {
    QUIT.get_or_init(|| Mutex::new(QuitState::default()))
}

pub fn is_quitting() -> bool {
    get_quit_generation().is_some()
}

/// Late-starting webviews also join an existing quit instead of missing the
/// initial event and leaving the other windows waiting indefinitely.
#[tauri::command]
pub fn get_quit_generation() -> Option<u64> {
    quit_state().lock().ok().and_then(|state| state.active)
}

pub fn request_quit(app: &AppHandle) {
    let generation = {
        let Ok(mut state) = quit_state().lock() else {
            return;
        };
        let Some(generation) = state.begin() else {
            return;
        };
        generation
    };
    let windows = app.webview_windows();
    if windows.is_empty() {
        app.exit(0);
        return;
    }
    for window in windows.values() {
        window.emit("quit-requested", generation).ok();
    }
}

#[tauri::command]
pub fn window_ready_to_quit(app: AppHandle, window: tauri::WebviewWindow, generation: u64) {
    let windows = app.webview_windows().into_keys().collect();
    let Ok(mut state) = quit_state().lock() else {
        return;
    };
    let all_ready = state.confirm(generation, window.label(), &windows);
    let next = if state.active == Some(generation) {
        windows
            .iter()
            .find(|label| !state.ready.contains(*label))
            .cloned()
    } else {
        None
    };
    drop(state);
    if all_ready {
        app.exit(0);
    } else if let Some(next) = next.and_then(|label| app.get_webview_window(&label)) {
        // Bring the next review forward, including minimized windows, instead
        // of leaving the focused window's waiting message over its prompt.
        next.unminimize().ok();
        next.show().ok();
        next.set_focus().ok();
    }
}

/// Cancellation is global: other windows must dismiss their quit prompts and
/// stop any pending save-close callback from closing another document.
#[tauri::command]
pub fn cancel_quit(app: AppHandle, generation: u64) {
    let cancelled = quit_state()
        .lock()
        .map(|mut state| state.cancel(generation))
        .unwrap_or(false);
    if cancelled {
        app.emit("quit-cancelled", generation).ok();
    }
}

#[tauri::command]
pub fn close_window_confirmed(window: tauri::WebviewWindow) -> Result<(), String> {
    if let Some(generation) = get_quit_generation() {
        // A quit may have started while this window's close confirmation was
        // in flight. Join that review rather than destroying its participant.
        return window
            .emit("quit-requested", generation)
            .map_err(|e| e.to_string());
    }
    window.destroy().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::QuitState;
    use std::collections::HashSet;

    fn windows() -> HashSet<String> {
        ["main", "notes"].into_iter().map(String::from).collect()
    }

    #[test]
    fn repeated_quit_preserves_the_current_review_and_confirmations() {
        let mut state = QuitState::default();
        let generation = state.begin().unwrap();
        assert!(!state.confirm(generation, "main", &windows()));
        assert_eq!(state.begin(), None);
        assert!(state.confirm(generation, "notes", &windows()));
    }

    #[test]
    fn cancel_invalidates_late_confirmations_and_old_cancellations() {
        let mut state = QuitState::default();
        let first = state.begin().unwrap();
        assert!(!state.confirm(first, "main", &windows()));
        assert!(state.cancel(first));
        let second = state.begin().unwrap();
        assert_ne!(first, second);
        assert!(!state.confirm(first, "notes", &windows()));
        assert!(!state.cancel(first));
        assert!(!state.confirm(second, "notes", &windows()));
        assert!(state.confirm(second, "main", &windows()));
    }

    #[test]
    fn every_live_window_must_confirm_including_a_new_window() {
        let mut state = QuitState::default();
        let generation = state.begin().unwrap();
        let mut current = windows();
        assert!(!state.confirm(generation, "main", &current));
        current.insert("new".into());
        assert!(!state.confirm(generation, "notes", &current));
        assert!(!state.confirm(generation, "unknown", &current));
        assert!(state.confirm(generation, "new", &current));
    }

    #[test]
    fn cancellation_cannot_reopen_a_fully_confirmed_exit() {
        let mut state = QuitState::default();
        let generation = state.begin().unwrap();
        assert!(!state.confirm(generation, "main", &windows()));
        assert!(state.confirm(generation, "notes", &windows()));
        assert!(!state.cancel(generation));
    }
}
