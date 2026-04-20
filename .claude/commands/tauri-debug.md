# tauri-debug — Tauri Agent Tools Debugging Skill

Set up and use the `tauri-agent-tools` debugger to inspect, evaluate JS, and monitor a running Bioscratch dev build. Run this skill whenever you need to debug frontend behavior in the Tauri webview.

---

## What This Debugger Is

**`tauri-agent-tools`** (v0.6.0) is a Node.js CLI for agent-driven inspection of Tauri desktop apps. It connects to a lightweight HTTP bridge running inside the app and exposes 25 commands: `eval`, `dom`, `screenshot`, `console-monitor`, `ipc-monitor`, `page-state`, `storage`, `mutations`, and more.

- npm package: `tauri-agent-tools`
- GitHub: https://github.com/cesarandreslopez/tauri-agent-tools
- Installed globally: `npm install -g tauri-agent-tools`

The bridge is a custom Rust HTTP server (`dev_bridge.rs`) that runs inside the Tauri app during debug builds. It is **not** `tauri-plugin-debug-bridge` — those are separate, incompatible tools.

---

## What Is Already Set Up in This Project

Everything below is already wired into Bioscratch. You do not need to repeat this setup — just start the dev server and the bridge comes up automatically.

### Files added / modified

| File | What was done |
|------|--------------|
| `app/src-tauri/src/dev_bridge.rs` | Copied from `$(npm root -g)/tauri-agent-tools/examples/tauri-bridge/src/dev_bridge.rs` with two fixes (see Pitfalls section) |
| `app/src-tauri/Cargo.toml` | Added `tiny_http`, `rand`, `uuid`, `scopeguard`, `tracing`, `tracing-subscriber` as dependencies |
| `app/src-tauri/src/lib.rs` | Added `mod dev_bridge;`, `dev_bridge::__dev_bridge_result` to invoke_handler, and `dev_bridge::start_bridge(app.handle())` in setup (guarded by `cfg!(debug_assertions)`) |
| `app/src-tauri/tauri.conf.json` | Added `"withGlobalTauri": true` to `app` config object |

### Key wiring in `lib.rs`

```rust
mod dev_bridge;

// Inside setup():
if cfg!(debug_assertions) {
    if let Err(e) = dev_bridge::start_bridge(app.handle()).map(|_| ()) {
        eprintln!("Warning: Failed to start dev bridge: {e}");
    }
}

// Inside invoke_handler:
dev_bridge::__dev_bridge_result,
```

---

## How to Start a Debug Session

```bash
# From app/ directory:
npm run tauri dev
```

The bridge starts automatically. Within ~30 seconds of the Tauri window appearing, a token file is written to the macOS temp directory:

```
$TMPDIR/tauri-dev-bridge-<pid>.token
```

`tauri-agent-tools` discovers this file automatically. Confirm it's working:

```bash
tauri-agent-tools probe
# → Should show: Running bridges: 1, Bridge version: 0.6.0

tauri-agent-tools eval "document.title"
# → Bioscratch
```

---

## Common Commands

```bash
# Evaluate any JS expression
tauri-agent-tools eval "document.querySelectorAll('table').length"

# Inspect DOM structure (depth controls how many levels to expand)
tauri-agent-tools dom --depth 3
tauri-agent-tools dom ".ProseMirror table" --depth 2

# Monitor console output in real time
tauri-agent-tools console-monitor

# Monitor console, filtered to a prefix
tauri-agent-tools console-monitor --filter "execInCell"

# Screenshot the whole window
tauri-agent-tools screenshot -o /tmp/bioscratch.png

# Screenshot a specific element
tauri-agent-tools screenshot --selector ".ProseMirror" -o /tmp/editor.png

# Page state (URL, title, viewport, scroll)
tauri-agent-tools page-state

# Emit a Tauri event (e.g. open a file)
tauri-agent-tools eval "(async()=>{ await window.__TAURI__.event.emit('open-file', '/path/to/file.md'); return 'ok'; })()"
```

---

## Common Pitfalls and How They Were Solved

### 1. Wrong tool — `tauri-plugin-debug-bridge` is NOT compatible

`tauri-plugin-debug-bridge` (crates.io, v0.4) is a completely different project from the bridge that `tauri-agent-tools` expects. Using it will result in:

```
Bridge authentication failed — check your token
```

even if you manually create the token file. The two tools use incompatible auth protocols. **Solution:** use the custom `dev_bridge.rs` shipped with `tauri-agent-tools` itself (see `$(npm root -g)/tauri-agent-tools/rust-bridge/`).

### 2. Token file written to `/tmp` but Node.js looks in `$TMPDIR`

The example `dev_bridge.rs` hardcodes `/tmp/tauri-dev-bridge-<pid>.token`. On macOS, Node.js `os.tmpdir()` returns `/var/folders/.../T/` — a different path. `tauri-agent-tools probe` returns "No bridge found" even though the bridge is running.

**Fix already applied in `dev_bridge.rs`:**
```rust
// Instead of:
let token_path = format!("/tmp/tauri-dev-bridge-{}.token", std::process::id());

// Use:
let tmpdir = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_string());
let tmpdir = tmpdir.trim_end_matches('/');
let token_path = format!("{}/tauri-dev-bridge-{}.token", tmpdir, std::process::id());
```

### 3. `probe` finds bridge but `eval` times out

Symptom: `tauri-agent-tools probe` shows the bridge, but every `eval` call returns "The operation was aborted due to timeout".

**Root cause:** The bridge injects JS that calls `window.__TAURI__.core.invoke(...)` to deliver the result back to Rust. In Tauri v2, `window.__TAURI__` is not exposed globally by default — only through `import` statements in bundled code.

**Fix already applied in `tauri.conf.json`:**
```json
"app": {
  "withGlobalTauri": true,
  ...
}
```

### 4. `cargo check` error: `request` not declared mutable

The example `dev_bridge.rs` has a compile error in recent Rust versions:
```
error[E0596]: cannot borrow `request` as mutable, as it is not declared as mutable
```

**Fix already applied in `dev_bridge.rs`:**
```rust
// Change:
for request in server.incoming_requests() {
// To:
for mut request in server.incoming_requests() {
```

### 5. Unused import warning in `dev_bridge.rs`

`use std::io::{BufRead, BufReader, Write}` — `Write` is imported but unused, causing a warning (and build failure if warnings-as-errors is enabled).

**Fix already applied:** removed `Write` from the import.

### 6. Single `invoke_handler` constraint

Tauri only allows one `.invoke_handler()` call. The `__dev_bridge_result` command must be merged into the existing handler, not added as a second one. It's always registered (harmless in release — the bridge never starts and the command is never called).

### 7. `app.manage()` must be called before the command is invoked

`start_bridge` calls `app.manage(pending.clone())` to register the `PendingResults` shared state. If `start_bridge` is never called (release build), the state is unmanaged. This is safe because the command is also never invoked in release builds.

---

## How JS → Rust Result Delivery Works

```
tauri-agent-tools eval "expr"
  → POST /eval { js: "expr", token: "..." }
    → bridge injects into webview:
        eval(expr)
        → window.__TAURI__.core.invoke("__dev_bridge_result", { id, value })
          → Rust command inserts value into PendingResults map, signals Condvar
            → HTTP handler wakes, returns { result: value }
              → tauri-agent-tools prints result
```

---

## Triggering UI Actions from the Bridge

Since `eval` has access to the full DOM and `window.__TAURI__` API:

```javascript
// Dispatch contextmenu on a table cell
const cell = document.querySelector('table td');
const r = cell.getBoundingClientRect();
cell.dispatchEvent(new MouseEvent('contextmenu', {
  bubbles: true, cancelable: true, view: window,
  clientX: r.left + 5, clientY: r.top + 5
}));

// Click a context menu item
const btn = Array.from(document.querySelectorAll('.table-ctx-item'))
  .find(el => el.textContent.trim() === 'Insert column left');
btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

// Open a file via the app's event system
await window.__TAURI__.event.emit('open-file', '/path/to/file.md');

// Undo last action
document.querySelector('.ProseMirror').dispatchEvent(
  new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true })
);
```

---

## Verifying a Fix: Example (Column Insert Bug)

This was the actual debug session that verified the "Insert column left on leftmost column" fix:

```bash
# 1. Open table fixture
tauri-agent-tools eval "(async()=>{ await window.__TAURI__.event.emit('open-file', '/Users/wanjun/Desktop/bioscratch/tests/fixtures/table.md'); return 'ok'; })()"

# 2. Confirm table loaded
tauri-agent-tools eval "(()=>{ const t=document.querySelector('table'); if(!t) return 'no table'; const r=t.querySelector('tr'); return r.querySelectorAll('td,th').length + ' cols'; })()"

# 3. Right-click leftmost cell and show context menu
tauri-agent-tools eval "(()=>{ const c=document.querySelector('table th'); const r=c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+5,clientY:r.top+5})); return 'context menu triggered'; })()"

# 4. Click 'Insert column left'
tauri-agent-tools eval "(()=>{ const btn=Array.from(document.querySelectorAll('.table-ctx-item')).find(el=>el.textContent.trim()==='Insert column left'); btn.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); const cols=document.querySelector('table tr').querySelectorAll('td,th').length; return cols+' cols after insert'; })()"

# 5. Inspect cell content to confirm new column is leftmost
tauri-agent-tools eval "(()=>{ const cells=document.querySelector('table tr').querySelectorAll('td,th'); return JSON.stringify(Array.from(cells).map(c=>c.textContent.trim()||'(empty)')); })()"
# → ["(empty)","Name","Age","City"]  ✓ empty column is leftmost
```
