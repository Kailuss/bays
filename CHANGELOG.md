# Change Log

Format: [Keep a Changelog](http://keepachangelog.com/). Categories are Added,
Changed, Fixed and Removed.

Release channel: an **odd** minor (0.3, 0.5, ...) ships through the marketplace's
**pre-release** channel and an even one is a stable release. `npm run vsix`
derives the flag from the version in the manifest, so there is nothing to
remember at publish time.

## [0.4.0] - 2026-09-04

### Changed
- The documentation is now a single `CLAUDE.md`, in Spanish. Five overlapping
  layers (a root Copilot agent, one `AGENT.md` per folder, `ARCHITECTURE.md` and
  a `docs/` guide) held 7598 lines that stated the same facts up to five times,
  so a change corrected one copy and left four stale. What survived is what the
  code cannot say: the invariants, the cases learned the hard way and what each
  decision costs.
- `check-layers` reads the identifiers a document cites from INSIDE each
  backtick span, not the span as a whole, and builds its corpus with comments
  stripped. The old rule needed the whole span to be one identifier, so
  `Foo[]`, `bay.method()` and `Foo.bar` slipped through it, and a name mentioned
  in a comment counted as a name the code has. Its reverse half -- an exception
  that no document cites any more -- now measures without the exception list
  itself, which lives in a build script and so vaccinated every name on it: that
  half could never fail, and 21 of its 86 entries were stale.

### Added
- Localization. Every visible string goes through `vscode.l10n.t` in the host
  and through a client-side `t()` fed by a bundle the shell injects as
  `window.__l10n`; `contributes` moved to `%key%` placeholders. Spanish and
  Catalan ship in `l10n/` and `package.nls.*`. Adding a language is two files:
  both parity rules scan the directory instead of carrying a written list.
- Build gates that fail the build instead of shipping in green: `check-docs`
  (paths cited in the docs and in code comments, images in every markdown, and
  no dashes or typographic quotes in what the marketplace renders),
  `check-release` (the manifest version has its own dated, written and unique
  entry on top of the changelog) and `check-layers` (folder membership, command
  ids declared vs registered vs named in a menu, disposal, the trust boundary
  and the identifiers this repo's prose cites).
- `esbuild.js` now refuses to produce a green build with a missing CSS entry
  point, an unresolved `@import`, an orphan stylesheet nobody imports, a
  reordered `@import` list, an empty test scan or a codicon name that
  `codicon.css` does not define.
- `scripts/release.js`: `vsce` is composed instead of typed, with the channel
  derived from the version and said out loud before anything runs.
- `src/platform/`, for the thin adapters over the VS Code API, and a pure
  `src/utils/` with unit tests that run under `node --test` in milliseconds
  (previously every test needed a real VS Code host).
- `capabilities.untrustedWorkspaces` and `virtualWorkspaces` in the manifest:
  Bays runs no workspace code, so it now works in Restricted Mode.
- Marketplace metadata that was missing: `icon`, `license`, `keywords` and
  `galleryBanner`.

### Changed
- Values read from a third-party icon theme (colour, font size, codepoint, data
  URI, font format, weight and style) are validated against a whitelist before
  reaching the webview instead of being interpolated as they arrive.
- The Content Security Policy declares `base-uri` and `form-action`, which do
  not inherit from `default-src`.
- `no-explicit-any` is an error: what reads foreign JSON is typed `unknown` and
  narrowed, so the check cannot be skipped.
- Compact mode and the file-path toggle are remembered **per project** instead
  of writing the user's global settings.
- The webview client listens for host messages through an exhaustive table, so a
  new message cannot compile without an owner.

### Fixed
- Documentation citing `src/webview/contextmenu.js`, `webview.js`, `dragdrop.js`
  and `pathTruncation.js` months after the client became TypeScript.
- `getStateIndicator` was dynamically imported on the single-bay update path.

## [0.3.7] - 2026-07-24

### Added
- Real test suites for id generation, native-tab matching, diff classification
  and path formatting, plus an activation smoke test.
- Type-aware lint (promise rules) and a CI workflow running type-check, lint,
  production build and tests.

### Changed
- The packaged VSIX drops the non-runtime codicon extras.

## [0.3.6] - 2026-07-24

### Added
- Per-group rename, colour, lock and collapse, persisted per workspace.
- Bays follow a file through rename, move and delete.
- First-class Claude Code support: the full conversation title read from the
  live transcript, and the owning extension's real logo for webview tabs.
- Drag and drop of bays between editor groups.
- A View Options submenu in the view title, with Save All appearing only when
  something is unsaved.
- Icons resolved through the contributed language registry, so themes that only
  map by language stop falling back to the generic file icon.

### Changed
- The host to webview contract is a single typed protocol, with the host
  dispatching through an exhaustive handler table.
- The webview client is TypeScript bundled by esbuild instead of scripts copied
  verbatim.
- Active-tab, dirty and git/diagnostic changes are patched incrementally instead
  of rebuilding the whole DOM.
- Markdown preview renders as a variant bay under its source.
- All state-mutating sync runs through a single promise queue.

### Fixed
- Font-based icon themes rendered empty boxes.
- Variants attached to a phantom parent, and diff ids that did not survive a
  close.
- The path row disappeared for files outside the workspace.
- Git status for nested repositories, reopened repositories and a late git
  activation.
- A truncation loop in the webview, and collapsed groups that snapped back open.

## [0.3.4] - 2026-02-23

### Added
- Cursor position synchronization between a bay and its variants, behind
  `bays.syncCursorPosition` (off by default).
