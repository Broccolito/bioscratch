# Bioscratch 0.6.0 release QA

Recorded October 23, 2026, for the integration merged into main.

## Automated checks

| Check | Result |
| --- | --- |
| App and extension editor regression suite | 196 passed across 22 files, including Quick Look and image-path regressions |
| Rust backend tests | 21 passed; 1 ignored |
| Release-script checks with stubbed Apple tools | 31 passed |
| Front-matter fixture assertions | 27 passed |
| Quick Look Swift checks | Image-helper tests and native host/helper typecheck passed |
| App and extension npm dependency audits | 0 reported advisories |
| Apple Silicon and Intel packaging | Final apps and DMGs are Developer ID signed, notarized, and stapled; DMG integrity checks and SHA256SUMS verification passed |
| Main source CI | [All jobs passed](https://github.com/Broccolito/bioscratch/actions/runs/40044810032) for `e5829ed`, including the final app and extension changes |

The review and regression fixes cover folder grants and symlink containment,
per-window search cancellation, preservation of YAML tags and aliases, ownership
of asynchronous saves, tab detaching, autosave recovery, coordinated quit,
source-to-rendered search positions, and static export sanitization/assets.

A registry advisory published during release CI affected the extension's
development packaging route, `@vscode/vsce` → `@azure/identity` →
`@azure/msal-node`; it is not bundled as app authentication code. The packaging
dependencies now use Identity 4.13.0 and MSAL 3.8.10, with UUID 11.1.1 scoped to
that MSAL version. Identity 4.13.2 and 4.14.0 require MSAL 5 or 6, which have no
release outside [the affected range](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5).
The scoped UUID update also addresses [its advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
while preserving MSAL's no-argument CommonJS `v4()` call. Both npm audits were
rerun with zero reported advisories; MSAL/Identity loading, UUID generation,
extension typechecking/building, and VSIX repackaging were checked after the fix.

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
| Document local images | Alpha's relative image displayed on first open and when Alpha was reopened in the final installed ARM app |
| Native Quick Look | Final preview displayed the banner, math, table, Mermaid diagram, and code without raw YAML or editor controls; task checkbox state looked correct; the final local-image restriction message was verified in Finder |

PR #10's documentation refresh and PR #12's contributor/contact changes are
documentation changes; they do not add an app interaction.

The resulting fixes use native macOS Trash without Finder automation permission,
restore specialized Mermaid views after code/Markdown tab switches, preserve
readable theme colors, and embed math fonts and rendered diagrams in exports.
Local images were verified in the native PDF output.
Local-image rendering now follows the active document path when switching notes,
with two renderer regression tests covering relative asset resolution.

The final x86_64 binary also launched under Rosetta on Apple Silicon. Its
interactive smoke check displayed the Alpha fixture's banner, math, table,
Mermaid diagram, code, and relative local image. The Export dropdown and Escape
dismissal worked, and a clean tab closed before native-menu quit; process exit
was verified. Physical Intel Mac hardware has not been tested.

## PR integration

All six PRs, #7 through #12, have actually merged into main. PR #11's five
conflicts were resolved to its reviewed tree, and the index was verified against
that tree before merge commit `9640d12`. The candidate then merged main at
`ba80d23` through `dc8ef72` without changing the candidate's tree. All original
PR heads are included in its ancestry. The integration and corrective commits
are pushed to main and source CI is green. The final QA-record update changes
documentation only.

## Platform limits

- The native Quick Look check exposed a macOS sandbox limit on neighboring local
  images. The accurate local-image message and documentation are implemented and
  verified in Finder. Remote and data-image handling remain supported. Rendered
  document content passed; checkbox interaction is not claimed from the visual
  state check.
- Physical Intel Mac hardware testing remains unperformed; the x86_64 Rosetta
  smoke check and Intel packaging/notarization results are recorded above.
- Dock-initiated quit was not exercised: the computer-use surface could not
  access the Dock. Rust `ExitRequested` tests cover that backend entry point.
- Standalone HTML browser visual testing was blocked by the browser's local-file
  protocol restriction. Embedded export assets were checked statically; the
  native PDF output was visually inspected. No standalone HTML browser visual
  result is claimed.
