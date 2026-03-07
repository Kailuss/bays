# services/ui/ - UI Presentation Services Module

## MODULE PURPOSE

This module manages visual and interaction aspects that do NOT involve state logic or synchronization.
It provides independent presentation services: icon resolution from the active theme, theme change detection, and drag & drop logic with restrictions.

**Exact responsibilities:**
- Resolve file icons from the active VS Code icon theme (base64 data URIs)
- Detect theme changes (icon theme, color theme, product icon theme)
- Implement drag & drop logic with restrictions (pinned do not move, variants cannot be dragged)
- Validate drops before executing reordering
- Provide fallbacks to codicons when theme has no icon

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
```

**Separation of responsibilities:**
- **BayIconManager** - Only icon resolution (no rendering)
- **ThemeService** - Only change detection (no style application)
- **BayDragDropService** - Only validation logic (no DOM interaction)

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
1. **Pinned bays do not move** - `sourceBay.isPinned → return false`
2. **Variants cannot be dragged** - `sourceBay.parentId → return false`
3. **Unpinned cannot drop over pinned** - `insertIndex <= lastPinnedIndex → return false`
4. **No drop over pinned** - `targetBay.isPinned → return false`

**Reordering within the same group:**
```typescript
reorderWithinGroup(sourceBayId, targetBayId, insertPosition: 'before' | 'after'): boolean {
  const sourceBay = stateService.fetchBayById(sourceBayId);
  const targetBay = stateService.fetchBayById(targetBayId);
  
  // Validations
  if (!sourceBay || !targetBay) return false;
  if (sourceBay.groupId !== targetBay.groupId) return false;
  
  // Restriction 1: Variants cannot be moved
  if (sourceBay.metadata.parentId) {
    Logger.log('[DragDrop] Blocked: Variants cannot be dragged');
    return false;
  }
  
  // Restriction 2: Pinned cannot be moved
  if (sourceBay.state.isPinned) return false;
  
  const group = stateService.getGroup(sourceBay.groupId);
  const lastPinnedIndex = findLastPinnedIndex(group.tabs);
  
  const sourceIndex = group.tabs.indexOf(sourceBay);
  const targetIndex = group.tabs.indexOf(targetBay);
  
  // Calculate insert position
  let insertIndex = insertPosition === 'before' ? targetIndex : targetIndex + 1;
  
  // Restriction 3: Unpinned cannot go over pinned section
  if (!sourceBay.isPinned && insertIndex <= lastPinnedIndex) {
    return false;
  }
  
  // Restriction 4: No drop over pinned
  if (targetBay.isPinned && !sourceBay.isPinned) {
    return false;
  }
  
  // Do not move if same position
  if (sourceIndex === insertIndex || sourceIndex === insertIndex - 1) {
    return false;
  }
  
  // Execute reorder
  group.tabs.splice(sourceIndex, 1);
  
  // Adjust insertIndex if source was before
  if (sourceIndex < insertIndex) insertIndex--;
  
  group.tabs.splice(insertIndex, 0, sourceBay);
  
  // Update indexInGroup
  group.tabs.forEach((bay, idx) => {
    bay.state.indexInGroup = idx;
  });
  
  stateService.updateTab(sourceBay);  // Notify change
  
  return true;
}
```

**Move between groups:**
```typescript
async moveBetweenGroups(
  sourceBayId: string, 
  targetGroupId: number,
  targetBayId?: string, 
  insertPosition?: 'before' | 'after'
): Promise<boolean> {
  const sourceBay = stateService.fetchBayById(sourceBayId);
  
  // Validations
  if (!sourceBay || !sourceBay.metadata.uri) return false;
  
  // Restriction: Pinned cannot be moved
  if (sourceBay.isPinned) return false;
  
  const targetGroup = stateService.getGroup(targetGroupId);
  if (!targetGroup) return false;
  
  // If specific target, validate
  if (targetBayId) {
    const targetBay = stateService.fetchBayById(targetBayId);
    if (targetBay && targetBay.isPinned) {
      return false;  // No drop over pinned
    }
  }
  
  // Close in source group, open in destination
  // (ID changes because it includes viewColumn)
  try {
    await sourceBay.moveToGroup(targetGroupId);
    return true;
  } catch (error) {
    Logger.error('[BayDragDrop] Failed to move between groups:', error);
    return false;
  }
}
```

**Drop validation:**
```typescript
canDrop(sourceBayId: string, targetBayId: string): boolean {
  const sourceBay = stateService.fetchBayById(sourceBayId);
  const targetBay = stateService.fetchBayById(targetBayId);
  
  if (!sourceBay || !targetBay) return false;
  
  // Pinned cannot be moved
  if (sourceBay.isPinned) return false;
  
  // No drop over pinned
  if (targetBay.isPinned) return false;
  
  return true;
}
```

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
  if (sourceBay.isPinned) return false;  // ⚠️ Blocked
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

if (!sourceBay.isPinned && insertIndex <= lastPinnedIndex) {
  return false;  // ⚠️ Blocked
}
```

**Result:** Drop does not execute, bay returns to original position.

### 7. Drag Variant (Blocked)

**Scenario:** User tries to drag child bay (diff).

**Detection:**
```typescript
if (sourceBay.metadata.parentId) {
  Logger.log('[DragDrop] Blocked: Variants cannot be dragged');
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
  3. sourceBay.parentId? → undefined ✓
  4. sourceBay.isPinned? → false ✓
  5. lastPinnedIndex = 0 (readme.md)
  6. sourceIndex = 2, targetIndex = 3
  7. insertIndex = before 3 → 3
  8. insertIndex (3) <= lastPinnedIndex (0)? → false ✓
  9. targetBay.isPinned? → false ✓
  10. Execute reorder:
      - tabs.splice(2, 1)  → remove file2.ts
      - tabs.splice(3-1, 0, file2.ts)  → insert at 2
      - Update indexInGroup
  
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
  3. sourceBay.parentId? → undefined ✓
  4. sourceBay.isPinned? → true ❌
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
  8. !sourceBay.isPinned (true) && insertIndex (2) <= lastPinnedIndex (1)?
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
Logger.log('[DragDrop] Blocked: Variants cannot be dragged');
Logger.error('[BayDragDrop] Failed to move bay between groups:', error);
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
const canDrag = !sourceBay.isPinned && !sourceBay.metadata.parentId;
const canDropHere = !targetBay.isPinned;

console.log('Drag validation:', {
  canDrag,
  canDropHere,
  lastPinnedIndex: findLastPinnedIndex(group.tabs),
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

**This module MUST:**
- Resolve icons from active VS Code theme
- Convert icons to renderable formats (base64, font-icons)
- Detect theme changes and notify
- Validate drag & drop operations
- Implement movement restrictions (pinned, variants)
- Provide fallbacks when theme has no icons

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
