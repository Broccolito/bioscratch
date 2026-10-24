# Bioscratch 0.6.0 release QA

Recorded October 23, 2026, on `codex/bioscratch-060`. This is a release-check
snapshot; the remaining checks below must be updated before publication.

## Automated checks

| Check | Result |
| --- | --- |
| App and extension editor regression suite | 188 passed |
| Rust backend tests | 21 passed; 1 ignored |
| Release-script checks with stubbed Apple tools | 31 passed |
| Front-matter fixture assertions | 27 passed |
| App and extension npm dependency audits | 0 reported advisories |
| Apple Silicon and Intel packaging | Both architectures passed notarization and staple validation; final Quick Look package check pending |

The review and regression fixes cover folder grants and symlink containment,
per-window search cancellation, preservation of YAML tags and aliases, ownership
of asynchronous saves, tab detaching, autosave recovery, coordinated quit,
source-to-rendered search positions, and static export sanitization/assets.

## Actual native app checks

These scenarios were exercised through computer use in an installed, Developer
ID signed and notarized Apple Silicon app.

| Area | Observed coverage |
| --- | --- |
| Export menu (PR #7) | Dropdown visibility and Escape dismissal; native HTML and PDF save dialogs produced files |
| PDF appearance | Light and dark documents visually checked with banner, math, table, Mermaid, local image, and readable highlighted code |
| Unsaved documents (PR #8) | Dirty tab and window close, Command+Q, Save/Delete/Cancel, and two-window quit with a global Cancel |
| Numbered tabs (PR #9) | Command+1, Command+9, and out-of-range Command+7 |
| Folder browser (PR #11) | Native folder picker, persistence, tree navigation, file/folder creation, rename, and native Trash |
| Search and navigation (PR #11) | Scoped/full-text search, fuzzy Command+P, Command+Enter, rendered match highlighting, and preserving a dirty background tab during an extension-changing rename |
| Tags (PR #11) | Nested tags, AND filters, removal and aliases, read-only anchored YAML, live changes, and external-edit rescan |

PR #10's documentation refresh and PR #12's contributor/contact changes are
documentation changes; they do not add an app interaction.

The resulting fixes use native macOS Trash without Finder automation permission,
restore specialized Mermaid views after code/Markdown tab switches, preserve
readable theme colors, and embed math fonts and rendered diagrams in exports.
Local images were verified in the native PDF output.

## Remaining checks and limits

- Final Quick Look read-only rendering and local-image fix is in progress.
- Actual Intel app UI testing remains pending. Intel packaging/notarization is
  recorded separately from interactive testing.
- Dock-initiated quit was not exercised: the computer-use surface could not
  access the Dock. Rust `ExitRequested` tests cover that backend entry point.
- Standalone HTML browser visual testing was blocked by the browser's local-file
  protocol restriction. Embedded export assets were checked statically; the
  native PDF output was visually inspected. No standalone HTML browser visual
  result is claimed.
- All six PRs remain open pending final native checks. Merge completion and green
  CI on the final main commit are pending.
