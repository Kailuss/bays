# services/core/ - Bay Synchronization & State Management

## MODULE PURPOSE

This module is responsible for keeping the internal state of Bays synchronized with VS Code's native tabs.
It is the **bidirectional bridge** between the VS Code Tab API and the internal data model (Bay).
It manages the complete lifecycle of Bays: detection, conversion, update, hierarchical relationships, and cleanup.

**Exact responsibilities:**
- Listen to VS Code events (tabs, groups, cursor, diagnostics) and convert them into state changes
- Convert native tabs (`vscode.Tab`) to Bay objects with enriched metadata
- Maintain in-memory store of Bays and groups with change events
- Manage parent-child relationships (variants with placeholders)
- Synchronize active states, preview ownership, and orphan cleanup
- Provide ID cache to avoid duplicates and reduce recalculations

**It is NOT responsible for:**
- HTML rendering (see providers/)
- Executing Bay actions (see models/actions/)
- Integration with Git or Copilot (see services/integration/)
- Icon or theme management (see services/ui/)

---

## TECHNICAL INVARIANTS

1. **BayStateService is the only source of truth** - providers and commands consult State, never Tab API directly
2. **Generated ID is deterministic** - Same URI + viewColumn → Same ID always (`uri.toString() + '-' + viewColumn`)
3. **Webview tabs do NOT have URI** - `bay.metadata.uri === undefined` for Settings/Extensions/custom webviews
4. **Markdown previews are filtered** - `viewType === 'markdown.preview'` does NOT create independent Bays, only marks `isPreviewOwner`
5. **Variants always have parentId** - If `metadata.parentId` exists, it's a child bay (diff/snapshot/compare)
6. **Parent placeholders are temporary** - Created if variant appears before parent, replaced when parent opens
7. **Orphaned tabs are cleaned up automatically** - Tabs in state but not in VS Code are removed on each `e.closed`
8. **hasChildren synchronized with reality** - `recalculateAllCounts()` keeps `childrenCount` and real children in sync
9. **Silent updates do NOT rebuild UI** - `updateTabSilent()` only for visual changes (isActive), avoids costly refresh
10. **Git/diagnostics updated lazily** - Only when tab changes state, not in continuous polling

---

## IMPLEMENTATION RULES

### Modular Architecture (bay/ subfolder)

```
BaySyncService (orchestrator)
  ├─ BayEventService (VS Code listeners registry)
  ├─ BayHeadService (parent placeholders + doc opening)
  ├─ ActiveStateService (isActive sync + orphan cleanup)
  └─ uses →
      ├─ BayStateService (in-memory store)
      ├─ BayHierarchyService (parent-child relationships)
      ├─ PreviewService (ephemeral Markdown preview)
      └─ GitSyncService (git status)
```

**Reason for separation:**
- `BaySyncService` was ~900 LOC monolithic → split into 4 specialized services
- Each service has a unique and testable responsibility
- Avoids circular dependencies via injection

### Conversion Flow (Native Tab → Bay)

```typescript
vscode.Tab (input)
  ↓
extractRawTabData() → RawTabData
  ↓
processHiddenDiff() → ProcessedTabData (adds parentId, diffType)
  ↓
new Bay(metadata, state)
  ├─ metadata: enrichMetadata()
  ├─ state: createDefaultState()
  ├─ capabilities: computeCapabilities()
  └─ gitStatus: gitSyncService.getGitStatus()
  ↓
Bay (output)
```

**Key point:** `convertToBay()` is a **pure function** (except git status) - same inputs → same Bay.

### ID Caching (Performance)

**WeakMap cache (automatic GC):**
```typescript
const idCache = new WeakMap<vscode.Tab, string>();
// Maps native tab → generated ID
// Automatically freed when VS Code discards the tab
```

**Map cache (manual):**
```typescript
const uriCache = new Map<string, string>();
// Maps canonical URI → base ID
// To collapse diffs with volatile query params (git:?ref=HEAD)
```

**ID scheme:**
```typescript
// With URI
id = uri.toString() + '-' + viewColumn
// Ex: "file:///c:/src/file.ts-1"

// Without URI (webviews)
id = 'webview:' + sanitizedLabel + '-' + viewColumn
// Ex: "webview:settings-1"

// Diffs with parentId (variants)
// Same scheme but metadata.parentId is defined
```

### Diff Types Classification (Hybrid)

**Combined strategy: instanceof + scheme + query + viewType**

```typescript
// 1. Check if TabInputTextDiff
if (input instanceof vscode.TabInputTextDiff) {
  
  // 2. Analyze scheme of modified URI
  const scheme = input.modified?.scheme;
  
  // 3. Extract query params (git refs)
  const query = input.modified?.query;
  
  // 4. Classify by observed patterns
  return classifyDiffType(scheme, query, label);
}
```

**Known diff schemes:**
- `git:?ref=~` → `working-tree` (unstaged changes)
- `git:?ref=` (empty) → `staged` (staged changes)
- `git:?ref=HEAD` → `compare` (compare with commit)
- `file:` + diff context → `snapshot` (temp edit)
- `vscode-merge-conflict:` → `unknown` (merge editor)

### Parent Placeholder Flow

**Problem:** Variant can appear before its parent (VS Code timing).

**Solution:**
1. Detect `metadata.parentId !== null` but parent does not exist in state
2. Create `placeholder` Bay with minimal metadata:
   ```typescript
   {
     label: extractFileName(variantUri),
     uri: variantUri,
     bayType: 'file',
     isLoading: true,  // visual flag
   }
   ```
3. Add placeholder to state with `parentId` as ID
4. Register variant as child of the placeholder
5. When real parent appears, **replace** placeholder:
   ```typescript
   replaceWithRealParent(nativeParent, variant, (realBay) => {
     stateService.updateTab(realBay);  // Keeps same ID
   });
   ```

**Guarantees:**
- Placeholder ID === real parent ID (deterministic)
- Children keep valid `parentId` during replacement
- `hasChildren` and `childrenCount` are recalculated automatically

### Active State Synchronization

**Problem:** `isActive` state from VS Code does not always reflect visible UI (Markdown preview).

**Strategy (ActiveStateService):**
1. **Synchronize preview ownership:**
   ```typescript
   syncPreviewOwnership() {
     const activePreview = findActivePreviewTab(group);
     if (activePreview) {
       const sourceBay = resolvePreviewSourceId(group, activePreview);
       if (sourceBay) {
         sourceBay.state.isPreviewOwner = true;
       }
     }
   }
   ```

2. **Synchronize isActive of all tabs:**
   ```typescript
   syncTabActiveStates() {
     // Mark all as inactive
     allBays.forEach(bay => bay.state.isActive = false);
     
     // Mark active according to VS Code
     for (const group of vscode.window.tabGroups.all) {
       const activeTab = group.activeTab;
       const bay = findBayFromNativeTab(activeTab);
       if (bay) bay.state.isActive = true;
     }
   }
   ```

**Called in:**
- Each `handleTabChanges()` (after processing changes)
- `openTab` in WebviewProvider (before activating)
- Active text editor change

### Orphaned Tabs Cleanup

**Definition:** Tabs that exist in `BayStateService` but no longer in VS Code.

**Common causes:**
- Preview tabs converted to permanent (VS Code reuses ID)
- Tabs closed by another extension
- Tabs moved between groups (ID changes)

**Detection:**
```typescript
removeOrphanedTabs() {
  const nativeIds = new Set<string>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      nativeIds.add(generateIdFromNativeBay(tab));
    }
  }
  
  const orphans = allBays.filter(bay => !nativeIds.has(bay.metadata.id));
  
  orphans.forEach(bay => {
    Logger.log(`Removing orphaned: ${bay.metadata.label}`);
    stateService.removeTab(bay.metadata.id);
  });
}
```

**IMPORTANT:** Do NOT remove variants whose parent is closed - they are valid "orphan variants", shown in UI.

### Event Handling (BayEventService)

**Registered listeners:**
```typescript
vscode.window.tabGroups.onDidChangeTabs        → handleTabChanges()
vscode.window.tabGroups.onDidChangeTabGroups   → handleGroupChanges()
vscode.window.onDidChangeActiveTextEditor      → updateActiveTab()
vscode.languages.onDidChangeDiagnostics        → updateTabDiagnostics()
vscode.window.onDidChangeTextEditorSelection   → handleCursorChange()
```

**Handling pattern:**
```typescript
async handleTabChanges(e: TabChangeEvent) {
  // 1. Process openings (can be async if placeholders)
  for (const tab of e.opened) {
    const bay = convertToBay(tab, gitSyncService);
    if (bay.metadata.parentId) {
      await parentService.ensureParentExists(bay, tab);
      hierarchyService.registerChild(bay.id, bay.metadata.parentId);
    }
    stateService.addBay(bay);
  }
  
  // 2. Clean closed (sync)
  if (e.closed.length > 0) {
    activeStateService.removeOrphanedTabs();
  }
  
  // 3. Update changes (optimized)
  for (const tab of e.changed) {
    const bay = convertToBay(tab, gitSyncService);
    const existing = stateService.fetchBayById(bay.id);
    
    // Detect if only isActive changed (silent update)
    const onlyActive = /* ... comparison ... */;
    
    if (onlyActive) {
      stateService.updateTabSilent(existing);  // No rebuild UI
    } else {
      stateService.updateTab(existing);        // Full rebuild
    }
  }
  
  // 4. Synchronize active state
  activeStateService.syncActiveState();
}
```

### Full Sync (syncAll)

**When executed:**
- Extension activation (`activate()`)
- Explicit command `bays.refresh`

**Process:**
```typescript
syncAll() {
  // 1. Synchronize groups
  for (const nativeGroup of vscode.window.tabGroups.all) {
    stateService.addGroup(createBayGroup(nativeGroup));
  }
  
  // 2. Convert all tabs to Bays
  const allBays: Bay[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const bay = convertToBay(tab, gitSyncService);
      if (bay) {
        // Process parent-child relationships
        if (bay.metadata.parentId) {
          await parentService.ensureParentExistsForSync(bay, tab, allBays);
        }
        allBays.push(bay);
      }
    }
  }
  
  // 3. Replace complete state (atomic)
  stateService.replaceTabs(allBays);
  
  // 4. Recalculate hierarchy
  hierarchyService.recalculateAllCounts();
  
  // 5. Synchronize active state
  activeStateService.syncActiveState();
}
```

**Atomic replacement** (`replaceTabs()`) avoids inconsistencies during massive sync.

---

## KNOWN SPECIAL CASES

### 1. Variant Appears Before Parent

**Scenario:** User opens diff (`git:?ref=~`) before the base file.

**Flow:**
```
1. e.opened → TabInputTextDiff detected
2. convertToBay() → bay.metadata.parentId = "file:///src/file.ts-1"
3. stateService.fetchBayById(parentId) → undefined
4. parentService.ensureParentExists(bay, nativeTab)
   → createParentPlaceholder() → placeholder with isLoading: true
5. stateService.addBay(placeholder)
6. stateService.addBay(bay)  // variant with valid parentId
7. hierarchyService.registerChild(bay.id, parentId)
```

**UI Result:** Parent shows "Loading..." until user opens real file.

**Autocomplete (optional):**
- `ensureParentExists()` can try `vscode.workspace.openTextDocument(parentUri)`
- If it fails (e.g., remote file), placeholder remains

### 2. Preview Tab Converted to Permanent

**Symptom:** Tab disappears from state after editing preview.

**Cause:** VS Code reuses the slot, changing `isPreview: true → false`.

**Detection:**
```typescript
if (existing.state.isPreview && !tab.isPreview) {
  Logger.log('[TabSync] Preview became permanent: ' + existing.metadata.label);
}
```

**Treatment:**
- Update `bay.state.isPreview = false`
- Do NOT remove or recreate Bay (ID remains)
- `removeOrphanedTabs()` should NOT remove (native tab exists)

### 3. Markdown Preview Active Tab

**Problem:** When preview is active, source file appears inactive in UI.

**PreviewService strategy:**
```typescript
// activePreview = tab with viewType === 'markdown.preview'
const sourceFileName = activePreview.label.replace('Preview ', '');
const sourceTab = group.tabs.find(t => t.uri.path.endsWith(sourceFileName));
const sourceBay = stateService.fetchBayById(sourceTab.id);

// Mark source as "owner" of the preview
sourceBay.state.isPreviewOwner = true;

// CSS in UI shows sourceBay as active
```

**Invariant:** Only 1 Bay can have `isPreviewOwner: true` globally.

### 4. Same File in Multiple Groups

**Scenario:** `file.ts` open in groups 1 and 2.

**Generated IDs:**
```
Group 1: "file:///c:/src/file.ts-1"
Group 2: "file:///c:/src/file.ts-2"
```

**Independent Bays:**
- Different `groupId`
- Can have different `isDirty`, `isPinned`, `cursorLine`
- Shared git status (same URI)
- Shared icons (BayIconManager cache)

**NO collision** - ID includes `viewColumn`.

### 5. Diff with Volatile Query Params

**Problem:** Git diffs have query params that change (`?ref=~12345` timestamp).

**Observed scheme:**
```
git://file.ts?ref=~1234567890  → working-tree diff
git://file.ts?ref=~9876543210  → same diff, different timestamp
```

**Solution (URI cache):**
```typescript
const canonicalUri = uri.with({ query: '' });  // Remove query
const baseId = uriCache.get(canonicalUri);

if (baseId) {
  return baseId + '-' + viewColumn;  // Reuse base ID
} else {
  const newId = uri.toString() + '-' + viewColumn;
  uriCache.set(canonicalUri, newId.split('-')[0]);
  return newId;
}
```

**Result:** Multiple instances of the "same" diff collapse into one Bay.

### 6. Webview Tab (Settings/Extensions)

**Characteristics:**
```typescript
input: TabInputWebview
  viewType: "settings" | "workbench.extension.config" | ...
  uri: undefined  // ⚠️ NO URI
```

**Conversion:**
```typescript
extractFromWebview() {
  return {
    label: tab.label,           // "Settings"
    bayType: 'webview',
    viewType: input.viewType,   // "settings"
    uri: undefined,             // ⚠️ CRITICAL
    fileExtension: '',
  };
}
```

**Generated ID:**
```typescript
id = 'webview:' + label.replace(/\s+/g, '-').toLowerCase() + '-' + viewColumn
// Ex: "webview:settings-1"
```

**Restricted capabilities:**
- `canPin: false` (no URI)
- `canSplit: false`
- `canReveal: false`
- `canHaveChildren: false`

### 7. Cursor Position Tracking

**Listener:**
```typescript
vscode.window.onDidChangeTextEditorSelection(e => {
  const uri = e.textEditor.document.uri;
  const cursor = e.selections[0].active;  // Position
  
  const bay = stateService.findTabByUri(uri, e.textEditor.viewColumn);
  if (bay) {
    bay.state.cursorLine = cursor.line + 1;    // 1-indexed
    bay.state.cursorColumn = cursor.character + 1;
    stateService.updateTabSilent(bay);  // No rebuild
  }
});
```

**Debouncing:** NOT implemented (VS Code already debounces internally).

### 8. Diagnostics Sync

**Problem:** Diagnostics change independently of tab events.

**Listener:**
```typescript
vscode.languages.onDidChangeDiagnostics(e => {
  for (const uri of e.uris) {
    const bay = stateService.findTabByUri(uri);
    if (bay) {
      const oldSeverity = bay.state.diagnosticSeverity;
      const newSeverity = getDiagnosticSeverity(uri);
      
      if (oldSeverity !== newSeverity) {
        bay.state.diagnosticSeverity = newSeverity;
        stateService.updateTabStateWithAnimation(bay);  // Trigger badge animation
      }
    }
  }
});
```

**updateTabStateWithAnimation():** Fires `onDidChangeTabState` event for animation, NOT rebuild.

---

## REAL OBSERVED EXAMPLES

### Example 1: Tab Opened (Normal File)

```yaml
Input (vscode.Tab):
  input: TabInputText
    uri: "file:///c:/src/extension.ts"
  label: "extension.ts"
  isDirty: false
  isPinned: false
  isActive: true
  group.viewColumn: 1

Processing:
  1. extractFromText() → RawTabData
     bayType: 'file'
     uri: "file:///c:/src/extension.ts"
     label: "extension.ts"
  
  2. convertToBay() → Bay
     metadata.id: "file:///c:/src/extension.ts-1"
     metadata.parentId: undefined
     state.groupId: 1
     state.isActive: true
  
  3. stateService.addBay(bay)
  
  4. _onDidChangeState.fire()

Result:
  Bay created, providers receive event, UI renders new row
```

### Example 2: Variant Opened (Working Tree Diff)

```yaml
Input (vscode.Tab):
  input: TabInputTextDiff
    original: "file:///c:/src/file.ts"
    modified: "git:///c:/src/file.ts?ref=~1234"
  label: "file.ts (Working Tree)"
  group.viewColumn: 1

Processing:
  1. extractFromDiff() → RawTabData
     bayType: 'diff'
     uri: "git:///c:/src/file.ts?ref=~1234"
     originalUri: "file:///c:/src/file.ts"
  
  2. classifyDiffType(scheme: 'git', query: 'ref=~1234')
     → diffType: 'working-tree'
  
  3. determineParentId(modifiedUri, label)
     → parentId: "file:///c:/src/file.ts-1"
  
  4. stateService.fetchBayById(parentId) → undefined
  
  5. parentService.ensureParentExists()
     → createParentPlaceholder()
        metadata.id: "file:///c:/src/file.ts-1"
        metadata.label: "file.ts"
        state.isLoading: true
     → stateService.addBay(placeholder)
  
  6. stateService.addBay(variant)
  
  7. hierarchyService.registerChild(variant.id, parentId)
     → placeholder.state.hasChildren = true
     → placeholder.state.childrenCount = 1

Result:
  UI shows:
    file.ts (loading...)
      └─ Working Tree (+0/-0)
```

### Example 3: Tab Changed (Only isActive)

```yaml
Input (TabChangeEvent):
  changed: [tab]
  tab.isActive: true (was false)
  tab.isDirty: false (unchanged)
  tab.isPinned: false (unchanged)

Processing:
  existing = stateService.fetchBayById(tab.id)
  
  onlyActive = (
    existing.state.isDirty === tab.isDirty &&
    existing.state.isPinned === tab.isPinned &&
    existing.state.isActive !== tab.isActive
  ) // → true
  
  existing.state.isActive = true
  stateService.updateTabSilent(existing)
  
  _onDidChangeStateSilent.fire()  // NOT _onDidChangeState

Result:
  WebviewProvider receives silent event
  → postMessage({ command: 'updateBayState', bayId, state: { isActive: true } })
  → webview.js updates CSS class without rebuilding HTML
```

### Example 4: Orphaned Tab Cleanup

```yaml
State Before:
  shelves: [
    Bay("file:///a.ts-1"),
    Bay("file:///b.ts-1"),  // ← This was closed in VS Code
  ]

VS Code Reality:
  groups.all[0].tabs: [
    Tab(uri: "file:///a.ts")
  ]

Processing (removeOrphanedTabs):
  nativeIds = ["file:///a.ts-1"]
  
  orphans = shelves.filter(bay => !nativeIds.has(bay.id))
  // → [Bay("file:///b.ts-1")]
  
  for (orphan of orphans) {
    Logger.log("Removing orphaned: b.ts")
    stateService.removeTab("file:///b.ts-1")
  }

State After:
  shelves: [Bay("file:///a.ts-1")]
```

### Example 5: Markdown Preview Active

```yaml
VS Code State:
  group.tabs: [
    Tab(uri: "file:///readme.md", isActive: false),
    Tab(viewType: "markdown.preview", label: "Preview readme.md", isActive: true)
  ]

Processing (syncPreviewOwnership):
  activePreview = findActivePreviewTab(group)
  // → Tab with viewType === "markdown.preview"
  
  sourceFileName = "readme.md"  // from label
  
  sourceTab = group.tabs.find(t => t.uri.path.endsWith("readme.md"))
  // → Tab(uri: "file:///readme.md")
  
  sourceId = "file:///readme.md-1"
  
  sourceBay = stateService.fetchBayById(sourceId)
  sourceBay.state.isPreviewOwner = true

UI Result:
  readme.md row has .preview-owner class (CSS: visually active)
  Preview tab does NOT appear in list (filtered in BaysHtmlBuilder)
```

### Example 6: Same File, Multiple Groups

```yaml
VS Code State:
  groups.all[0].tabs: [Tab(uri: "file:///app.tsx")]
  groups.all[1].tabs: [Tab(uri: "file:///app.tsx")]

Generated IDs:
  Group 1: "file:///app.tsx-1"
  Group 2: "file:///app.tsx-2"

State:
  shelves: [
    Bay(id: "file:///app.tsx-1", groupId: 1, isDirty: true),
    Bay(id: "file:///app.tsx-2", groupId: 2, isDirty: false)
  ]

Independent State:
  ✓ Group 1 can be dirty, Group 2 clean
  ✓ Different cursor position in each group
  ✓ Independent pin state
  ✓ Git status SHARED (same URI)
```

---

## DEBUGGING TIPS

**Logger patterns in services/core:**
```typescript
// BaySyncService
Logger.log('[TabSync] Opened preview tab: ' + label);
Logger.log('[TabSync] Orphan Variant: ' + label);
Logger.log('[TabSync] Removing orphaned tab: ' + label);

// BayHierarchyService
Logger.log('[TabHierarchy] Registered child: ' + childLabel + ' → ' + parentLabel);
Logger.log('[TabHierarchy] Recalculated counts for N parents');

// ActiveStateService
Logger.log('[ActiveState] Syncing preview ownership for: ' + label);

// tabConverter
Logger.warn('[TabConverter] Unknown scheme detected: ' + scheme);
```

**Check synchronization:**
```typescript
// In DevTools console of webview
vscode.postMessage({ command: 'debugState' });
// → Backend prints full state
```

**Check cache hits:**
```typescript
// Add before convertToBay()
const cached = idCache.get(nativeTab);
if (cached) {
  Logger.log('[Cache] ID hit: ' + cached);
}
```

**Check parent-child:**
```typescript
const parents = stateService.fetchAllBays().filter(b => b.state.hasChildren);
Logger.log(`[Debug] Parents with children: ${JSON.stringify(
  parents.map(p => ({
    label: p.metadata.label,
    childrenCount: p.state.childrenCount,
    actualChildren: hierarchyService.getChildren(p.id).length
  }))
)}`);
```

---

## RESPONSIBILITY LIMITS

**This module MUST NOT:**
- Generate HTML or CSS (providers/)
- Execute VS Code commands as user (commands/)
- Manage icons or themes (services/ui/)
- Integrate with external APIs (services/integration/)
- Render UI or handle webview events (providers/)

**This module MUST:**
- Convert native tabs to Bays with complete metadata
- Keep state consistent with VS Code at all times
- Manage Bays lifecycle (create, update, delete)
- Provide change events for UI to react
- Guarantee unique and deterministic IDs
- Clean up inconsistencies (orphans, placeholders)
- Synchronize derived states (active, preview, diagnostics)

---

## PERFORMANCE CONSIDERATIONS

**Caching:**
- `idCache` (WeakMap) → O(1) lookup, automatic GC
- `uriCache` (Map) → O(1) lookup, avoids duplicate volatile diffs

**Debouncing:**
- NOT implemented in core (VS Code already does it)
- UI debouncing in providers/ (100ms)

**Silent updates:**
- `updateTabSilent()` → Only for `isActive` (frequent)
- Avoids HTML rebuild (costly)
- webview.js only updates CSS classes

**Bulk loading:**
- `replaceTabs()` uses `_isBulkLoading` flag
- Suppresses individual events during `syncAll()`
- Single event at the end (`_onDidChangeState.fire()`)

**Hierarchy recalc:**
- Called only when structure changes (parent/child added/removed)
- NOT on every tab change
- O(n) where n = number of parents

**Git status:**
- Queried once in `convertToBay()`
- NO continuous polling
- GitSyncService caches results internally
