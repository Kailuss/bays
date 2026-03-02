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

helpers/ (pure utilities)
  ├─ nativeTabHelper.ts (VS Code Tab API)
  ├─ metadataEnricher.ts (enrichment)
  └─ capabilitiesComputer.ts (capabilities + default state)
```

**Reason for the pattern:**
- **Composition over inheritance** - BayActions is abstract, Bay implements
- **Testable pure functions** - Each action can be tested in isolation
- **Separation of concerns** - Specialized helpers, not a monolith
- **Modularity** - Adding a new action = new file in actions/

### Action Pattern (Template)

```typescript
// actions/myActions.ts
import * as vscode from 'vscode';
import type { BayMetadata, BayState } from '../Bay';
import { findNativeTab } from '../helpers';

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
  const nativeTab = findNativeTab(metadata, state);
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
- `closeFn: () => Promise<void>` (closeOthers, moveToGroup)
- `activateFn: () => Promise<void>` (pin, unpin, openTimeline)

### Helpers: 3 Specialized Modules

**1. nativeTabHelper.ts (~160 LOC)**
- **Purpose:** Interact with VS Code native Tab API
- **Functions:**
  - `findNativeTab()` - Finds native tab by metadata/state
  - `nativeGroup()` - Gets TabGroup by viewColumn
  - `matchesNative()` - Checks if native tab matches metadata
  - `activateByNativeTab()` - Activates tab without URI (webviews, diffs, unknown)
  - `focusGroup()` - Focuses editor group
  - `isMarkdownPreview()` - Detects Markdown previews

**2. metadataEnricher.ts (~160 LOC)**
- **Purpose:** Enrich metadata with computed properties
- **Functions:**
  - `enrichMetadata()` - Adds fileName, baseName, scheme, category, etc.
  - `categorizeFile()` - Classifies files (config, test, doc, component, etc.)
  - `categorizeNonFileTab()` - Classifies webviews/unknown tabs
  - `mapPreviewModeToViewMode()` - Converts isPreview → viewMode

**3. capabilitiesComputer.ts (~105 LOC)**
- **Purpose:** Compute Bay's capabilities
- **Functions:**
  - `computeCapabilities()` - Calculates which actions are available
  - `createDefaultState()` - Initial state for new Bays
  - `createEmptyCapabilities()` - Capabilities placeholder

### Metadata Enrichment Flow

```typescript
// services/core/helpers/tabConverter.ts (initial conversion)
const rawMetadata: BayMetadata = {
  id: generateId(...),
  label: tab.label,
  uri: tab.input.uri,
  bayType: 'file',
  fileExtension: path.extname(uri.fsPath),
  // ... basic fields
};

// models/helpers/metadataEnricher.ts (enrichment)
const enriched = enrichMetadata(rawMetadata);
// Adds:
//   fileName, baseName, dirPath, scheme, isRemote, isUntitled,
//   category, isBinary, etc.

// Final result: complete metadata for the Bay
```

### Capabilities Computation

**Available fields (only 5):**
```typescript
type BayCapabilities = {
  canClose: boolean;         // Always true
  canPin: boolean;           // If has URI and not diff
  canRevealInExplorer: boolean;  // If scheme === 'file'
  canTogglePreview: boolean;     // If .md/.svg/.html with URI
  canHaveChildren: boolean;      // If file with URI
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

**3 strategies by BayType:**

**1. URI-based (file, notebook):**
```typescript
// Preference: activateByNativeTab() if tab exists
const nativeTab = findNativeTab(metadata, state);
if (nativeTab && uriMatches) {
  return await activateByNativeTab(metadata, state);
}

// Fallback: showTextDocument()
const doc = await vscode.workspace.openTextDocument(uri);
await vscode.window.showTextDocument(doc, { viewColumn, preview: false });
```

**2. Non-URI (webview, unknown, diff):**
```typescript
// ALWAYS use activateByNativeTab()
return await activateByNativeTab(metadata, state);

// Internally:
// 1. Focus group
// 2. workbench.action.openEditorAtIndex(tabIndex)
// 3. Fallback: specific command (known webviews)
```

**3. Markdown Preview Mode:**
```typescript
if (state.viewMode === 'preview' && isMarkdownFile) {
  await vscode.commands.executeCommand(
    'markdown.showPreview',
    metadata.uri
  );
  return;
}
```

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

### Native Tab Matching (nativeTabHelper)

**Problem:** We need to find the VS Code native tab that corresponds to a Bay.

**Strategies by type:**
```typescript
function matchesNative(t: vscode.Tab, metadata: BayMetadata): boolean {
  // Webview: match by label (no URI available)
  if (t.input instanceof vscode.TabInputWebview) {
    return t.label === metadata.label;
  }
  
  // Text: match by URI
  if (t.input instanceof vscode.TabInputText) {
    return t.input.uri.toString() === metadata.uri?.toString();
  }
  
  // Diff: match by modified URI
  if (t.input instanceof vscode.TabInputTextDiff) {
    return t.input.modified?.toString() === metadata.uri?.toString();
  }
  
  // Notebook: match by URI
  if (t.input instanceof vscode.TabInputNotebook) {
    return t.input.uri.toString() === metadata.uri?.toString();
  }
  
  // Custom/Unknown: match by label (fallback)
  return t.label === metadata.label;
}
```

**Search:**
```typescript
export function findNativeTab(metadata: BayMetadata, state: BayState): vscode.Tab | undefined {
  const group = nativeGroup(state.viewColumn);
  if (!group) return undefined;
  
  return group.tabs.find(t => matchesNative(t, metadata));
}
```

### CustomActions (Extensibility)

**Definition:**
```typescript
type CustomBayAction = {
  id: string;
  label: string;
  icon: string;
  tooltip: string;
  keybinding?: string;
  execute: (metadata: BayMetadata, state: BayState) => Promise<void>;
  isEnabled?: (metadata: BayMetadata, state: BayState) => boolean;
};
```

**Usage:**
```typescript
// Add custom action
bay.addCustomAction({
  id: 'openInBrowser',
  label: 'Open in Browser',
  icon: 'globe',
  tooltip: 'Open file in default browser',
  execute: async (metadata, state) => {
    if (!metadata.uri) return;
    await vscode.env.openExternal(metadata.uri);
  },
  isEnabled: (metadata, state) => {
    return metadata.fileExtension === '.html';
  }
});

// Execute action
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
  canPin: false,              // No URI
  canRevealInExplorer: false, // No file
  canTogglePreview: false,    // No content file
  canHaveChildren: false,     // Not file-based
}
```

**Activation:**
```typescript
// ALWAYS by native index or specific command
const WEBVIEW_COMMANDS = {
  'settings': 'workbench.action.openSettings2',
  'keyboard shortcuts': 'workbench.action.openGlobalKeybindings',
  // ...
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

### 4. Markdown Preview Mode Toggle

**State:**
```typescript
bay.state.viewMode: 'source' | 'preview'
```

**Activation by viewMode:**
```typescript
if (state.viewMode === 'preview' && isMarkdownFile) {
  // Open preview view
  await vscode.commands.executeCommand('markdown.showPreview', uri);
} else {
  // Open source view (normal editor)
  await vscode.window.showTextDocument(doc, { viewColumn });
}
```

**Toggle:**
```typescript
// In WebviewProvider on fileAction:
if (actionId === 'openMarkdownPreview') {
  bay.state.viewMode = 'preview';
  await previewService.showPreviewFor(bay);
} else if (actionId === 'editMarkdownSource') {
  bay.state.viewMode = 'source';
  await previewService.hidePreview();
}
```

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

### 6. Diff Tabs (TabInputTextDiff)

**Metadata:**
```typescript
metadata: {
  bayType: 'diff',
  uri: modifiedUri,        // The one shown
  originalUri: originalUri, // For reference
  diffType: 'working-tree' | 'staged' | ...,
  parentId: "file:///path/file.ts-1",  // Parent base file
}

capabilities: {
  canPin: false,  // Diffs cannot be pinned
}
```

**Activation:**
```typescript
// ALWAYS by index (not showTextDocument)
return await activateByNativeTab(metadata, state);

// Internally uses openEditorAtIndex
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
  1. Basic metadata extraction (tabConverter)
     id: "file:///c:/src/extension.ts-1"
     label: "extension.ts"
     uri: Uri
     bayType: 'file'
     fileExtension: '.ts'
  
  2. Metadata enrichment (metadataEnricher)
     enrichMetadata() →
       fileName: "extension.ts"
       baseName: "extension"
       dirPath: "c:/src"
       scheme: "file"
       isRemote: false
       isUntitled: false
       isBinary: false
       category: "component"
  
  3. Capabilities computation (capabilitiesComputer)
     computeCapabilities() →
       canClose: true
       canPin: true
       canRevealInExplorer: true
       canTogglePreview: false  // Not .md/.svg/.html
       canHaveChildren: true
  
  4. State creation
     createDefaultState() + VS Code state →
       isActive: true
       isDirty: false
       isPinned: false
       isPreview: false
       groupId: 1
       viewColumn: 1
       viewMode: 'source'
       hasChildren: false
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
  1. WebviewProvider.handleMessage({ type: 'pinTab', tabId: ... })
  
  2. bay = stateService.fetchBayById(tabId)
  
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
    id: "webview:settings-1"
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
     const cmd = WEBVIEW_COMMANDS['settings']  // 'workbench.action.openSettings2'
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
    isEnabled: (metadata, state) => {
      return metadata.fileExtension === '.js' && !state.isDirty;
    }
  })

Execution:
  await bay.executeCustomAction('runScript')
  
  1. Find action: state.customActions.find(a => a.id === 'runScript')
  
  2. Check enabled: action.isEnabled(metadata, state)
     → fileExtension === '.js' ✓
     → !isDirty ✓
     → true
  
  3. Execute: await action.execute(metadata, state)
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
Logger.log('[TabAction] Activating tab: ' + label + ', isPreview: ' + isPreview);
Logger.log('[TabAction] Using native activation by index');
Logger.log('[TabAction] Activation failed, retrying...');

// nativeTabHelper.ts
Logger.warn('[TabHelper] Native tab not found for activation: ' + label);
Logger.error('[TabHelper] Failed to activate by index: ' + label, err);
```

**Check metadata enrichment:**
```typescript
const raw = { id, label, uri, bayType, fileExtension };
const enriched = enrichMetadata(raw);

console.log('Enrichment:', {
  fileName: enriched.fileName,
  category: enriched.category,
  scheme: enriched.scheme,
  isRemote: enriched.isRemote
});
```

**Check capabilities:**
```typescript
const caps = computeCapabilities(metadata, state);
console.log('Capabilities:', {
  canPin: caps.canPin,        // Should be true for files with URI
  canReveal: caps.canRevealInExplorer,  // Should be true for file:// scheme
  canTogglePreview: caps.canTogglePreview  // Should be true for .md
});
```

**Check native tab matching:**
```typescript
const group = nativeGroup(state.viewColumn);
console.log('Native tabs in group:', group?.tabs.map(t => ({
  label: t.label,
  uri: t.input instanceof vscode.TabInputText ? t.input.uri.toString() : 'no-uri',
  matches: matchesNative(t, metadata)
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
- Only 50ms (TIMINGS.ACTIVATION_RETRY_DELAY)
- Maximum 2 attempts (TIMINGS.ACTIVATION_MAX_RETRIES)
- Total overhead: ~100ms in edge cases (acceptable)
