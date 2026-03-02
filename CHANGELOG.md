# Change Log

All notable changes to the "bays" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.3.4] - 2026-02-23

### Added
- **Cursor Position Synchronization**: New experimental feature to sync cursor position between parent tabs and their children (diffs, snapshots, etc.)
  - Enable with `bays.syncCursorPosition` setting
  - When moving cursor in parent, all children update to same line/column
  - When moving cursor in child, parent and siblings sync automatically
  - Works bidirectionally between any member of a tab family
- Added `cursorLine` and `cursorColumn` fields to `SideTabState` for tracking cursor position
- Added `TabHierarchyService.syncCursorPosition()` method for managing cursor sync
- Added `onDidChangeTextEditorSelection` listener in `TabSyncService`

### Changed
- Updated documentation in `ANALISIS_PARENT_CHILD.md` with cursor sync details
- Enhanced `updateActiveTab()` in `TabSyncService` to sync cursor on tab activation

## [Unreleased]

- Initial release