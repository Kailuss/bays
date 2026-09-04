# Bays 💙

**Your open editors, beautifully organized in the sidebar.**

Bays replaces VS Code's horizontal editor-tab bar with a clean, vertical list of "bays" in the sidebar. All your open files in one elegant panel: no more horizontal scrolling or lost tabs.

## 🚀 Getting Started

1. **Install** the extension from the VS Code Marketplace
2. **Open** the Bays panel from the Activity Bar (look for the Bays icon on the left)
3. **Enjoy** your organized bays!

That's it. No configuration needed: it works great out of the box.

## ✨ What You Get

### 📋 Clean Vertical Layout
- All your documents in one sidebar panel
- File name and path on separate lines for easy scanning (or a single line in compact mode)
- Real icons from your active file-icon theme (Material Icons, Seti, vscode-icons…)
- Visual highlight on your active file, dirty dots, and git/diagnostic badges

### 🎯 Quick Actions on Hover
- **Pin** important files to keep them at the top
- **Close** bays without hunting for tiny X buttons
- **Add to Copilot Chat** for AI assistance with your code
- **Smart file actions** tailored to the file type (preview, run, format…)
- Everything appears on hover: no clutter when you don't need it

### 🔍 Native-Style Right-Click Menu
A hand-built context menu that matches VS Code's own, placed right under your cursor, with submenus, keyboard navigation and type-ahead:
- Close, Close Others, Close to the Right, Close Group
- Reveal in Explorer view or in the OS file manager
- Copy relative path, absolute path, or file contents
- Compare with the active editor, Open Changes, Split Right
- Open Timeline, Duplicate File, Move to New Window
- Add to Copilot Chat

### 🎨 Smart File Actions
Contextual actions that appear based on the file type:
- **Preview** Markdown, HTML, images, and CSV files
- **Run** tests, Python scripts, and shell commands
- **Open** external files (PDFs, videos, etc.) in their native apps
- **Format** JSON, CSS, and YAML files
- **Optimize** SVG files and compile SCSS/Less
- **Send** HTTP requests from `.http` files

### 👥 Multi-Group Support with Group Customization
When you split your editor, Bays groups your bays automatically and gives each group its own header. You can make each group your own:
- **Rename** a group to whatever you like
- **Color-code** groups: blue, green, yellow, orange, red or purple, all theme-aware
- **Lock** a group to protect it from accidental closes
- **Collapse** a group's header to tuck its bays away

### 🤖 First-Class Claude Code Support
Claude Code conversation tabs get their real branding and their **full** conversation title: Bays reads the live title straight from Claude's transcripts, so you always see the whole thing instead of VS Code's truncated `Conversation with…`. Plan-preview tabs are recognized too.

### 🔄 Variants (Diffs, Snapshots & Comparisons)
Diffs, staged changes, snapshots, and comparisons are shown indented as **variants** under their source bay, so reviewing multiple versions of the same file stays tidy. The parent tracks how many variants it has.

### 🧭 Rename, Move & Delete: Always in Sync
Rename a file, move it, drag a folder, or delete it, and your open bays follow along automatically. No stale paths, no ghost entries.

### 🎯 Cursor Position Sync (Experimental)
Synchronize cursor position between a bay and its variants (diffs/snapshots). When enabled, moving your cursor in one view updates the related views to the same line and column. Perfect for comparing changes at a specific location.

*Enable with:* `"bays.syncCursorPosition": true` (default: off)

## Requirements

- VS Code **1.85.0** or later

## ⚙️ Customize It Your Way

Open VS Code Settings (`Ctrl+,` / `Cmd+,`) and search for "Bays":

- **`bays.showFilePath`**: Show the relative file path under each bay
  *Default: On*

- **`bays.compactMode`**: Compact single-line rows with reduced height (28px)
  *Default: Off*

- **`bays.enableHoverActions`**: Show the file/Copilot/close buttons on hover
  *Default: On*

- **`bays.enableDragDrop`**: Reorder bays by dragging, within and across groups
  *Default: On*

- **`bays.syncCursorPosition`**: Synchronize the cursor between a bay and its variants
  *Default: Off*

> 💡 The toolbar at the top of the Bays view has a **View Options** menu (the gear) with quick toggles for compact mode and file paths, plus a **Save All** button that appears whenever you have unsaved changes.

## 🎮 Quick Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Bays":

- **Refresh**: Reload the bay list if something looks off
- **Save All**: Save every unsaved file
- **Close All**: Clear all open editors at once
- **Toggle Compact Mode** / **Toggle View Path**: Flip the layout toggles
- **Add Files to Copilot Chat…**: Pick multiple files to discuss with AI

Most per-bay and per-group actions are a right-click away in the bay list!

## 🛠️ For Developers

Want to contribute or customize Bays? Start with:

- [`CLAUDE.md`](CLAUDE.md): the whole internal guide (in Spanish). The model, the
  update loop, the invariants and the cases this codebase learned the hard way.
  It is the only one: five overlapping layers of prose were merged into it,
  because the same fact written in five places goes stale in four of them.

**Quick start:**
```bash
npm install
npm run watch    # parallel esbuild + tsc --watch
# Press F5 to launch the Extension Development Host
```

Useful scripts: `npm run check-types` (fast correctness gate), `npm run lint`, `npm run compile` (one-shot dev build), `npm run package` (production build), `npm test`.

## License

MIT
