# models/ - Bay Model & Actions Module

## MODULE PURPOSE

This module defines the central **data model** of the extension (Bay) and all **actions** that can be performed on it.
It implements a composition pattern where the Bay class delegates operations to pure functions organized by category.
It is the contract between the internal state and the operations that commands/UI can invoke.

**Exact responsibilities:**
- Define data structures (BayMetadata, BayState, BayCapabilities)
- Provide Bay class with methods delegated to pure actions
- Implement actions as pure functions (close, pin, reveal, copy, file)
- Compute enriched metadata (fileName, category, scheme, etc.)
- Calculate capabilities based on metadata and state
- Interact with VS Code Tab API (findNativeTab, activateByNativeTab)

**It is NOT responsible for:**
- Synchronization with VS Code Tab API (see services/core/)
- HTML or UI rendering (see providers/)
- Icon or theme management (see services/ui/)
- Git status or diagnostics (see services/integration/)
- Handling VS Code events (see services/core/bay/BayEventService)

---

## TECHNICAL INVARIANTS

1. **BayMetadata is immutable** - Computed once when creating Bay, never modified afterwards
2. **BayState is mutable** - Fields can change during the Bay's lifecycle
3. **Actions are pure functions** - Receive `(metadata, state)`, can mutate state, no hidden side effects
4. **activateFn is injected** - To avoid circular dependencies (pin/unpin need to activate first)
5. **Capabilities have only 5 fields** - Other capabilities are computed on-demand in actions
6. **URI can be undefined** - Webview tabs do NOT have URI, always check before using
7. **Helpers are pure functions** - Do not access global services, receive everything as parameters
8. **findNativeTab can return undefined** - Tab can close between operations (race condition)
9. **Activation has retry logic** - Preview tabs can fail on first attempt (timing issue)
10. **CustomActions are extensible** - Users can add actions dynamically

---

## IMPLEMENTATION RULES

### Composition Architecture

```
Bay (class)
  ├─ metadata: BayMetadata (immutable)
  ├─ state: BayState (mutable)
  └─ extends BayActions (delegation)
      └─ delegates to actions/ (pure functions)
          ├─ closeActions.ts
          ├─ pinActions.ts
          ├─ revealActions.ts
          ├─ copyActions.ts
          ├─ fileActions.ts
          ├─ activationActions.ts
          ├─ customActions.ts
          └─ stateActions.ts

BayHelpers.ts (single static-method class, ~280 LOC — pure utilities used by actions/)
  ├─ native tab lookup/matching: findNativeTab(), nativeGroup(), matchesNative(),
  │  activateByNativeTab(), focusGroup(), moveActiveEditorToGroup()
  ├─ enrichMetadata() + categorizeFile()/categorizeNonFileTab() (enrichment)
  ├─ computeCapabilities() / createDefaultState() / createEmptyCapabilities()
  ├─ isMarkdownPreview() / isPreviewableFile()
  └─ mapPreviewModeToViewMode() / mapViewModeToPreviewMode()

services/core/helpers/ (native-tab → Bay conversion — NOT in models/)
  ├─ tabConverter.ts  — convertToBay(), remapFileBayUri(), generateId(), generateVariantId(),
  │                     generateIdFromNativeTab(), getDiagnosticSeverity(), findPreviewSource()
  └─ tabClassifier.ts — classifyDiffType(), resolveSourceUri(), determineParentUri(), determineParentId()
```

**Reason for the pattern:**
- **Composition over inheritance** - BayActions is abstract, Bay implements
- **Testable pure functions** - Each action can be tested in isolation
- **Separation of concerns** - `models/` owns the data contract and per-bay actions;
  raw-tab classification/conversion lives in `services/core/helpers/` since it needs
  `GitSyncService` and other core-service collaborators
- **Modularity** - Adding a new action = new file in actions/

### Action Pattern (Template)

```typescript
// actions/myActions.ts
import * as vscode from 'vscode';
import type { BayMetadata, BayState } from '../Bay';
import { BayHelpers } from '../BayHelpers';

/**
 * Documentation comment explaining what this action does.
 */
export async function myAction(
  metadata: BayMetadata,
  state: BayState,
  /* optional dependencies */
): Promise<void> {
  // 1. Guard: Check if action is possible
  if (!metadata.uri) {
    vscode.window.showWarningMessage('This action requires a file');
    return;
  }
  
  // 2. Find native tab if needed
  const nativeTab = BayHelpers.findNativeTab(metadata, state);
  if (!nativeTab) {
    throw new Error('Tab not found');
  }
  
  // 3. Execute VS Code command or API
  await vscode.commands.executeCommand('command.id', ...args);
  
  // 4. Update state if needed (mutation is OK)
  state.someField = newValue;
}
```

**Template for BayActions:**
```typescript
// BayActions.ts
async myAction(): Promise<void> {
  return actions.myAction(this.metadata, this.state, /* deps */);
}
```

### Dependency Injection Pattern (activateFn)

**Problem:** `pin()` needs to activate tab first, but `activate()` is in the same class.

**Solution:**
```typescript
// pinActions.ts
export async function pin(
  metadata: BayMetadata,
  state: BayState,
  activateFn: () => Promise<void>  // ⬅️ Injected
): Promise<void> {
  await activateFn();  // Call injected function
  await vscode.commands.executeCommand('workbench.action.pinEditor');
  state.isPinned = true;
}

// BayActions.ts
async pin(): Promise<void> {
  return actions.pin(
    this.metadata, 
    this.state, 
    () => this.activate()  // ⬅️ Inject this.activate
  );
}
```

**Alternatives used:**
- `closeFn: () => Promise<void>` (moveToGroup only — closes the file bay before reopening it in the target group; webview bays skip this branch entirely since they have no URI to reopen)
- `activateFn: () => Promise<void>` (pin, unpin, openTimeline, closeOthers)

### Helpers: `BayHelpers.ts` (models/) + `tabConverter`/`tabClassifier` (services/core/helpers/)

There is no `helpers/` subfolder under `models/` — everything that used to be split across
`nativeTabHelper.ts` / `metadataEnricher.ts` / `capabilitiesComputer.ts` now lives in a single
static-method class, **`src/models/BayHelpers.ts`** (~280 LOC):

- **Native Tab API:** `findNativeTab()`, `nativeGroup()`, `matchesNative()`, `activateByNativeTab()`,
  `focusGroup()`, `moveActiveEditorToGroup()`, `isMarkdownPreview()`, `isPreviewableFile()`
- **Enrichment:** `enrichMetadata()` (adds `fileName`/`baseName`/`dirPath`/`scheme`/`isRemote`/
  `isUntitled`/`isBinary`/`category`), private `categorizeFile()`, private `categorizeNonFileTab()`
- **Capabilities & default state:** `computeCapabilities()`, `createDefaultState()`, private
  `createEmptyCapabilities()`
- **View mode mapping:** `mapPreviewModeToViewMode()`, `mapViewModeToPreviewMode()`

Converting a *native* `vscode.Tab` into a `Bay` is explicitly **not** a `models/` responsibility —
that lives in **`src/services/core/helpers/tabConverter.ts`** (`convertToBay()`,
`remapFileBayUri()`, `generateId()`, `generateVariantId()`, `generateIdFromNativeTab()`,
`getDiagnosticSeverity()`, `findPreviewSource()`) and **`tabClassifier.ts`** (`classifyDiffType()`,
`resolveSourceUri()`, `determineParentUri()`, `determineParentId()`), because that step needs
`GitSyncService` and other `services/core/` collaborators that `models/` must not depend on.
`tabConverter.ts` calls into `BayHelpers.enrichMetadata()` / `BayHelpers.computeCapabilities()` /
`BayHelpers.createDefaultState()` to finish building the `Bay`.

### Metadata Enrichment Flow

```typescript
// services/core/helpers/tabConverter.ts (initial conversion — has git/diagnostics access)
const baseMetadata: BayMetadata = {
  id: generateId(label, uri, viewColumn, tabType, !!parentId, viewType),
  sourceBayId: parentId,   // set for diff/snapshot/preview variants
  uri,
  bayType: 'file',
  fileExtension: fileType,
  // ... basic fields extracted from the vscode.Tab
};

// models/BayHelpers.ts (enrichment — pure, no VS Code services)
const enriched = BayHelpers.enrichMetadata(baseMetadata);
// Adds:
//   fileName, baseName, dirPath, scheme, isRemote, isUntitled,
//   category, isBinary, etc.

const capabilities = BayHelpers.computeCapabilities(enriched, stateWithDefaults);

// Final result: complete metadata + capabilities for `new Bay(metadata, state)`
```

### Capabilities Computation

**Available fields (only 5):**
```typescript
type BayCapabilities = {
  canClose: boolean;         // Always true
  canPin: boolean;           // True unless already pinned or is a diff/variant (sourceBayId set) — no URI check, webviews CAN be pinned
  canRevealInExplorer: boolean;  // Has a URI and scheme === 'file'
  canTogglePreview: boolean;     // If .md/.svg/.html/.htm with URI
  canHaveChildren: boolean;      // If bayType === 'file' with URI
};
```

**Capabilities on-demand (computed in actions):**
```typescript
// In pinActions.ts
export async function unpin(...) {
  // Capability on-demand: can unpin if currently pinned
  if (!state.isPinned) {
    vscode.window.showWarningMessage('This tab is not pinned');
    return;
  }
  // ...
}
```

**Reason:** Avoid storing redundant capabilities that change with state.

### Activation Strategies (activationActions.ts)

**2 strategies, branched on `bayType`/`sourceBayId` (not 3 — there is no BayType `'unknown'`,
and there is no markdown-viewMode branch inside `activate()`):**

**1. Webview bays, and any variant (diff/snapshot/preview — `metadata.sourceBayId` set):**
```typescript
// ALWAYS use BayHelpers.activateByNativeTab()
if (metadata.bayType === 'webview' || metadata.sourceBayId) {
  return await BayHelpers.activateByNativeTab(metadata, state);
}

// Internally:
// 1. Focus group
// 2. workbench.action.openEditorAtIndex(tabIndex)
// 3. Fallback: keyword match against BayHelpers.WEBVIEW_COMMANDS (settings, keyboard
//    shortcuts, welcome, release notes, interactive playground)
```

**2. URI-based (file, custom, notebook — anything else with a `metadata.uri`):**
```typescript
const nativeTab = BayHelpers.findNativeTab(metadata, state);

// Preference: activate by index if a matching native tab exists — even for plain
// files, this is used ahead of showTextDocument (more reliable, esp. with preview tabs)
if (nativeTab && nativeTab.input instanceof vscode.TabInputText &&
    nativeTab.input.uri.toString() === metadata.uri.toString()) {
  return await BayHelpers.activateByNativeTab(metadata, state);
}

// Fallback: showTextDocument() — bay was closed or replaced
const doc = await vscode.workspace.openTextDocument(metadata.uri);
await vscode.window.showTextDocument(doc, { viewColumn: state.viewColumn, preview: false });
```

**Markdown preview is not a mode switch inside `activate()`.** The rendered preview is a real
*variant* bay (own row, own native tab, own `activate()` call via strategy 1 above) — see
"Markdown Preview" under Known Special Cases.

**Retry logic:**
```typescript
// Preview tabs can fail due to timing (race condition)
async function activateWithRetry(metadata, state, attempt) {
  try {
    // ... try activation
  } catch (err) {
    if (attempt < TIMINGS.ACTIVATION_MAX_RETRIES) {
      await delay(TIMINGS.ACTIVATION_RETRY_DELAY);
      return activateWithRetry(metadata, state, attempt + 1);
    }
    // Last resort: vscode.open
    await vscode.commands.executeCommand('vscode.open', uri, { viewColumn });
  }
}
```

### Native Tab Matching (`BayHelpers.matchesNative` / `BayHelpers.findNativeTab`)

**Problem:** We need to find the VS Code native tab that corresponds to a Bay.

**Strategies by type (actual logic — order matters):**
```typescript
static matchesNative(t: vscode.Tab, metadata: BayMetadata): boolean {
  if (t.input instanceof vscode.TabInputWebview) {
    // Prefer the STABLE viewType — some webview panels (e.g. Claude Code) rewrite
    // their title at runtime, so a label-only match would go stale.
    if (metadata.viewType && t.input.viewType === metadata.viewType) { return true; }
    return t.label === metadata.label;
  }
  if (!t.input) {
    return metadata.bayType === 'webview' && !metadata.uri && t.label === metadata.label;
  }
  if (t.input instanceof vscode.TabInputTextDiff) {
    // Match on modified URI AND original URI so two diffs of the same file
    // (e.g. working-tree vs a Copilot edit) don't resolve to each other.
    if (!metadata.sourceBayId || metadata.uri?.toString() !== t.input.modified.toString()) { return false; }
    return metadata.originalUri ? metadata.originalUri.toString() === t.input.original.toString() : true;
  }
  // A variant can't resolve to its parent's plain-text tab (the diff's modified
  // URI IS the file) — EXCEPT chat-editing-snapshot variants, whose own native
  // tab is TabInputText with a distinct scheme, so the URI comparison below is
  // already unambiguous.
  if (metadata.sourceBayId && metadata.uri?.scheme !== 'chat-editing-snapshot-text-model') {
    return false;
  }
  const uri = metadata.uri;
  if (!uri) { return false; }
  if (t.input instanceof vscode.TabInputText)     { return t.input.uri.toString() === uri.toString(); }
  if (t.input instanceof vscode.TabInputCustom)   { return t.input.uri.toString() === uri.toString(); }
  if (t.input instanceof vscode.TabInputNotebook) { return t.input.uri.toString() === uri.toString(); }
  return false;
}
```

**Search:**
```typescript
static findNativeTab(metadata: BayMetadata, state: BayState): vscode.Tab | undefined {
  const group = BayHelpers.nativeGroup(state.viewColumn);
  return group?.tabs.find(t => BayHelpers.matchesNative(t, metadata));
}
```

### CustomActions (Extensibility)

**Definition:**
```typescript
// models/Bay.ts — no isEnabled predicate; gating goes through BayPermissions instead
type CustomBayAction = {
  id: string;
  label: string;
  icon: string;
  tooltip: string;
  keybinding?: string;
  execute: (metadata: BayMetadata, state: BayState) => Promise<void>;
};
```

**Usage:**
```typescript
// Add custom action (addCustomAction dedupes by id — re-adding the same id replaces it)
bay.addCustomAction({
  id: 'openInBrowser',
  label: 'Open in Browser',
  icon: 'globe',
  tooltip: 'Open file in default browser',
  execute: async (metadata, state) => {
    if (!metadata.uri) return;
    await vscode.env.openExternal(metadata.uri);
  },
});

// Execute action — blocked only if state.permissions.restrictedActions includes the id
// (isActionRestricted(), from stateActions.ts); wraps execute() in start/finishOperation()
await bay.executeCustomAction('openInBrowser');
```

---

## KNOWN SPECIAL CASES

### 1. Webview Tabs (No URI)

**Characteristics:**
```typescript
metadata: {
  bayType: 'webview',
  viewType: 'settings' | 'workbench.extension.config' | ...,
  uri: undefined,  // ⚠️ NO URI
  label: 'Settings',
}

capabilities: {
  canPin: true,                // computeCapabilities doesn't check URI for canPin — true
                                // as long as not already pinned and not a diff/variant
  canRevealInExplorer: false, // No file
  canTogglePreview: false,    // No content file
  canHaveChildren: false,     // Not file-based
}
```

**Activation:**
```typescript
// ALWAYS by native index or specific command (BayHelpers.WEBVIEW_COMMANDS)
const WEBVIEW_COMMANDS = {
  'settings': 'workbench.action.openSettings',
  'keyboard shortcuts': 'workbench.action.openGlobalKeybindings',
  'welcome': 'workbench.action.showWelcomePage',
  'release notes': 'update.showCurrentReleaseNotes',
  'interactive playground': 'workbench.action.showInteractivePlayground',
};

// 1. Try by index
await focusGroup(viewColumn);
await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', tabIndex);

// 2. Fallback: specific command
const cmd = WEBVIEW_COMMANDS[label.toLowerCase()];
if (cmd) await vscode.commands.executeCommand(cmd);
```

### 2. Preview Tab Activation Race Condition

**Problem:** Preview tabs can become permanent during activation.

**Symptom:**
```typescript
// T0: Bay with isPreview: true, nativeTab exists
const nativeTab = findNativeTab(metadata, state);  // ✓ found

// T1: User edits preview → VS Code converts to permanent
// T2: Activation attempt
await activateByNativeTab(metadata, state);  // ✗ tab.isPreview changed
```

**Solution (retry logic):**
```typescript
catch (err) {
  if (attempt < MAX_RETRIES) {
    await delay(RETRY_DELAY);  // 50ms
    return activateWithRetry(metadata, state, attempt + 1);
  }
  // Last resort: vscode.open
}
```

### 3. Tab Closed During Action Execution

**Scenario:** User closes tab while action is executing.

**Detection:**
```typescript
const nativeTab = findNativeTab(metadata, state);
if (!nativeTab) {
  Logger.warn('[Action] Tab not found: ' + metadata.label);
  throw new Error('Tab no longer exists');
}
```

**Handling in commands:**
```typescript
try {
  await bay.activate();
} catch (err) {
  if (err.message.includes('not found') || err.message.includes('no longer exists')) {
    // Tab closed, refresh UI
    webviewProvider.refresh();
  }
}
```

### 4. Markdown Preview

**There is no `PreviewService` and no source↔preview toggle command.** The rendered preview is
a real *variant* bay (`diffType: 'preview'`, `metadata.sourceBayId` pointing at the `.md` bay),
rendered as an indented row under its parent — exactly like a diff/snapshot variant. `bay.state.viewMode`
(`'source' | 'preview' | 'split'`) still exists on `BayState` but `activate()` never branches on it;
each row (source file, preview variant) is just activated independently via its own native tab.

**Creating the preview** goes through the file-action button system (`FileActionRegistry`), not a
dedicated preview action on `Bay`. `src/constants/fileQuickActions/quickActions/markdown.ts`
registers a `.md`/`.mdx`/`.markdown` quick action (`actionId: 'openMarkdownPreview'`) whose
`execute` just runs `vscode.commands.executeCommand('markdown.showPreview', uri)` — VS Code opens
a real preview webview tab, and the normal tab→Bay conversion in `tabConverter.ts` picks it up as
a `'preview'`-typed variant on the next sync. `BaysHtmlBuilder` hides the "Open Preview" button
once the parent bay already `hasVariant` with a preview, so there's no toggle-back button; closing
the preview's native tab closes the variant row like any other bay.

**Variant inherits `viewMode` from its source** (`BayHierarchyService`, not `models/`): when a
variant is attached to its parent, `variantBay.state.viewMode = sourceBay.state.viewMode`.

### 5. URI Scheme Variations

**Known schemes:**
```typescript
'file'          // Local files
'untitled'      // New unsaved files
'vscode-remote' // SSH, WSL, containers
'git'           // Git diffs
'vscode-merge-conflict'  // Merge editor
'vscode-notebook-cell'   // Notebook cells
'chat-editing-snapshot-text-model'  // Copilot snapshots
```

**Affected metadata:**
```typescript
enrichMetadata() {
  // scheme = uri.scheme
  // isRemote = scheme !== 'file' && scheme !== 'untitled'
  // isUntitled = scheme === 'untitled'
  
  if (isUntitled) {
    capabilities.canRevealInExplorer = false;  // No file on disk
  }
  
  if (isRemote) {
    // Reveal can fail, but we try anyway
    capabilities.canRevealInExplorer = false;
  }
}
```

### 6. Diff Tabs (TabInputTextDiff) — NOT a separate BayType

**Diffs are not `bayType: 'diff'`.** `BayType` only has 4 members (`'file' | 'webview' | 'custom' |
'notebook'`) and a diff tab converts to a plain `bayType: 'file'` bay — it's identified as a
variant purely by `metadata.sourceBayId` being set, with `metadata.diffType` recording which kind
of diff it is:

**Metadata:**
```typescript
metadata: {
  bayType: 'file',           // NOT 'diff' — diffs are ordinary file bays
  uri: modifiedUri,          // The one shown
  originalUri: originalUri,  // For reference
  diffType: 'working-tree' | 'staged' | 'snapshot' | 'commit' | 'edit'
          | 'merge-conflict' | 'incoming' | 'current' | 'incoming-current'
          | 'preview' | 'unknown',
  sourceBayId: "file:///path/file.ts-1",  // Parent base-file bay id
  sourceUri: parentFileUri,               // Parent's real file:// uri (git/timeline/snapshot
                                           // URIs are normalized to file:// — see tabClassifier.resolveSourceUri)
}

capabilities: {
  canPin: false,  // computeCapabilities: canPin = !isPinned && !sourceBayId — diffs never pin
}
```

**ID:** `` `diff:${modifiedUri}::${originalUri}-${viewColumn}` `` (`generateVariantId()` in
`tabConverter.ts`) — deterministic and reconstructable purely from the native tab, so the
open path and the later close/active-sync paths derive the same id.

**Activation:**
```typescript
// ALWAYS by index (not showTextDocument) — same branch as webviews, keyed off sourceBayId
return await BayHelpers.activateByNativeTab(metadata, state);

// Internally uses workbench.action.openEditorAtIndex
```

### 7. Same File Multiple Groups

**Scenario:** `file.ts` in groups 1 and 2.

**Different metadata:**
```typescript
Bay1: { id: "file:///file.ts-1", state: { groupId: 1, isDirty: true } }
Bay2: { id: "file:///file.ts-2", state: { groupId: 2, isDirty: false } }
```

**findNativeTab() difference:**
```typescript
// Searches in specific group according to state.viewColumn
const group = nativeGroup(state.viewColumn);  // Group 1 or 2
return group.tabs.find(t => matchesNative(t, metadata));
```

**Independent state** - each Bay maintains its own mutable state.

### 8. Binary Files

**Detection:**
```typescript
enrichMetadata() {
  const binaryExts = ['.png', '.jpg', '.pdf', '.zip', '.exe', ...];
  metadata.isBinary = binaryExts.includes(fileExtension.toLowerCase());
  
  if (isBinary) {
    metadata.category = 'asset';
  }
}
```

**Affected actions:**
```typescript
// copyFileContents() does not work with binarios
export async function copyFileContents(metadata, state) {
  if (metadata.isBinary) {
    vscode.window.showWarningMessage('Cannot copy binary file contents');
    return;
  }
  // ...
}
```

---

## REAL OBSERVED EXAMPLES

### Example 1: Bay Creation (File Tab)

```yaml
Input (from convertToBay in services/core):
  vscode.Tab:
    input: TabInputText
      uri: "file:///c:/src/extension.ts"
    label: "extension.ts"
    isDirty: false
    isPinned: false
    isActive: true
    group.viewColumn: 1

Processing:
  1. Basic metadata extraction + id generation (services/core/helpers/tabConverter.ts)
     id: "file:///c:/src/extension.ts-1"
     label: "extension.ts"
     uri: Uri
     bayType: 'file'
     fileExtension: '.ts'
  
  2. Metadata enrichment (models/BayHelpers.ts)
     BayHelpers.enrichMetadata() →
       fileName: "extension.ts"
       baseName: "extension"
       dirPath: "c:/src"
       scheme: "file"
       isRemote: false
       isUntitled: false
       isBinary: false
       category: "component"
  
  3. Capabilities computation (models/BayHelpers.ts)
     BayHelpers.computeCapabilities() →
       canClose: true
       canPin: true
       canRevealInExplorer: true
       canTogglePreview: false  // Not .md/.svg/.html/.htm
       canHaveChildren: true
  
  4. State creation
     BayHelpers.createDefaultState() + VS Code state →
       isActive: true
       isDirty: false
       isPinned: false
       isPreview: false
       groupId: 1
       viewColumn: 1
       viewMode: 'source'
       hasVariant: false
       gitStatus: null  // Computed by GitSyncService
       diagnosticSeverity: null
       capabilities: <computed above>

Output (Bay):
  new Bay(metadata, state)
```

### Example 2: Pin Action

```yaml
User Action:
  Click pin button on "file.ts"

Execution:
  1. WebviewProvider.handleMessage({ type: 'pinBay', bayId: ... })
  
  2. bay = stateService.getBayById(bayId)
  
  3. await bay.pin()
     → BayActions.pin()
     → actions.pin(metadata, state, () => this.activate())
  
  4. Inside pin():
     if (!state.capabilities.canPin) { warning; return; }
     await activateFn();  // this.activate() injected
     await vscode.commands.executeCommand('workbench.action.pinEditor');
     state.isPinned = true;  // ⬅️ Mutation
  
  5. stateService.reorderOnPin(bay.id)  // Move after last pinned
  
  6. stateService.notifyChange()  // Trigger UI refresh

Result:
  - Tab pinned in VS Code
  - Bay.state.isPinned = true
  - Tab reordered in UI (after last pinned)
  - UI updated with pin badge
```

### Example 3: Activation (Webview Tab)

```yaml
Bay:
  metadata:
    id: "webview:settings-1"  # `${bayType}:${key}-${viewColumn}`, key = (viewType||label) sanitized —
                               # NOT a hardcoded "webview:" string; here bayType happens to equal "webview"
    bayType: 'webview'
    viewType: 'settings'
    label: "Settings"
    uri: undefined
  state:
    viewColumn: 1

Execution (await bay.activate()):
  1. activateWithRetry(metadata, state, 0)
  
  2. bayType === 'webview' → use activateByNativeTab()
  
  3. Inside activateByNativeTab():
     nativeTab = findNativeTab(metadata, state)
     if (!nativeTab) throw Error('Tab not found')
     
     tabIndex = nativeTab.group.tabs.indexOf(nativeTab)  // e.g., 2
     
     await focusGroup(1)
     await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', 2)
     
     return;  // ✓ Success
  
  4. If step 3 fails:
     // Fallback: specific command
     const cmd = WEBVIEW_COMMANDS['settings']  // 'workbench.action.openSettings'
     await vscode.commands.executeCommand(cmd)

Result:
  Settings tab activated without using URI (not available)
```

### Example 4: Activation Retry (Preview Tab)

```yaml
Bay:
  metadata:
    id: "file:///readme.md-1"
    uri: "file:///readme.md"
  state:
    isPreview: true
    viewColumn: 1

Execution (await bay.activate()):
  Attempt 0:
    nativeTab = findNativeTab()  // ✓ found
    activateByNativeTab()
    → vscode.commands.executeCommand('workbench.action.openEditorAtIndex', 3)
    → Error: "Tab index out of bounds"  // Tab was converted to permanent
  
  Attempt 1 (after 50ms delay):
    nativeTab = findNativeTab()  // ✓ found (but isPreview now false)
    activateByNativeTab()
    → vscode.commands.executeCommand('workbench.action.openEditorAtIndex', 3)
    → ✓ Success

Result:
  Tab activated after retry (timing issue resolved)
```

### Example 5: Metadata Categorization

```yaml
Scenarios:

1. Test File:
   fileName: "extension.test.ts"
   dirPath: "c:/src/__tests__"
   → category: "test"

2. Config File:
   fileName: "tsconfig.json"
   fileExtension: ".json"
   → category: "config"

3. Documentation:
   fileName: "README.md"
   fileExtension: ".md"
   → category: "doc"

4. Component:
   fileName: "Button.tsx"
   fileExtension: ".tsx"
   dirPath: "c:/src/components"
   → category: "component"

5. Style:
   fileName: "styles.css"
   fileExtension: ".css"
   → category: "style"

6. Webview (non-file):
   bayType: 'webview'
   label: "Extensions"
   → category: "webview"
```

### Example 6: CustomAction Execution

```yaml
Setup:
  bay.addCustomAction({
    id: 'runScript',
    label: 'Run Script',
    icon: 'play',
    tooltip: 'Execute this script',
    execute: async (metadata, state) => {
      const terminal = vscode.window.createTerminal();
      terminal.sendText(`node "${metadata.uri.fsPath}"`);
      terminal.show();
    },
  })
  // To block it conditionally, add its id to state.permissions.restrictedActions
  // instead — CustomBayAction has no per-action isEnabled predicate.

Execution:
  await bay.executeCustomAction('runScript')
  
  1. Find action: state.customActions?.find(a => a.id === 'runScript')
  
  2. Check restricted: isActionRestricted(state, 'runScript')
     → state.permissions.restrictedActions?.includes('runScript') → false → not restricted
  
  3. Execute (wrapped in startOperation/finishOperation):
     await action.execute(metadata, state)
     → Terminal opened
     → Command "node ..." sent

Result:
  Script executed in integrated terminal
```

---

## DEBUGGING TIPS

**Logger patterns in models:**
```typescript
// activationActions.ts
Logger.log(`[BayAction] Activating bay: ${label}, isPreview: ${isPreview}, viewMode: ${viewMode}, tabType: ${bayType}, nativeTabFound: ${!!nativeTab}, uri: ${uri}`);
Logger.log('[BayAction] Using native activation by index for: ' + label);
Logger.log('[BayAction] Activation failed (attempt N/M), retrying: ' + label);

// BayHelpers.ts (native tab helpers)
Logger.warn('[BayHelper] Native bay not found for activation: ' + label);
Logger.error('[BayHelper] Failed to activate by index: ' + label, err);
```

**Check metadata enrichment:**
```typescript
const raw = { id, label, uri, bayType, fileExtension };
const enriched = BayHelpers.enrichMetadata(raw);

console.log('Enrichment:', {
  fileName: enriched.fileName,
  category: enriched.category,
  scheme: enriched.scheme,
  isRemote: enriched.isRemote
});
```

**Check capabilities:**
```typescript
const caps = BayHelpers.computeCapabilities(metadata, state);
console.log('Capabilities:', {
  canPin: caps.canPin,        // True unless already pinned or a diff/variant (no URI check)
  canReveal: caps.canRevealInExplorer,  // Should be true for file:// scheme
  canTogglePreview: caps.canTogglePreview  // Should be true for .md
});
```

**Check native tab matching:**
```typescript
const group = BayHelpers.nativeGroup(state.viewColumn);
console.log('Native tabs in group:', group?.tabs.map(t => ({
  label: t.label,
  uri: t.input instanceof vscode.TabInputText ? t.input.uri.toString() : 'no-uri',
  matches: BayHelpers.matchesNative(t, metadata)
})));
```

---

## RESPONSIBILITY LIMITS

**This module MUST NOT:**
- Listen to VS Code events (BayEventService)
- Synchronize state with BayStateService (BaySyncService)
- Generate HTML or render UI (providers/)
- Query git status (GitSyncService)
- Get base64 icons (BayIconManager)

**This module MUST:**
- Define data contracts (types)
- Provide action methods in Bay class
- Implement actions as pure functions
- Enrich metadata with computed properties
- Calculate capabilities based on metadata/state
- Interact with VS Code Tab API when action requires
- Provide helpers for native tab search

---

## PERFORMANCE CONSIDERATIONS

**Enrichment is expensive:**
- Computing `fileName`, `category`, `scheme` requires string ops
- Executed only in `convertToBay()` (once per Bay)
- Metadata cached (immutable)

**findNativeTab() is O(n):**
- Linear search in `group.tabs`
- Typical groups: 5-20 tabs
- Acceptable because not in hot path

**Capabilities on-demand:**
- Only 5 fields stored (reduced from ~15)
- Others computed when action executes
- Reduces memory, simplifies logic

**Activation retry delay:**
- 50ms per retry (TIMINGS.ACTIVATION_RETRY_DELAY)
- Up to 3 retries (TIMINGS.ACTIVATION_MAX_RETRIES = 3 → 4 total attempts: 1 initial + 3 retries)
- Total overhead: ~150ms in worst-case edge cases (acceptable)
