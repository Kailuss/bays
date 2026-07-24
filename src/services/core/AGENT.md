# services/core/ - Bay Synchronization & State Management

## MODULE PURPOSE

This module is responsible for keeping the internal state of Bays synchronized with VS Code's native tabs.
It is the **bidirectional bridge** between the VS Code Tab API and the internal data model (Bay).
It manages the complete lifecycle of Bays: detection, conversion, update, hierarchical relationships, and cleanup.

**Exact responsibilities:**
- Listen to VS Code events (tabs, groups, cursor, diagnostics, file renames/deletes) and convert them into state changes
- Convert native tabs (`vscode.Tab`) to Bay objects with enriched metadata
- Maintain in-memory store of Bays and groups with change events
- Manage parent-variant relationships (diffs, snapshots, Markdown previews)
- Synchronize active state (one active bay per group, recomputed from native tabs) and clean up orphaned bays
- Generate deterministic Bay IDs from native tab data (no cache layer)

**It is NOT responsible for:**
- HTML rendering (see providers/)
- Executing Bay actions (see models/actions/)
- Integration with Git or Copilot (see services/integration/)
- Icon or theme management (see services/ui/)

---

## TECHNICAL INVARIANTS

1. **BayStateService is the only source of truth** - providers and commands consult State, never Tab API directly
2. **Generated ID is deterministic** - same inputs → same ID always. Three schemes: file/custom/notebook = `uri.toString() + '-' + viewColumn`; webview = `${bayType}:${sanitizedKey}-${viewColumn}` (key = `viewType || label`); diff/variant = `` `diff:${modifiedUri}::${originalUri}-${viewColumn}` ``. No cache is involved — see "ID Generation" below.
3. **Webview tabs do NOT have URI** - `bay.metadata.uri === undefined` for Settings/Extensions/custom webviews
4. **Markdown previews are modeled as variants, not filtered** - a `.md` preview tab (`viewType` includes `markdown.preview`) becomes a child bay of its source file (`diffType: 'preview'`, `metadata.sourceBayId` resolved by matching the preview label's filename suffix against open text tabs). It is NOT dropped and does NOT set any "preview owner" flag on the parent — `isPreviewOwner`/`PreviewService` do not exist in this codebase.
5. **Variants always have `sourceBayId`** - if `metadata.sourceBayId` exists, it's a variant bay (diff/snapshot/preview)
6. **Parent auto-open, not a synthetic placeholder** - if a variant's parent isn't open yet, `BayHeadService` opens the real file automatically (`workspace.openTextDocument` + `window.showTextDocument`); if that fails the variant is still added, rendered as an orphan row. Nothing sets `state.isLoading = true` in current code — `isLoading` exists on `BayState` but is always `false` from `convertToBay()`.
7. **Orphaned tabs are cleaned up inline on close** - `BayEventService.handleTabChanges()`'s `closed` loop removes the matching stored bay directly (`stateService.removeBay(id)`) when it isn't an intentional close. `ActiveStateService.removeOrphanedTabs()` also exists but currently has **no caller** — dead code, like `BayStateService.updateBaySilent()`.
8. **hasVariant/variantCount synchronized with reality** - `BayHierarchyService.recalculateAllCounts()` keeps them in sync with actual variants after a full sync
9. **Silent updates do NOT rebuild UI** - `notifyActiveChange()` fires `onDidChangeStateSilent` for active-only changes across all bays, avoiding a costly HTML rebuild. `updateBaySilent()` still exists on `BayStateService` but is unwired (no callers).
10. **Git/diagnostics updated lazily** - only when a tab changes state or a `onDidChangeDiagnostics`/rename event fires, not via continuous polling

---

## IMPLEMENTATION RULES

### Modular Architecture (bay/ subfolder)

```
BaySyncService (thin orchestrator)
  ├─ BayEventService (VS Code + filesystem event listeners)   [services/core/bay/]
  ├─ BayHeadService  (parent auto-open for variants)           [services/core/bay/]
  ├─ ActiveStateService (isActive sync + orphan cleanup)       [services/core/bay/]
  └─ also constructs / holds →
      ├─ BayHierarchyService (parent-variant relationships, cursor sync)
      ├─ GitSyncService (git status)
      └─ DocumentManager (document/version bookkeeping for diff stats)
```

`BayStateService` (the in-memory store) is constructed *outside* `BaySyncService` (in `extension.ts`) and injected via the constructor; `BaySyncService` injects `hierarchyService` and `documentManager` back into it (`setHierarchyService`/`setDocumentManager`) to avoid a circular import.

**Reason for separation:** `BaySyncService` was a ~900-LOC monolith → split into a thin orchestrator plus the three services above. This split is the CURRENT architecture — do not describe it as later "consolidated into one file"; it wasn't.

### Conversion Flow (Native Tab → Bay)

```typescript
vscode.Tab (input)
  ↓
extractTabInputData()      // switches on input instanceof TabInputText/TabInputTextDiff/
                            // TabInputWebview/TabInputCustom/TabInputNotebook
  ↓
classifyDiffType() / determineParentId() / determineParentUri()   // diffs & snapshots only
  ↓
new Bay(metadata, state)
  ├─ metadata: BayHelpers.enrichMetadata(baseMetadata)
  ├─ state: BayHelpers.createDefaultState() merged with native flags
  │         (isActive/isDirty/isPinned/isPreview read straight off VSTab)
  ├─ capabilities: BayHelpers.computeCapabilities(metadata, state)
  └─ gitStatus / diagnosticSeverity: gitService.getGitStatus(uri) / getDiagnosticSeverity(uri)
  ↓
Bay (output)
```

**Key point:** `convertToBay()` is a **pure function** of its inputs except for the git-status and diagnostics reads (both synchronous, cached inside their own services) — same tab → same Bay.

`tabConverter.ts` also exports `remapFileBayUri(oldBay, newUri, gitService)`, used by the rename/move sync path below: it mirrors the file branch of `convertToBay()` for a *new* URI while carrying over the old bay's native flags, without reading the native tab at all.

### ID Generation (deterministic, no cache)

There is **no `idCache`/`uriCache`** anywhere in this codebase — ids are recomputed on demand from the native tab every time, by `generateId()` / `generateVariantId()` / `generateIdFromNativeTab()` in `tabConverter.ts`:

```typescript
// File / custom / notebook (has uri)
id = uri.toString() + '-' + viewColumn

// Webview (no uri) — keyed off the STABLE viewType, falling back to label
const key = (viewType || label).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
id = `${tabType}:${key}-${viewColumn}`;
// Ex: "webview:mainthreadwebview-claudevscodepanel-1"

// Diff / variant (TabInputTextDiff, or a chat-editing-snapshot uri)
id = `diff:${modifiedUri.toString()}::${originalUriOrEmpty}-${viewColumn}`;
```

The webview scheme is keyed off `viewType`, not `label`, specifically because some panels (Claude Code's chat tab) rewrite their tab title at runtime — a label-derived id would drift on every title change and orphan the bay, breaking active-highlight/close sync.

The diff/variant scheme (`generateVariantId`) is fully reconstructable from a native tab alone (modified URI + original URI + viewColumn, all readable off `vscode.Tab`), so the open path (`convertToBay`) and the close/active-sync paths (`generateIdFromNativeTab`) always agree on the same id for a given tab — no cache needed to keep them in sync. A leftover module-level `diffIdCounter` only feeds the *unused* fallback branch of `generateId()` (timestamp+counter ids for a hypothetical uri-less-but-diff case that the current diff/snapshot paths never take, since they always go through `generateVariantId`).

### Diff Types Classification

Classification (`classifyDiffType()` in `helpers/tabClassifier.ts`) is primarily **label-text driven** (VS Code's own diff-tab titles are the strongest signal), with URI scheme as a fallback — not scheme/query lookups alone:

```typescript
// Ordered cascade over the lowercased tab label:
'working tree'                       → 'working-tree'
'staged' | 'index'                   → 'staged'
/[+]\d+[-]\d+/ (e.g. "+12-3")        → 'edit'                (Copilot/AI edit stats)
both URIs scheme === 'chat-editing-snapshot-text-model'
  and label doesn't include 'snapshot' → 'edit'
'snapshot' | 'timeline' | 'local history' | 'history:' → 'snapshot'
commit hash /\b[a-f0-9]{7,40}\b/i    → 'commit'
date/time pattern (YYYY-MM-DD, H:MM) → 'snapshot'

// Fallback when the label didn't match: inspect original/modified URI scheme+query
originalScheme === 'git' && query has 'ref=' or a hash → 'commit'
scheme is 'git' | 'timeline' | 'chat-editing-snapshot-text-model' | 'vscode-timeline*' → 'snapshot'

'merge conflict' | 'conflict'        → 'merge-conflict'
'incoming' (+'current')              → 'incoming-current' | 'incoming'
'current'                            → 'current'
'↔' | ' vs ' | 'compare'/'comparing' → 'unknown' if original/modified paths differ, else 'snapshot'
(nothing matched)                    → 'unknown'
```

`resolveSourceUri(uri)` normalizes a variant's own-scheme URI (`git:`, `timeline:`, `chat-editing-snapshot-text-model:`, `vscode-timeline*:`) to a plain `file://` URI by keeping only its `.path` — this is what `determineParentUri()`/`determineParentId()` use so the variant's `sourceBayId` points at the SAME id the real file bay gets, and so auto-opening a missing parent opens the real file instead of a phantom index/snapshot tab.

### Parent Auto-Open Flow (`BayHeadService`)

**Problem:** a variant tab (diff/snapshot) can appear before its source file tab (VS Code timing / user opened the diff directly).

**Flow (`ensureParentExists`, called from `BayEventService.handleTabChanges` before the variant is added):**
1. If a bay with `variant.metadata.sourceBayId` already exists in state → return it (nothing to do).
2. Else look for a **native tab** in the same group whose id already matches `sourceBayId` (`findTabForBayId`) → convert it (`buildParentBay`, rejecting an id mismatch) and `stateService.addBay(parentBay)`.
3. Else **open the real file automatically**: `vscode.workspace.openTextDocument(variant.metadata.sourceUri)` then `vscode.window.showTextDocument(doc, { viewColumn, preview: false, preserveFocus: true })`. `showTextDocument` synchronously drives `onDidChangeTabs`, so by the time it resolves the parent is usually already in state (checked directly); a `group.tabs` scan is the fallback.
4. If auto-open throws (remote/deleted file, permissions, …) → the variant is still added to state, just with no parent in state — the renderer draws it as an orphan row, never as a hidden/dropped bay.

Markdown-preview variants (`diffType === 'preview'`) skip `BayHeadService` entirely (they have no `uri`, so `ensureParentExists` would just discard them) — they resolve their `sourceBayId` synchronously in `convertToBay()`/`findPreviewSource()` instead, and render as an orphan if the source `.md` file isn't open.

### Active State Synchronization (`ActiveStateService`)

`syncActiveState()` recomputes `isActive` for every bay from native truth in one pass — no "preview owner"/hybrid logic:

```typescript
syncActiveState(): { hasChanges: boolean } {
  // 1. One winner per viewColumn, straight from VS Code
  const activeTabPerGroup = new Map<vscode.ViewColumn, string>(); // viewColumn -> bay id
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const id = generateIdFromNativeTab(tab);
      if (id && tab.isActive) { activeTabPerGroup.set(group.viewColumn, id); }
    }
  }
  // 2. Every stored bay's isActive = "am I the winner in my group?"
  let hasChanges = false;
  for (const bay of stateService.getAllBays()) {
    const shouldBeActive = activeTabPerGroup.get(bay.state.viewColumn) === bay.metadata.id;
    if (bay.state.isActive !== shouldBeActive) {
      bay.state.isActive = shouldBeActive;
      hasChanges = true;
    }
  }
  return { hasChanges };
}
```

**Called from:** `BayEventService` after `onDidChangeActiveTextEditor`, after `handleTabChanges` (whenever anything changed), and after non-structural `handleGroupChanges`; also from `BaySyncService.updateActiveTab()` and at the end of `syncAll()`. Every caller that only sees `hasChanges === true` (no structural change alongside it) fires `stateService.notifyActiveChange()` for a partial `updateActiveBay` update instead of a full rebuild.

### Orphaned Tabs Cleanup

**Definition:** bays that exist in `BayStateService` but no longer in VS Code.

**Where it actually happens today:** inline in `BayEventService.handleTabChanges()`'s `for (const bay of event.closed)` loop — for each closed native tab it recomputes the id (`generateIdFromNativeTab`), skips it if `stateService.isIntentionalClose(id)` (a program-driven close already being handled elsewhere), and otherwise calls `stateService.removeBay(id)` directly if a stored bay matches.

`ActiveStateService.removeOrphanedTabs()` (diff the full `nativeIds` set against `getAllBays()`) implements the same idea as a batch sweep, but **nothing currently calls it** — treat it as dead code, not the live cleanup path, when documenting or debugging.

**IMPORTANT:** `stateService.removeBay()` does NOT cascade-remove a parent's `preview`-type variants when the parent itself is removed (closing the `.md` doesn't close its preview tab in VS Code) — those are left in state and rendered as orphans.

### Event Handling (`BayEventService`)

**Registered listeners (`activate()`):**
```typescript
vscode.window.tabGroups.onDidChangeTabs         → handleTabChanges()        // async
vscode.workspace.onDidRenameFiles                → handleFilesRenamed()      // NEW, see below
vscode.workspace.onDidDeleteFiles                → handleFilesDeleted()      // NEW, see below
vscode.window.tabGroups.onDidChangeTabGroups     → handleGroupChanges()
vscode.window.onDidChangeActiveTextEditor        → syncActiveState() + notifyActiveChange()
vscode.window.onDidChangeTextEditorSelection     → hierarchyService.syncCursorPosition() (only if bays.syncCursorPosition is on — cached flag, re-read on config change)
```
Diagnostics (`vscode.languages.onDidChangeDiagnostics`) is registered directly by `BaySyncService.activate()`, not by `BayEventService`.

**`handleTabChanges(event)` pattern — distinguishes structural vs. patchable changes:**
```typescript
async handleTabChanges(event) {
  let hasChanges = false, structuralChange = false;
  const dirtyChangedBays = [], labelChangedBays = [];

  for (const tab of event.opened) {
    const bay = convertToBay(tab, gitSyncService);
    if (bay.metadata.sourceBayId && bay.metadata.diffType !== 'preview') {
      await bayHeadService.ensureParentExists(bay, tab);       // may auto-open the parent
    }
    stateService.addBay(bay);
    if (bay.metadata.sourceBayId) {
      hierarchyService.linkVariantToParentBay(bay.metadata.id, bay.metadata.sourceBayId);
    }
    hasChanges = structuralChange = true;
  }

  for (const tab of event.closed) {
    const id = generateIdFromNativeTab(tab);
    if (stateService.isIntentionalClose(id)) { continue; }     // already handled elsewhere
    if (stateService.getBayById(id)) {
      stateService.removeBay(id);
      hasChanges = structuralChange = true;
    }
  }

  for (const tab of event.changed) {
    const existing = stateService.getBayById(generateIdFromNativeTab(tab));
    if (!existing) { continue; }
    if (existing.state.isPreview !== tab.isPreview) { existing.state.isPreview = tab.isPreview; }        // silent, unrendered
    if (existing.state.isPinned  !== tab.isPinned)  { existing.state.isPinned = tab.isPinned; hasChanges = structuralChange = true; }
    if (existing.state.isDirty   !== tab.isDirty)   { existing.state.isDirty = tab.isDirty; hasChanges = true; dirtyChangedBays.push(existing); }
    if (existing.state.isActive  !== tab.isActive)  { hasChanges = true; }                                 // reconciled by syncActiveState below
    if (existing.metadata.bayType === 'webview'
        && existing.metadata.label !== tab.label
        && !ClaudeConversationService.isClaudeConversationBay(existing)) {
      existing.metadata.label = tab.label; hasChanges = true; labelChangedBays.push(existing);
    }
  }

  if (hasChanges) {
    const { hasChanges: activeChanges } = activeStateService.syncActiveState();
    if (structuralChange) {
      stateService.notifyChange();                                    // full rebuild
    } else {
      dirtyChangedBays.forEach(b => stateService.updateBayStateWithAnimation(b));  // per-bay postMessage
      labelChangedBays.forEach(b => stateService.notifyBayLabelChange(b.metadata.id));
      if (activeChanges) { stateService.notifyActiveChange(); }        // bulk postMessage
    }
  }
}
```
`isDirty`-only and label-only changes are patched via `postMessage` without a DOM rebuild; `isPinned` forces a full rebuild because pinning reorders the list. Active-state flips (`isActive`) are detected here too (needed because `onDidChangeActiveTextEditor` only fires for *text* editors — switching between two non-text tabs, e.g. Claude Code ↔ a Markdown preview, never reaches it otherwise) but are reconciled uniformly by the post-loop `syncActiveState()` call, not inline.

### File Rename / Move / Delete Sync (`BayEventService` + `tabConverter.remapFileBayUri`)

VS Code updates an open editor's URI in place on a rename/move, but `onDidChangeTabs` only reports it as a `changed` event whose *recomputed* id no longer matches the stored bay (the id embeds the URI) — left alone, the bay would keep a stale URI/label/path/git status forever. `BayEventService` listens to the filesystem events directly and rekeys deterministically instead of waiting for the tab event:

- **`workspace.onDidRenameFiles` → `handleFilesRenamed(event)`:** for each `{oldUri, newUri}`, finds every bay whose `metadata.uri` `isSameOrUnder(oldUri)` (same scheme+authority, path equal or nested under `oldUri.path + '/'`) — this covers both a single file rename and an entire folder move (descendant bays get their old-folder path prefix swapped for the new one, suffix preserved).
  - If **any** affected bay is a variant or a parent-with-variants (`bay.metadata.sourceBayId || bay.state.hasVariant`) → bail out to a full `resyncAll()` (variant links/diff URIs can't be safely patched in place).
  - Otherwise, each affected bay is rebuilt via `remapFileBayUri(bay, newUri, gitSyncService)` — deterministic: new id `${newUri}-${viewColumn}`, re-derived label/pathParts/tooltip/extension/languageId, fresh git status + diagnostics, carrying over native flags (isActive/isDirty/isPinned/isPreview) from the old bay's state. It never reads the native tab, so it doesn't depend on VS Code having already propagated the tab-model update.
  - `stateService.rekeyBay(oldId, freshBay)` swaps the map key **and** the bay's slot inside its group array (same index — preserves manual drag order), reassociates the document manager entry, and fires `onDidChangeState`. If the new id already exists (rename overwrote another open bay) → `rekeyBay` returns `false` → falls back to `resyncAll()`.
- **`workspace.onDidDeleteFiles` → `handleFilesDeleted(event)`:** for each deleted uri, purges top-level file bays under it (again via `isSameOrUnder`) that have **no live native tab** (`findNativeTabByUri`, checked against `TabInputText`/`TabInputCustom`/`TabInputNotebook`). Variants are skipped (`bay.metadata.sourceBayId` set) — they follow their parent's removal, not deletion directly — and a bay VS Code intentionally kept open (e.g. unsaved changes) is left alone.
- **`onDidChangeTabGroups` structural changes** (a split opened or closed) also fall back to `resyncAll()`: VS Code renumbers `viewColumn` on every remaining group, which invalidates every bay id in this codebase (they embed the column), so incremental patching isn't attempted.

### Full Sync (`syncAll`) & Structural Resync (`resyncAll`)

**`syncAll()`** (private, called from `activate()`):
1. `stateService.setGroups(vscode.window.tabGroups.all.map(createTabGroup))` — replaces the whole group map, which also *prunes* stale groups (old `addGroup`-only loops left ghost groups behind).
2. First pass over every native tab: parents/standalone bays go straight into `allBays`; anything with a `sourceBayId` is deferred into a `variants` array.
3. Second pass over `variants`, sequentially: `diffType === 'preview'` variants just look up their parent in `allBays` (no `BayHeadService` — they have no `uri`) and inherit state if found, else are pushed anyway as an orphan; everything else goes through `bayHeadService.ensureParentExistsForSync()` (same auto-open logic as the live path, searching the in-flight `allBays` array first).
4. `stateService.replaceBays(allBays)` — atomic (`_isBulkLoading` suppresses per-bay events, fires `onDidChangeState` once at the end).
5. `hierarchyService.recalculateAllCounts()`.

**`resyncAll()`** (public, used as the structural-fallback callback passed into `BayEventService`): serialized through a promise queue (`resyncInFlight`) so overlapping structural events don't run concurrently. `doResync()` snapshots the current manual drag order **per group, keyed by URI** (bay ids are unusable as the key since the viewColumn — part of the id — is exactly what's about to change), calls `syncAll()`, then re-sorts each new group's bays back into that captured order (unknown/new bays sort last) and fires one `notifyChange()`.

---

## KNOWN SPECIAL CASES

### 1. Variant Appears Before Parent

**Scenario:** user opens a diff (e.g. `git:` working-tree) before the base file is open anywhere.

**Flow:**
```
1. e.opened → TabInputTextDiff detected
2. convertToBay() → bay.metadata.sourceBayId = "file:///src/file.ts-1", sourceUri = file:///src/file.ts
3. bayHeadService.ensureParentExists(bay, tab):
   a. stateService.getBayById(sourceBayId) → undefined
   b. findTabForBayId(group, sourceBayId) → not found in this group either
   c. vscode.workspace.openTextDocument(sourceUri) + showTextDocument(viewColumn, preview:false, preserveFocus:true)
   d. onDidChangeTabs fires synchronously during the await → parent already in state when checked
4. stateService.addBay(variant)
5. hierarchyService.linkVariantToParentBay(variant.id, sourceBayId)
```

**UI result:** the real parent file opens (preserving focus on the diff) and appears immediately with the variant nested under it — there is no "Loading…" placeholder state in current code. If the auto-open fails (remote file, permission error, file deleted), the variant is added anyway and the renderer draws it as an orphan row with no parent.

### 2. Preview Tab Converted to Permanent

**Symptom:** a VS Code "preview" (italic) editor becomes a permanent tab after editing.

**Detection:** in `handleTabChanges`'s `changed` loop, `existing.state.isPreview !== tab.isPreview` → the flag is updated in place.

**Treatment:** this is intentionally silent — it does NOT set `hasChanges`/`structuralChange` and triggers no `postMessage` at all, because `isPreview` isn't rendered anywhere in the current UI. The bay's id is unaffected (it isn't derived from `isPreview`), so it's a pure no-op from the webview's perspective.

### 3. Markdown Preview Tabs Are Variants

There is no `PreviewService`/`isPreviewOwner` in this codebase. A Markdown preview tab (`TabInputWebview` whose `viewType` includes `markdown.preview`) is converted to its own Bay — a **variant** with `diffType: 'preview'` — exactly like a diff or snapshot:

```typescript
// convertToBay(), for tabType === 'webview' && viewType?.includes('markdown.preview')
diffType = 'preview';
const previewSource = findPreviewSource(VSTab);   // match by filename suffix of the label
parentId = previewSource?.id;                     // e.g. "file:///readme.md-1"
```

`findPreviewSource()` matches the preview's label ("Preview readme.md", "Vista previa readme.md", …) against open `.md`/`.mdx`/`.markdown` text tabs by checking the label ends with `' ' + fileName` — preferring a match in the preview's own group, falling back to a single unambiguous match across all groups. If no source matches, `sourceBayId` stays `undefined` and the preview renders as a top-level orphan bay rather than being dropped.

Preview variants bypass `BayHeadService` entirely (no `uri` to auto-open) and are exempted from `removeBay()`'s cascade-delete-children behavior — closing the source `.md` does not close the live preview tab in VS Code, so the preview bay is deliberately left in state (rendered as an orphan) rather than removed alongside its parent.

### 4. Same File in Multiple Groups

**Scenario:** `file.ts` open in groups 1 and 2.

**Generated IDs:**
```
Group 1: "file:///c:/src/file.ts-1"
Group 2: "file:///c:/src/file.ts-2"
```

**Independent Bays:** different `groupId`/`viewColumn`; can have different `isDirty`, `isPinned`, `cursorLine`. Git status and diagnostics are per-URI, not per-group — `BaySyncService.updateTabDiagnostics()` and rename/delete handling use `stateService.findBaysByUri(uri)` (plural) specifically so every group's copy gets refreshed together, not just the first match.

**No collision** — the id includes `viewColumn`.

### 5. Diff/Variant IDs Are Fully Deterministic (No Cache)

There is no query-param-collapsing cache in this codebase (see "ID Generation" above). `generateVariantId(modifiedUri, originalUri, viewColumn)` embeds the *full* `modifiedUri.toString()` — including any query string VS Code attaches (e.g. a git ref) — directly into the id. This works because `vscode.Tab.input` doesn't mutate while a tab stays open: the same open diff tab always yields the same `modifiedUri.toString()` on every recomputation (`convertToBay` on open, `generateIdFromNativeTab` on close/active-sync), so the id is stable for that tab's lifetime without needing to remember anything across calls. A brand-new diff tab (even of the same file) simply gets its own id from its own concrete URI — there is no attempt to collapse "the same logical diff" across separate tab instances.

### 6. Webview Tab (Settings/Extensions/Claude Code)

**Characteristics:**
```typescript
input: TabInputWebview
  viewType: "settings" | "workbench.extension.config" | "mainThreadWebview-claudeVSCodePanel" | ...
  uri: undefined  // no URI
```

**Conversion (`extractTabInputData`):** `bayType: 'webview'`, `uri: undefined`, `viewType: input.viewType`, `fileType: ''`.

**Generated ID:** `` `webview:${sanitizedViewTypeOrLabel}-${viewColumn}` `` — keyed off `viewType` (falls back to `label` only if `viewType` is empty), specifically so a runtime label rewrite (Claude Code shows the current session name) doesn't change the id and orphan the bay.

**Restricted capabilities** (`BayCapabilities` has exactly 5 fields total): a uri-less webview bay computes `canPin: false`, `canRevealInExplorer: false`, `canHaveChildren: false`; `canClose`/`canTogglePreview` still apply normally. There is no `canSplit`/`canReveal` field on `BayCapabilities` — other action gating (split, reveal, etc.) is computed on demand from `metadata.uri` presence in `models/actions/*`, not stored as a capability flag.

### 7. Cursor Position Tracking

**Listener (only active when `bays.syncCursorPosition` is enabled — default `false`, flag cached and refreshed only on config change to keep the hot path cheap):**
```typescript
vscode.window.onDidChangeTextEditorSelection(e => {
  if (!syncCursorEnabled) { return; }
  const bay = stateService.findBayByUri(e.textEditor.document.uri);
  if (!bay || !e.selections[0]) { return; }
  const { line, character } = e.selections[0].active;
  hierarchyService.syncCursorPosition(bay.metadata.id, line + 1, character + 1);  // 1-indexed
});
```
`syncCursorPosition()` (in `BayCursorSyncUtils.ts`) mutates `cursorLine`/`cursorColumn` on the changed bay and on its whole parent+variants family, and nudges the actual editor cursor of any other open sibling editors (`updateEditorCursor`) — it does NOT fire any state-change event. Cursor position is backend bookkeeping only; nothing in the current renderer reads it into the DOM, so no `postMessage`/rebuild is triggered by a cursor move.

### 8. Diagnostics Sync

**Listener** (registered by `BaySyncService.activate()`, not `BayEventService`):
```typescript
vscode.languages.onDidChangeDiagnostics(e => {
  for (const uri of e.uris) { this.updateTabDiagnostics(uri); }
});
```
```typescript
private updateTabDiagnostics(uri: vscode.Uri): void {
  const bays = this.stateService.findBaysByUri(uri);   // ALL groups sharing this file
  const newSeverity = getDiagnosticSeverity(uri);
  const newGitStatus = this.gitSyncService.getGitStatus(uri);
  for (const bay of bays) {
    if (bay.state.diagnosticSeverity !== newSeverity || bay.state.gitStatus !== newGitStatus) {
      bay.state.diagnosticSeverity = newSeverity;
      bay.state.gitStatus = newGitStatus;
      this.stateService.updateBayStateWithAnimation(bay);   // fires onDidChangeBayState only
    }
  }
}
```
`updateBayStateWithAnimation()` fires `onDidChangeBayState(bayId)` → `provider.notifyBayStateChanged()` posts `{type:'bayStateChanged', bayId, stateClass, stateHtml}` — a single-bay `postMessage` patch, never a full rebuild.

### 9. Claude Code Chat Tabs Are Excluded From Generic Label Refresh

The generic webview-label-changed branch in `handleTabChanges` (`existing.metadata.bayType === 'webview' && existing.metadata.label !== tab.label`) explicitly adds `&& !ClaudeConversationService.isClaudeConversationBay(existing)`. VS Code only ever exposes Claude Code's *truncated* tab label (`aiTitle.slice(0, 24) + "…"`); `ClaudeConversationService` separately reads the full, untruncated title straight from Claude's own JSONL transcripts and calls `stateService.notifyBayLabelChange()` itself. Without this exclusion, the generic path would immediately overwrite that full title with VS Code's 24-character truncation on the very next tab-changed event — the two label sources would fight indefinitely. See `src/services/integration/ClaudeConversationService.ts`.

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
  1. extractTabInputData() → { uri, label: "extension.ts", tabType: 'file' }
  2. convertToBay() → Bay
     metadata.id: "file:///c:/src/extension.ts-1"
     metadata.sourceBayId: undefined
     state.groupId / viewColumn: 1
     state.isActive: true
  3. stateService.addBay(bay)     → fires onDidChangeState
  4. handleTabChanges: hasChanges = structuralChange = true → stateService.notifyChange()

Result:
  Bay created, provider.refresh() rebuilds the webview HTML, new row renders.
```

### Example 2: Variant Opened (Working Tree Diff)

```yaml
Input (vscode.Tab):
  input: TabInputTextDiff
    original: "file:///c:/src/file.ts"
    modified: "git:///c:/src/file.ts?ref=~"
  label: "file.ts (Working Tree)"
  group.viewColumn: 1

Processing:
  1. classifyDiffType("file.ts (Working Tree)", ...) → label includes "working tree" → 'working-tree'
  2. resolveSourceUri(modifiedUri) → "file:///c:/src/file.ts" (git: scheme stripped)
  3. determineParentId() → sourceBayId = "file:///c:/src/file.ts-1"
  4. id = generateVariantId(modifiedUri, originalUri, 1)
       = "diff:git:///c:/src/file.ts?ref=~::file:///c:/src/file.ts-1"
  5. bayHeadService.ensureParentExists(): parent not in state, not in group.tabs
     → openTextDocument(file:///c:/src/file.ts) + showTextDocument(preserveFocus:true)
     → parent bay appears in state via the nested onDidChangeTabs event
  6. stateService.addBay(variant)
  7. hierarchyService.linkVariantToParentBay(variant.id, parentId)
       → parent.state.hasVariant = true, parent.state.variantCount = 1

Result:
  UI shows:
    file.ts
      └─ Working Tree (+0/-0)
```

### Example 3: Tab Changed (Only isDirty — patched, no rebuild)

```yaml
Input (TabChangeEvent):
  changed: [tab]
  tab.isDirty: true (was false); isPinned/isActive unchanged

Processing:
  existing = stateService.getBayById(generateIdFromNativeTab(tab))
  existing.state.isDirty = true
  hasChanges = true; structuralChange stays false; dirtyChangedBays = [existing]

  // post-loop
  activeStateService.syncActiveState()      // no-op here, isActive unchanged
  stateService.updateBayStateWithAnimation(existing)   // fires onDidChangeBayState, NOT onDidChangeState

Result:
  provider.notifyBayStateChanged(bayId) posts
    { type: 'bayStateChanged', bayId, stateClass, stateHtml }
  webview.js swaps the `.bay-state` node in place — no HTML rebuild.
```
(An active-only change follows the same "no structural change" branch but ends in `stateService.notifyActiveChange()` instead, which posts `{ type: 'updateActiveBay', activeBayIds }` — a bulk list of every currently-active bay id, not a single-bay message.)

### Example 4: Orphaned Tab Cleanup (inline, on close)

```yaml
State Before:
  bays: [ Bay("file:///a.ts-1"), Bay("file:///b.ts-1") ]

VS Code closes b.ts → event.closed = [Tab(uri: "file:///b.ts")]

Processing (inside handleTabChanges, NOT ActiveStateService.removeOrphanedTabs — that method has no caller):
  id = generateIdFromNativeTab(tab)              // "file:///b.ts-1"
  stateService.isIntentionalClose(id)            // false (user closed it directly in the tab bar)
  stateService.getBayById(id)                    // found
  stateService.removeBay(id)                     // removes it, fires onDidChangeState
  hasChanges = structuralChange = true → notifyChange()

State After:
  bays: [ Bay("file:///a.ts-1") ]
```

### Example 5: Markdown Preview Opened as Variant

```yaml
VS Code State:
  group.tabs: [
    Tab(uri: "file:///readme.md", isActive: false),
    Tab(viewType: "mainThreadWebview-markdown.preview", label: "Preview readme.md", isActive: true)
  ]

Processing (convertToBay, for the preview tab):
  tabType === 'webview' && viewType.includes('markdown.preview')
  diffType = 'preview'
  previewSource = findPreviewSource(tab)
    → label "Preview readme.md" ends with " readme.md"
    → matches Tab(uri: "file:///readme.md") in the same group
    → { id: "file:///readme.md-1", uri: "file:///readme.md" }
  sourceBayId = "file:///readme.md-1"
  id = `webview:mainthreadwebview-markdown-preview-1`   // NOT parent-derived — its own webview id

  hierarchyService.linkVariantToParentBay(previewBay.id, sourceBayId)
    → readme.md bay: state.hasVariant = true, state.variantCount = 1

UI Result:
  readme.md
    └─ Preview readme.md
  (No `isPreviewOwner`/"active" trick on the source row — plain variant nesting,
   same as a diff. If readme.md is later closed, the preview bay is NOT
   cascade-removed and is rendered as an orphan.)
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
  bays: [
    Bay(id: "file:///app.tsx-1", groupId: 1, isDirty: true),
    Bay(id: "file:///app.tsx-2", groupId: 2, isDirty: false)
  ]

Independent State:
  - Group 1 can be dirty, Group 2 clean
  - Different cursor position in each group (if bays.syncCursorPosition is on, only within its own family)
  - Independent pin state
  - Git status / diagnostics SHARED (findBaysByUri(uri) updates both together)
```

---

## DEBUGGING TIPS

**Logger patterns in services/core:**
```typescript
// BayEventService
Logger.log('[BayEvent] Parent confirmed for variant: ...');
Logger.warn('[BayEvent] Failed to ensure parent exists for variant: ... (rendered as orphan)');
Logger.log('[BayEvent] Rekeyed bay after rename: ...');
Logger.log('[BayEvent] Rename touches a variant/parent — full resync');
Logger.log('[BayEvent] Removing bay for deleted file: ...');

// BaySyncService
Logger.log('[BaySync] Starting full syncAll');
Logger.log('[BaySync] Structural group change → full resync');

// ActiveStateService
Logger.log('[ActiveState] Synchronized active state across all tabs');
Logger.log('[ActiveState] Removing orphaned bay: ...');   // only if something ever calls removeOrphanedTabs()

// BayHierarchyService
Logger.log('[BayHierarchy] Registered child: ... → ... (count: N)');
Logger.log('[BayHierarchy] Recalculated counts for N parents');

// tabConverter
Logger.warn('[TabConverter] Unknown scheme detected: ...');
```

**Check parent-variant consistency:**
```typescript
const parents = stateService.getAllBays().filter(b => b.state.hasVariant);
Logger.log(`[Debug] Parents with variants: ${JSON.stringify(
  parents.map(p => ({
    label: p.metadata.label,
    variantCount: p.state.variantCount,
    actualVariants: hierarchyService.fetchVariants(p.metadata.id).length,
  }))
)}`);
```

**Check for id drift after a rename:** if a renamed file's bay stops updating git/diagnostics, confirm `handleFilesRenamed` actually rekeyed it — `rekeyBay()` logs `[BayState] Rekeyed bay ${oldId} → ${newId}` on success, or `BayEventService` logs a fallback-to-resync warning on an id collision.

---

## RESPONSIBILITY LIMITS

**This module MUST NOT:**
- Generate HTML or CSS (providers/)
- Execute VS Code commands as user (commands/)
- Manage icons or themes (services/ui/)
- Integrate with external APIs (services/integration/) — including reading Claude's own transcripts, which belongs to `ClaudeConversationService`
- Render UI or handle webview events (providers/)

**This module MUST:**
- Convert native tabs to Bays with complete metadata
- Keep state consistent with VS Code at all times (tabs, groups, renames, deletes)
- Manage Bays lifecycle (create, update, delete, rekey)
- Provide change events for UI to react to (`onDidChangeState`, `onDidChangeStateSilent`, `onDidChangeBayState`, `onDidChangeBayLabel`)
- Guarantee unique and deterministic IDs
- Clean up inconsistencies (orphans on close, stale groups on resync)
- Synchronize derived states (active, hierarchy counts, diagnostics/git)

---

## PERFORMANCE CONSIDERATIONS

**No id/uri caching layer:** ids are cheap to recompute from a native tab (string concatenation over already-available fields), so there is nothing to cache and nothing to invalidate — see "ID Generation" above.

**Debouncing:**
- Not implemented in `services/core` itself (VS Code already coalesces rapid tab events).
- UI-side debounce lives in `providers/BaysWebviewProvider.refresh()`: **30ms** (`TIMINGS.WEBVIEW_REFRESH_DEBOUNCE`).

**Partial updates over full rebuilds:**
- `notifyActiveChange()` → one bulk `updateActiveBay` postMessage for every active-flag flip, no matter how many groups changed.
- `updateBayStateWithAnimation()` → one `bayStateChanged` postMessage per affected bay (dirty/diagnostics/git), never a rebuild.
- `notifyBayLabelChange()` → one `updateBayLabel` postMessage per renamed webview label.
- `updateBaySilent()` remains on `BayStateService` but is dead code — do not treat it as the live silent-update path.

**Bulk loading:**
- `replaceBays()` sets `_isBulkLoading = true`, calls `addBay()` per bay (each one would normally fire `onDidChangeState`) with events suppressed, then fires a single event at the end.
- `resyncAll()` additionally preserves per-group manual drag order across the rebuild by snapshotting it (keyed by URI) before `syncAll()` and re-sorting after.

**Hierarchy recalc:**
- `recalculateAllCounts()` runs only after a full sync, O(n) over stored bays.
- Per-event linking (`linkVariantToParentBay`/`detachVariantFromParentBay`) is O(1) and runs only when a variant is actually opened/closed, not on every tab change.

**Git status:**
- Read synchronously once per `convertToBay()`/`remapFileBayUri()` call and again on diagnostics/rename events — `GitSyncService` caches results internally, so this module never re-runs git plumbing itself.
