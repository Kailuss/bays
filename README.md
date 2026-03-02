# Bays 💙

**Your tabs, beautifully organized in the sidebar.**

Bays gives you a clean, vertical tab list that replaces VS Code's native horizontal tab bar. All your open files in one elegant sidebar panel — no more horizontal scrolling or lost tabs.

## 🚀 Getting Started

1. **Install** the extension from the VS Code Marketplace
2. **Open** the Bays panel from the Activity Bar (look for the icon on the left)
3. **Enjoy** your organized tabs!

That's it. No configuration needed — it works great out of the box.

## ✨ What You Get

### 📋 Clean Vertical Layout
- All your tabs in one sidebar panel
- File name and path on separate lines for easy scanning
- Real icons from your theme (Material Icons, Seti, etc.)
- Visual highlight on your active file

### 🎯 Quick Actions on Hover
- **Pin** important files to keep them at the top
- **Close** tabs without hunting for tiny X buttons  
- **Add to Copilot Chat** for AI assistance with your code
- Everything appears when you hover — no clutter when you don't need it

### 🔍 Powerful Right-Click Menu
- Close other tabs to focus on what matters
- Reveal files in the Explorer
- Copy file paths for sharing
- Compare files side-by-side
- Move tabs between editor groups

### 🎨 Smart File Actions
- **Preview** Markdown, HTML, images, and CSV files
- **Run** tests, Python scripts, and shell commands
- **Open** external files (PDFs, videos, etc.) in their native apps
- **Format** JSON, CSS, and YAML files
- **Optimize** SVG files and compile SCSS/Less
- **Send** HTTP requests from `.http` files

### 👥 Multi-Window Support
When you split your editor, Bays groups your tabs automatically. Each group gets its own header so you always know what's where.

### 🔄 Parent-Child Hierarchy
Diffs, snapshots, and comparisons are organized as children under their source file. Keep your workspace tidy even when reviewing multiple versions of the same file.

### 🎯 Cursor Position Sync (New!)
**Experimental**: Synchronize cursor position between parent files and their diffs/snapshots. When enabled, moving your cursor in one view automatically updates all related tabs to the same line and column — perfect for comparing changes at specific locations.

*Enable with:* `"bays.syncCursorPosition": true` (default: off)

## Requirements

- VS Code **1.85.0** or later

## ⚙️ Customize It Your Way

Open VS Code Settings (`Ctrl+,` or `Cmd+,`) and search for "Bays":

- **Show file paths** — See where each file lives in your project  
  *Default: On*

- **Tab height** — Make tabs taller or more compact (24-60px)  
  *Default: 40px*

- **Icon size** — Adjust file icon size to your preference  
  *Default: 16px*

- **Hover actions** — Show/hide the pin, chat, and close buttons  
  *Default: On*

- **State indicators** — Show dots for unsaved changes and pin badges  
  *Default: On*

- **Drag & drop** — Reorder tabs by dragging (experimental)  
  *Default: Off*

- **Sync cursor position** — Synchronize cursor between parent and child tabs  
  *Default: Off*

## 🎮 Quick Commands

Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) and type "Bays":

- **Refresh** — Reload the tab list if something looks off
- **Close All** — Clear all open editors at once
- **Add Files to Copilot Chat…** — Pick multiple files to discuss with AI

Most actions are just a right-click away in the tab list!

## 🛠️ For Developers

Want to contribute or customize Bays? See the documentation index in [docs/INDEX.md](docs/INDEX.md) (secciones didácticas en español).

**Quick start:**
```bash
npm install
npm run watch    # Start development
# Press F5 to test
```

## License

MIT
