# services/ui/ - UI Presentation Services Module

## MODULE PURPOSE

This module manages visual and interaction aspects that do NOT involve state logic or synchronization.
It provides independent presentation services: icon resolution from the active theme, theme change detection, drag & drop logic with restrictions, and persistence of per-group customization (rename/color/lock).

**Exact responsibilities:**
- Resolve file icons from the active VS Code icon theme (base64 data URIs)
- Detect theme changes (icon theme, color theme, product icon theme)
- Implement drag & drop logic with restrictions (pinned do not move, variants cannot be dragged)
- Validate drops before executing reordering
- Provide fallbacks to codicons when theme has no icon
- Persist and reapply per-group customization (label, color, lock) keyed by `viewColumn`

**It is NOT responsible for:**
- State synchronization with VS Code (see services/core/)
- HTML rendering (see providers/)
- Bay state management (see services/core/BayStateService)
- Executing VS Code commands (see models/actions/)
- Git status or diagnostics (see services/integration/)

---

## TECHNICAL INVARIANTS

1. **VS Code already caches icons** - Do not implement additional cache (unnecessary overhead)
2. **Icons always have fallback** - If theme has no icon, use generic codicon
3. **Base64 data URIs for webview** - SVG/PNG icons converted to data URIs
4. **Font-icons use marker format** - `font-icon:CHAR:COLOR` for font-based themes (Seti)
5. **Pinned bays NEVER move** - Drag & drop always blocks pinned bays
6. **Variants CANNOT be dragged independently** - They are linked to their parent
7. **Unpinned CANNOT drop over pinned section** - Maintain clear separation
8. **Theme changes trigger rebuild** - Theme change → rebuild icon map
9. **Icon map prioritizes: name > extension > languageId** - Specific resolution order
10. **Drag & drop is optimistic** - Validate before executing, not after
11. **The webview owns the DOM move on drop** - the host reorders its in-memory model silently (no rebuild event); it never re-renders to reflect a successful drag
12. **Group customization is keyed by `viewColumn`, not a group id** - VS Code has no stable editor-group identifier, so a rename/color/lock sticks to a column position across resyncs
13. **`apply()` always overwrites all three group fields** - never merges - so a recycled `viewColumn` can't inherit a previous group's color/lock

---

## IMPLEMENTATION RULES

### UI Services Architecture

```
BayIconManager (icon resolution)
  ├─ buildIconMap() → reads icon theme JSON
  ├─ getFileIconAsBase64() → resolves icon
  └─ getFallbackIcon() → generic codicon

ThemeService (theme detection)
  ├─ onDidChangeTheme → event
  └─ getCurrentIconTheme() → reads config

BayDragDropService (drag & drop logic)
  ├─ reorderWithinGroup() → reorder in same group
  ├─ moveBetweenGroups() → move to another group
  ├─ canDrop() → validate drop
  └─ findLastPinnedIndex() → calculate pinned limit

GroupCustomizationService (group rename/color/lock persistence)
  ├─ apply(group) → overwrite a rebuilt group's label/color/lock
  ├─ setLabel() / setColor() / setLocked() → patch + persist
  └─ get(groupId) → read stored customization
```

**Separation of responsibilities:**
- **BayIconManager** - Only icon resolution (no rendering)
- **ThemeService** - Only change detection (no style application)
- **BayDragDropService** - Only validation logic (no DOM interaction)
- **GroupCustomizationService** - Only persistence + reapplication (no rendering, no state-service bookkeeping)

### BayIconManager: Icon Resolution

**Initialization:**
```typescript
async initialize(context: ExtensionContext) {
  // 1. Build icon map from active theme
  await buildIconMap();
  
  // 2. Listen to theme changes
  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('workbench.iconTheme')) {
      await buildIconMap();
      this._onDidInitialize.fire();  // Notify providers
    }
  });
}
```

**Map building:**
```typescript
async buildIconMap() {
  // 1. Get active theme from config
  const iconTheme = vscode.workspace.getConfiguration().get('workbench.iconTheme');
  
  // 2. Find extension that contributes the theme
  const ext = findIconThemeExtension(iconTheme) || 
              findIconThemeExtension('vs-seti');  // Fallback
  
  // 3. Read theme JSON
  const themePath = path.join(ext.extensionPath, themeContribution.path);
  const themeJson = JSON.parse(await readFile(themePath, 'utf8'));
  
  // 4. Build map: name/ext/lang → iconId
  const iconMap = {};
  
  // fileNames: exact matches (highest priority)
  themeJson.fileNames?.forEach(([name, iconId]) => {
    iconMap[`name:${name.toLowerCase()}`] = iconId;
  });
  
  // fileExtensions: extension matches
  themeJson.fileExtensions?.forEach(([ext, iconId]) => {
    iconMap[`ext:${ext.toLowerCase()}`] = iconId;
  });
  
  // languageIds: language matches (lowest priority)
  themeJson.languageIds?.forEach(([lang, iconId]) => {
    iconMap[`lang:${lang.toLowerCase()}`] = iconId;
  });
  
  this._iconMap = iconMap;
  this._iconThemeJson = themeJson;
}
```

**Icon resolution:**
```typescript
async getFileIconAsBase64(fileName: string, context: ExtensionContext, languageId?: string) {
  if (!this._iconMap) return getFallbackIcon();
  
  const fileNameLower = fileName.toLowerCase();
  const ext = extractExtension(fileNameLower);
  
  // Priority resolution
  let iconId: string | undefined;
  
  if (this._iconMap[`name:${fileNameLower}`]) {
    iconId = this._iconMap[`name:${fileNameLower}`];  // Exact name match
  } else if (ext && this._iconMap[`ext:${ext}`]) {
    iconId = this._iconMap[`ext:${ext}`];             // Extension match
  } else if (languageId && this._iconMap[`lang:${languageId.toLowerCase()}`]) {
    iconId = this._iconMap[`lang:${languageId}`];     // Language match
  }
  
  if (!iconId) {
    iconId = getGenericFileIconId();  // Generic file icon from theme
  }
  
  if (!iconId) return getFallbackIcon();  // Codicon fallback
  
  const iconDef = this._iconThemeJson.iconDefinitions[iconId];
  
  // Font-based theme (Seti)
  if (iconDef.fontCharacter) {
    return `font-icon:${iconDef.fontCharacter}:${iconDef.fontColor || '#cccccc'}`;
  }
  
  // SVG/PNG theme
  const iconPath = iconDef.iconPath || iconDef.path;
  const absPath = path.resolve(themeDir, iconPath);
  const fileData = await readFile(absPath);
  const base64 = fileData.toString('base64');
  const mime = iconPath.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  
  return `data:${mime};base64,${base64}`;
}
```

**Fallback:**
```typescript
private getFallbackIcon(): string {
  return 'font-icon:\E023:#d4d7d6';  // codicon-file (Unicode E023)
}
```

**Note:** the `font-icon:CHAR:COLOR` marker itself is built and parsed through the shared `buildFontIconMarker()` / `parseFontIconMarker()` helpers in `src/utils/iconMarkers.ts`, not ad-hoc string splitting. Separately, for webview tabs, `IconRenderer` can resolve a real extension logo instead of a theme/codicon icon — `utils/webviewExtensionIcons.ts` maps a `viewType` substring (e.g. `claude` → `anthropic.claude-code`) to that extension's own icon asset (e.g. `resources/claude-logo.svg`), inlined as base64.

### ThemeService: Change Detection

**Purpose:** Notify when the theme changes so providers refresh UI.

```typescript
activate(context: ExtensionContext) {
  vscode.workspace.onDidChangeConfiguration(e => {
    if (
      e.affectsConfiguration('workbench.iconTheme') ||
      e.affectsConfiguration('workbench.productIconTheme') ||
      e.affectsConfiguration('workbench.colorTheme')
    ) {
      this._onDidChangeTheme.fire();  // Notify subscribers
    }
  });
}

// Usage in providers/
themeService.onDidChangeTheme(() => {
  webviewProvider.refresh();  // Rebuild HTML with new icons
});
```

### BayDragDropService: Drag & Drop Logic

**Implemented restrictions:**
1. **Pinned bays do not move** - `sourceBay.state.isPinned → return false`
2. **Variants cannot be dragged** - `sourceBay.metadata.sourceBayId → return false`
3. **Unpinned cannot drop over pinned** - `insertIndex <= lastPinnedIndex → return false`
4. **No drop over pinned** - `targetBay.state.isPinned → return false`

**Ownership of the reorder (per current design):** the webview is the one that commits the DOM move — `dragdrop.js` moves the dragged `.bay` element client-side as part of the drop animation, so the row never disappears and reappears. `reorderWithinGroup()` only updates the in-memory `group.bays` order to match and does **not** fire a state-change event (no `updateBay`/`notifyChange` call) — doing so would trigger a full HTML rebuild that fights the animation the webview just played. If the host-side validation rejects the drop (returns `false`), the caller falls back to `provider.refresh()` to restore the authoritative order.

**Reordering within the same group** (`src/services/ui/BayDragDropService.ts`):
```typescript
reorderWithinGroup(sourceBayId, targetBayId, insertPosition: 'before' | 'after'): boolean {
  const sourceBay = this.stateService.getBayById(sourceBayId);
  const targetBay = this.stateService.getBayById(targetBayId);
  
  // Validations
  if (!sourceBay || !targetBay) return false;
  if (sourceBay.state.groupId !== targetBay.state.groupId) return false;
  
  // Restriction 1: Variants cannot be moved (linked to their parent)
  if (sourceBay.metadata.sourceBayId) {
    Logger.log('[DragDrop] Blocked: Child bays cannot be dragged independently');
    return false;
  }
  
  // Restriction 2: Pinned cannot be moved
  if (sourceBay.state.isPinned) return false;
  
  const group = this.stateService.getGroup(sourceBay.state.groupId);
  const lastPinnedIndex = this.findLastPinnedIndex(group.bays);
  
  const sourceIndex = group.bays.findIndex(t => t.metadata.id === sourceBayId);
  const targetIndex = group.bays.findIndex(t => t.metadata.id === targetBayId);
  
  // Calculate insert position
  let insertIndex = insertPosition === 'before' ? targetIndex : targetIndex + 1;
  
  // Restriction 3: Unpinned cannot go over pinned section
  if (!sourceBay.state.isPinned && insertIndex <= lastPinnedIndex) {
    return false;
  }
  
  // Restriction 4: No drop over pinned
  if (targetBay.state.isPinned && !sourceBay.state.isPinned) {
    return false;
  }
  
  // Do not move if same position
  if (sourceIndex === insertIndex || sourceIndex === insertIndex - 1) {
    return false;
  }
  
  // Execute reorder (in-memory only — no rebuild event; the webview already
  // moved the DOM node itself)
  group.bays.splice(sourceIndex, 1);
  
  // Adjust insertIndex if source was before
  if (sourceIndex < insertIndex) insertIndex--;
  
  group.bays.splice(insertIndex, 0, sourceBay);
  
  // Update indexInGroup
  group.bays.forEach((bay, idx) => {
    bay.state.indexInGroup = idx;
  });
  
  return true;
}
```

**Move between groups:**
```typescript
async moveBetweenGroups(
  sourceBayId: string,
  targetGroupId: number,
  targetBayId?: string,
): Promise<boolean> {
  const sourceBay = this.stateService.getBayById(sourceBayId);
  if (!sourceBay) return false;
  
  // Restriction: variants follow their parent — never move alone
  if (sourceBay.metadata.sourceBayId) {
    Logger.log('[DragDrop] Blocked: variant bays cannot be moved between groups');
    return false;
  }
  
  // Restriction: Pinned cannot be moved
  if (sourceBay.state.isPinned) return false;
  
  // Restriction: a locked source group doesn't let its bays leave — moving
  // between groups closes+reopens the bay, which would be a back door to
  // the close button the lock removed. Reordering INSIDE the group is fine.
  const sourceGroup = this.stateService.getGroup(sourceBay.state.groupId);
  if (sourceGroup?.isLocked) {
    Logger.log('[DragDrop] Blocked: source group is locked');
    return false;
  }
  
  const targetGroup = this.stateService.getGroup(targetGroupId);
  if (!targetGroup) return false;
  
  // If specific target, validate
  if (targetBayId) {
    const targetBay = this.stateService.getBayById(targetBayId);
    if (targetBay && targetBay.state.isPinned) {
      return false;  // No drop over pinned
    }
  }
  
  // Close in source group, open in destination (file bays close+reopen by
  // URI; webview bays move the live tab natively). ID changes because it
  // includes viewColumn — native tab events rebuild the view.
  try {
    await sourceBay.moveToGroup(targetGroupId);
    return true;
  } catch (error) {
    Logger.error('[BayDragDrop] Failed to move bay between groups:', error);
    return false;
  }
}
```

**Drop validation:**
```typescript
canDrop(sourceBayId: string, targetBayId: string): boolean {
  const sourceBay = this.stateService.getBayById(sourceBayId);
  const targetBay = this.stateService.getBayById(targetBayId);
  
  if (!sourceBay || !targetBay) return false;
  
  // Pinned cannot be moved
  if (sourceBay.state.isPinned) return false;
  
  // No drop over pinned
  if (targetBay.state.isPinned) return false;
  
  return true;
}
```

---

## GroupCustomizationService (editor-group customization)

**File:** `src/services/ui/GroupCustomizationService.ts`. Persists what the user has customized on an editor group — rename, color, lock — so it survives the group being rebuilt from scratch on every sync (`BaySyncService` re-derives `BayGroup` objects from VS Code's native `TabGroup`s; nothing about a `BayGroup` is stable across a resync except its `viewColumn`).

**Storage:**
- Backing store: `context.workspaceState`, key `bays.groupCustomizations`.
- Shape: `Record<string, GroupCustomization>` where
  ```typescript
  export type GroupCustomization = {
    label ?: string;
    color ?: BayGroupColor;   // undefined = automatic, derived from viewColumn
    locked?: boolean;
  };
  ```
- **Keyed by `viewColumn` (stringified), not a group id.** VS Code exposes no stable identifier for an editor group — closing a split renumbers the remaining columns — so `viewColumn` is the only key the public API offers. In `BayGroup`, `id === viewColumn`, so `get(groupId)`/`patch(groupId, …)` read/write `this.data[String(groupId)]` directly. Practical consequence: a customization sticks to a *column position*, not to "the group that used to be there" — if group 2 is closed, whatever group ends up as the new column 2 inherits column 2's stored customization.

**API:**
- `get(groupId): GroupCustomization | undefined` — raw read.
- `apply(group: BayGroup): void` — called once per freshly-rebuilt `BayGroup` (after every sync, before the group is handed to the renderers). Overwrites all three fields unconditionally:
  ```typescript
  apply(group: BayGroup): void {
    const custom      = this.get(group.id);
    group.customLabel = custom?.label;
    group.color       = custom?.color  ?? defaultGroupColor(group.viewColumn);
    group.isLocked    = custom?.locked ?? false;
  }
  ```
  It must overwrite rather than merge: a `BayGroup` is rebuilt from zero on every sync, so a recycled `viewColumn` should never keep the color/lock of whatever group previously lived at that column — `apply()` is what prevents that leak.
- `setLabel(groupId, label)`, `setColor(groupId, color)`, `setLocked(groupId, locked)` — each normalizes its input (trimmed label, `false`→`undefined` for lock) and delegates to a private `patch()` that merges the field, **prunes any key whose value is `undefined`**, and deletes the whole entry once it's empty — so a group that has been fully reset back to defaults leaves no residue in workspaceState. Each setter persists via `context.workspaceState.update()` (async, wrapped in try/catch, logs on failure) and returns the awaited `Promise<void>`.

**Wiring (`extension.ts`):** constructed right after `BayStateService` — `new GroupCustomizationService(context)` — and injected via `stateService.setGroupCustomizationService(service)` *before* `BaySyncService` runs its first sync, so the very first render already carries user customizations rather than flashing defaults. `GroupActions` (in `providers/`) is the caller for the three setters, invoked from the `bays.renameGroup` / `bays.setGroupColor` / `bays.toggleGroupLock` commands; on success it calls `stateService.refreshGroupCustomizations()`, which re-`apply()`s every group and fires `onDidChangeState` (full rebuild).

**Related model — `BayGroup` (`src/models/BayGroup.ts`):**
- `GROUP_COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple']`; each id maps in `group-header.css` to a `--vscode-charts-*` custom property, so a group's color stays native to the active color theme instead of a fixed hex.
- `defaultGroupColor(viewColumn)` distributes the palette by column (`GROUP_COLORS[(viewColumn - 1) % GROUP_COLORS.length]`) so adjacent groups never collide when the user hasn't picked a color.
- `getGroupLabel(group) = group.customLabel?.trim() || group.label`, where `label` is the column-derived default (`"Group N"`). `GroupHeaderRenderer` calls this rather than reading `label`/`customLabel` directly.
- Every `BayGroup` always has a `color` (auto or user-chosen) and an `isLocked` boolean — there is no "uncustomized" tri-state at the render layer, only at the storage layer (`GroupCustomization` fields are optional; `BayGroup` fields are not).

---

## KNOWN SPECIAL CASES

### 1. Icon Theme without Specific Icons

**Problem:** Theme defines only generic icons (file, folder).

**Detection:**
```typescript
// Search for specific file: "extension.ts"
const iconId = iconMap[`name:extension.ts`];  // undefined

// Search by extension: ".ts"
const iconId = iconMap[`ext:ts`];  // undefined

// Fallback to generic file icon
const iconId = getGenericFileIconId();  // "_file" or "file"
```

**Result:** Uses theme's generic icon, or codicon if not present.

### 2. Font-Icon Theme (Seti)

**Characteristics:**
```typescript
iconDefinition: {
  fontCharacter: "\E003",  // Unicode character
  fontColor: "#49d29e"      // Color hex
}
```

**Rendering:**
```typescript
// IconRenderer detects font-icon marker
if (iconData.startsWith('font-icon:')) {
  const [_, char, color] = iconData.split(':');
  return `<span class="seti-icon" style="color: ${color};">${char}</span>`;
}
```

**Required CSS:**
```css
.seti-icon {
  font-family: 'seti';  /* Theme font */
  font-size: 16px;
}
```

### 3. SVG Icon with Relative Path

**Icon definition:**
```json
{
  "typescript": {
    "iconPath": "./icons/typescript.svg"
  }
}
```

**Resolution:**
```typescript
// Theme JSON at: /ext/vscode-icons/icons.json
const themeDir = path.dirname('/ext/vscode-icons/icons.json');
// → /ext/vscode-icons

const iconPath = "./icons/typescript.svg";
const absPath = path.resolve(themeDir, iconPath);
// → /ext/vscode-icons/icons/typescript.svg

const fileData = await readFile(absPath);
```

### 4. Theme Changes During Session

**Flow:**
```
User: Settings → Icon Theme → Seti → Material Icon Theme

1. onDidChangeConfiguration fires
2. BayIconManager.buildIconMap()
   → Reads new theme JSON
   → Rebuilds iconMap
3. _onDidInitialize.fire()
4. Providers listen to event
5. webviewProvider.refresh()
   → Rebuilds HTML with new icons
```

**IMPORTANT:** All icons are regenerated (no persistent cache).

### 5. Drag Pinned Bay (Blocked)

**Scenario:** User tries to drag pinned bay.

**UI behavior:**
```typescript
// webview/dragdrop.js
const bay = bayElement.closest('.bay');
const isPinned = bay.dataset.pinned === 'true';

if (isPinned) {
  bay.style.cursor = 'not-allowed';  // Visual feedback
  return;  // Do not start drag
}
```

**Backend validation:**
```typescript
reorderWithinGroup(sourceBayId, targetBayId, insertPosition) {
  if (sourceBay.state.isPinned) return false;  // ⚠️ Blocked
}
```

**Result:** Drag does not execute, cursor shows "not-allowed".

### 6. Drop Unpinned on Pinned Section

**Layout:**
```
Group 1:
  [Pinned] file1.ts     ← lastPinnedIndex = 0
  [      ] file2.ts
  [      ] file3.ts ← dragging
```

**Attempt:** Drag `file3.ts` before `file1.ts` (pinned).

**Validation:**
```typescript
const lastPinnedIndex = 0;  // file1.ts
const insertIndex = 0;       // before file1.ts

if (!sourceBay.state.isPinned && insertIndex <= lastPinnedIndex) {
  return false;  // ⚠️ Blocked
}
```

**Result:** Drop does not execute, bay returns to original position.

### 7. Drag Variant (Blocked)

**Scenario:** User tries to drag a variant bay (diff/snapshot/staged change — not a distinct `bayType`, just a bay whose `metadata.sourceBayId` points at its parent).

**Detection:**
```typescript
if (sourceBay.metadata.sourceBayId) {
  Logger.log('[DragDrop] Blocked: Child bays cannot be dragged independently');
  return false;
}
```

**Reason:** Variants are linked to their parent, moving independently would break hierarchy.

### 8. Icon Not Found in Theme

**Scenario:** File `custom.xyz` with unknown extension.

**Resolution:**
```typescript
// 1. name match
iconId = iconMap['name:custom.xyz'];  // undefined

// 2. extension match
iconId = iconMap['ext:xyz'];  // undefined

// 3. language match (if available)
iconId = iconMap['lang:xyz'];  // undefined

// 4. Generic file icon
iconId = getGenericFileIconId();  // "_file" or "file"
if (iconId && iconDef exists) return base64...

// 5. Codicon fallback
return 'font-icon:\E023:#d4d7d6';  // codicon-file
```

**Result:** There is always an icon, never undefined.

---

## REAL OBSERVED EXAMPLES

### Example 1: Icon Resolution (TypeScript File)

```yaml
Input:
  fileName: "extension.ts"
  languageId: "typescript"
  iconTheme: "vscode-icons"

Processing (getFileIconAsBase64):
  1. Check exact name: iconMap["name:extension.ts"]
     → undefined (no exact match)
  
  2. Check extension: iconMap["ext:ts"]
     → "file_type_typescript"
  
  3. Get icon definition:
     iconDefinitions["file_type_typescript"] → {
       iconPath: "./icons/typescript.svg"
     }
  
  4. Read SVG file:
     absPath: "/ext/vscode-icons/icons/typescript.svg"
     fileData: <svg>...</svg>
  
  5. Convert to base64:
     base64: "PHN2Zz4uLi48L3N2Zz4="
     return: "data:image/svg+xml;base64,PHN2Zz4uLi48L3N2Zz4="

Output:
  "data:image/svg+xml;base64,PHN2Zz4uLi48L3N2Zz4="
```

### Example 2: Icon Resolution (Seti Theme)

```yaml
Input:
  fileName: "package.json"
  iconTheme: "vs-seti"

Processing:
  1. Check name: iconMap["name:package.json"]
     → "json-package"
  
  2. Get icon definition:
     iconDefinitions["json-package"] → {
       fontCharacter: "\E002",
       fontColor: "#f1c40f"
     }
  
  3. Detect font-based theme
     return: "font-icon:\E002:#f1c40f"

Output:
  "font-icon:\E002:#f1c40f"
  
Rendering (IconRenderer):
  <span class="seti-icon" style="color: #f1c40f;">&#xE002;</span>
```

### Example 3: Drag & Drop Within Group

```yaml
Initial State:
  Group 1:
    0: [Pinned] readme.md
    1: [      ] file1.ts
    2: [      ] file2.ts  ← dragging
    3: [      ] file3.ts  ← target (drop before)

Action:
  reorderWithinGroup(
    sourceBayId: "file:///file2.ts-1",
    targetBayId: "file:///file3.ts-1",
    insertPosition: "before"
  )

Processing:
  1. Validate bays exist ✓
  2. Same group ✓
  3. sourceBay.metadata.sourceBayId? → undefined ✓
  4. sourceBay.state.isPinned? → false ✓
  5. lastPinnedIndex = 0 (readme.md)
  6. sourceIndex = 2, targetIndex = 3
  7. insertIndex = before 3 → 3
  8. insertIndex (3) <= lastPinnedIndex (0)? → false ✓
  9. targetBay.state.isPinned? → false ✓
  10. Execute reorder (in-memory only, no rebuild event):
      - group.bays.splice(2, 1)  → remove file2.ts
      - group.bays.splice(3-1, 0, file2.ts)  → insert at 2
      - Update indexInGroup

  The webview already moved the DOM node client-side as part of the drop
  animation; this in-memory reorder just keeps the host model in sync.

Final State:
  Group 1:
    0: [Pinned] readme.md
    1: [      ] file1.ts
    2: [      ] file3.ts
    3: [      ] file2.ts  ← moved

Result: true (success)
```

### Example 4: Drag Pinned Bay (Blocked)

```yaml
Initial State:
  Group 1:
    0: [Pinned] file1.ts  ← dragging
    1: [      ] file2.ts  ← target

Action:
  reorderWithinGroup(
    sourceBayId: "file:///file1.ts-1",
    targetBayId: "file:///file2.ts-1",
    insertPosition: "after"
  )

Processing:
  1. Validate bays exist ✓
  2. Same group ✓
  3. sourceBay.metadata.sourceBayId? → undefined ✓
  4. sourceBay.state.isPinned? → true ❌
     return false;  // Blocked

Result: false (blocked by restriction)

UI Effect:
  - Drop animation cancels
  - Bay returns to original position
  - No state change
```

### Example 5: Drop Unpinned on Pinned Section (Blocked)

```yaml
Initial State:
  Group 1:
    0: [Pinned] file1.ts
    1: [Pinned] file2.ts  ← target (drop after)
    2: [      ] file3.ts  ← dragging

Action:
  reorderWithinGroup(
    sourceBayId: "file:///file3.ts-1",
    targetBayId: "file:///file2.ts-1",
    insertPosition: "after"
  )

Processing:
  1-4. Validations ✓
  5. lastPinnedIndex = 1 (file2.ts)
  6. sourceIndex = 2, targetIndex = 1
  7. insertIndex = after 1 → 2
  8. !sourceBay.state.isPinned (true) && insertIndex (2) <= lastPinnedIndex (1)?
     → false (2 > 1) ✓
  
  Wait, let me recalculate:
  insertIndex = after targetIndex → targetIndex + 1 → 1 + 1 = 2
  lastPinnedIndex = 1
  2 <= 1? → false
  
  So this would actually be allowed!
  
  But if we drop BEFORE file2.ts:
  insertIndex = before 1 → 1
  1 <= 1? → true ❌
  return false;  // Blocked

Result: 
  - Drop AFTER last pinned: allowed
  - Drop BEFORE or ON pinned: blocked
```

### Example 6: Theme Change Event

```yaml
Initial State:
  iconTheme: "vscode-icons"
  iconMap: { "ext:ts": "typescript", ... }

User Action:
  Settings → Icon Theme → Material Icon Theme

Event Flow:
  1. vscode.workspace.onDidChangeConfiguration fires
     event.affectsConfiguration('workbench.iconTheme') → true
  
  2. BayIconManager.buildIconMap()
     iconTheme: "material-icon-theme"
     → Find extension
     → Read theme JSON
     → Build new iconMap: { "ext:ts": "file_type_typescript", ... }
  
  3. _onDidInitialize.fire()
  
  4. Providers listen:
     webviewProvider.onDidInitialize(() => {
       this.refresh();  // Rebuild HTML
     })
  
  5. BaysHtmlBuilder.buildHtml()
     → IconRenderer uses BayIconManager
     → getFileIconAsBase64("extension.ts")
     → Returns NEW icon from Material theme
  
  6. webview.html = newHtml
  
Result:
  All icons updated to Material Icon Theme style
```

---

## DEBUGGING TIPS

**Logger patterns in services/ui:**
```typescript
// BayIconManager
Logger.log('[BayIconManager] Initialized: theme=' + themeId);
Logger.warn('[BayIconManager] No icon theme extension found');
Logger.error('[BayIconManager] Failed to load theme JSON:', err);
Logger.error('[BayIconManager] Failed to read icon file: ' + iconPath, err);

// BayDragDropService
Logger.log('[DragDrop] Blocked: Child bays cannot be dragged independently');
Logger.log('[DragDrop] Blocked: variant bays cannot be moved between groups');
Logger.log('[DragDrop] Blocked: source group is locked');
Logger.error('[BayDragDrop] Failed to move bay between groups:', error);

// GroupCustomizationService
Logger.error('[GroupCustomization] Failed to persist group customizations', err);
```

**Check icon map:**
```typescript
const manager = new BayIconManager();
await manager.initialize(context);

console.log('Icon map:', {
  theme: manager._iconThemeId,
  entries: Object.keys(manager._iconMap).length,
  sample: Object.entries(manager._iconMap).slice(0, 5)
});
```

**Check icon resolution:**
```typescript
const iconData = await manager.getFileIconAsBase64('file.ts', context);
console.log('Icon type:', {
  isFontIcon: iconData?.startsWith('font-icon:'),
  isBase64: iconData?.startsWith('data:'),
  length: iconData?.length
});
```

**Check drag restrictions:**
```typescript
const canDrag = !sourceBay.state.isPinned && !sourceBay.metadata.sourceBayId;
const canDropHere = !targetBay.state.isPinned;

console.log('Drag validation:', {
  canDrag,
  canDropHere,
  lastPinnedIndex: findLastPinnedIndex(group.bays),
  insertIndex
});
```

---

## RESPONSIBILITY LIMITS

**This module MUST NOT:**
- Render HTML or manipulate DOM (providers/)
- Manage Bays state (services/core/BayStateService)
- Synchronize with VS Code Tab API (services/core/BaySyncService)
- Execute user commands (models/actions/)
- Query git status or diagnostics (services/integration/)
- Decide *when* to persist a group customization (commands/`GroupActions` own that; `GroupCustomizationService` only stores + reapplies what it's told)

**This module MUST:**
- Resolve icons from active VS Code theme
- Convert icons to renderable formats (base64, font-icons)
- Detect theme changes and notify
- Validate drag & drop operations
- Implement movement restrictions (pinned, variants)
- Provide fallbacks when theme has no icons
- Persist per-group label/color/lock in `workspaceState`, keyed by `viewColumn`
- Reapply stored group customization onto every freshly-rebuilt `BayGroup`

---

## PERFORMANCE CONSIDERATIONS

**Icon resolution:**
- **NO manual cache** - VS Code already caches icons internally
- **Async file reading** - `fs/promises` non-blocking
- **Icon map is Map** - O(1) lookup by name/ext/lang
- **Base64 conversion on demand** - Only when rendering

**Theme rebuild:**
- Only when theme changes (rare)
- Icon map rebuilt completely (not incremental)
- Providers notified once (batch update)

**Drag & drop validation:**
- **Validation before execution** - Avoids costly rollbacks
- **O(n) findLastPinnedIndex** - n = tabs in group (~5-20)
- **Early returns** - First failed validation → return false
- **No optimistic updates** - Validate first, execute after
- **In-memory reorder fires no event** - the webview already committed the DOM move; a successful `reorderWithinGroup`/`moveBetweenGroups` only mutates `group.bays` so the (silent) host model matches what's already on screen

**Group customization persistence:**
- **In-memory dict, write-through** - the full `Record<string, GroupCustomization>` is held in `this.data` and rewritten to `workspaceState` on every `patch()`; there is no debounce, but writes only happen on explicit user actions (rename/color/lock), not per-render
- **`apply()` is O(1) per group** - a plain object lookup by `String(viewColumn)`, called once per group on every full rebuild
- **Self-pruning** - empty entries are deleted rather than stored as `{}`, keeping `workspaceState` free of stale columns over time
