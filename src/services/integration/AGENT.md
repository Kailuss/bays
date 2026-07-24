# services/integration/ - External APIs Integration Module

## MODULE PURPOSE

This module manages optional integrations with external VS Code APIs and other extensions that are NOT
part of the Bays core. It provides decoupled connections with the Git Extension, GitHub Copilot Chat, and
Claude Code, without affecting base functionality.

**Exact responsibilities:**
- Detect Git status of files (modified, added, conflict, etc.)
- Listen to Git repository changes and update badges
- Attach files to GitHub Copilot Chat context
- Read Claude Code's on-disk conversation transcripts and enrich the truncated tab label of its chat/plan
  webview bays with the full conversation title
- Handle availability of optional extensions (may not be installed)
- Update Bay integration state after interactions

**It is NOT responsible for:**
- Synchronization with VS Code Tab API (see services/core/BaySyncService)
- Rendering Git/Copilot/Claude badges or icons (see providers/, src/utils/webviewExtensionIcons.ts, src/utils/builtinIcons.ts)
- Managing Bays state (see services/core/BayStateService)
- Executing Git commands (read-only status only)
- UI or presentation logic (see services/ui/)

---

## TECHNICAL INVARIANTS

1. **Git status is optional** - Extension may not be available, always silent fail
2. **Copilot Chat is optional** - Extension may not be installed, check with isAvailable()
3. **ALWAYS path normalization** - Lowercase on Windows, case-sensitive on Unix/Mac
4. **Conflict has priority** - If there is a merge conflict, ignore working/index status
5. **Lazy Git initialization** - Multiple attempts (0ms, 500ms, 2000ms) for startup
6. **One listener per repository** - Tracked in Set to avoid duplicates
7. **Working tree overrides index** - If both exist, working tree status wins
8. **Status mapping is exhaustive** - 19 Git API codes → 6 GitStatus values
9. **Silent failures in Git** - Try/catch without logging, return null
10. **Copilot updates integration state** - Call tab.addToCopilotContext() after attach
11. **Claude title enrichment is best-effort** - No transcript match, no dir, or a format change all degrade to the native (truncated) label, never an error
12. **Custom title beats AI title** - A non-empty user-set `custom-title` always wins over the auto-generated `ai-title` in the same transcript
13. **Ambiguous match = no match** - `enrichLabels()` only accepts an unambiguous single transcript match per bay; ties are discarded

---

## IMPLEMENTATION RULES

### Integration Services Architecture

```
GitSyncService (Git Extension integration)
  ├─ getGitStatus() → reads file status
  ├─ setupGitListeners() → attach listeners to repos
  ├─ refreshAllGitStatuses() → update all bays
  └─ mapGitApiStatus() → converts Git codes

CopilotService (GitHub Copilot Chat integration)
  ├─ isAvailable() → check if extension is installed
  ├─ addFileToChat() → attach single file
  ├─ addFilesToChat() → attach multiple files
  └─ addMultipleFiles() → QuickPick UI

ClaudeConversationService (Claude Code conversation-title enrichment)
  ├─ isClaudeConversationBay() → detects Claude chat/plan webview bays
  ├─ enrichLabels() → resolves + writes the full conversation title
  ├─ watch() → re-enriches on transcript writes (debounced)
  └─ dispose() → closes fs watchers
```

**Separation of responsibilities:**
- **GitSyncService** - Read-only Git status, NO Git commands
- **CopilotService** - Only attach files to chat, NO code generation
- **ClaudeConversationService** - Only reads Claude's transcripts and writes `metadata.label`/`tooltipText`, NO chat interaction

### GitSyncService: Git Status Tracking

**Lazy initialization with retry:**
```typescript
activate(context: ExtensionContext) {
  // 1. Immediate attempt
  this._gitApi = this.resolveGitApi();
  
  if (this._gitApi && this._gitApi.repositories.length > 0) {
    this.setupGitListeners();
    this.refreshAllGitStatuses();
  } else {
    // 2. Setup listener for when Git opens repos
    const setupOnRepoOpen = () => {
      const gitApi = this.resolveGitApi();
      if (gitApi && !this._gitOpenRepoListenerAttached) {
        this._gitApi = gitApi;
        this._gitOpenRepoListenerAttached = true;
        
        this.disposables.push(
          gitApi.onDidOpenRepository((repo: any) => {
            this.attachGitRepoListener(repo);
            this.updateGitStatusForRepo(repo);
          })
        );
        
        // If there are already repos, setup now
        if (gitApi.repositories.length > 0) {
          this.setupGitListeners();
          this.refreshAllGitStatuses();
        }
      }
    };
    
    // 3. Retry after delays
    setupOnRepoOpen();              // 0ms
    setTimeout(setupOnRepoOpen, 500);   // 500ms
    setTimeout(setupOnRepoOpen, 2000);  // 2000ms
  }
}
```

**Git API resolution:**
```typescript
private resolveGitApi(): any | null {
  try {
    const ext = vscode.extensions.getExtension('vscode.git');
    const api = ext?.isActive ? ext.exports?.getAPI(1) ?? null : null;
    return api;
  } catch (err) {
    return null;  // Silent fail
  }
}
```

**Get file Git status:**
```typescript
getGitStatus(uri: vscode.Uri): GitStatus {
  try {
    const targetPath = this.normalizeFsPath(uri.fsPath);
    if (!targetPath) return null;
    
    if (!this._gitApi) this._gitApi = this.resolveGitApi();
    if (!this._gitApi || this._gitApi.repositories.length === 0) return null;
    
    // Find repo containing the file
    for (const repo of this._gitApi.repositories) {
      const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
      if (!repoRoot || !this.isPathInsideRepo(targetPath, repoRoot)) continue;
      
      // 1. Check merge conflicts (HIGHEST PRIORITY)
      const mergeChanges = repo.state.mergeChanges || [];
      const hasMergeConflict = mergeChanges.some((c: any) => 
        this.changeMatchesPath(c, targetPath)
      );
      if (hasMergeConflict) {
        return 'conflict';  // ⚠️ Conflict overrides everything
      }
      
      // 2. Check index (staged)
      const indexChanges = repo.state.indexChanges || [];
      const indexChange = indexChanges.find((c: any) => 
        this.changeMatchesPath(c, targetPath)
      );
      
      // 3. Check working tree (unstaged)
      const workingTreeChanges = repo.state.workingTreeChanges || [];
      const workingChange = workingTreeChanges.find((c: any) => 
        this.changeMatchesPath(c, targetPath)
      );
      
      const indexStatus = this.mapGitApiStatus(indexChange?.status);
      const workingStatus = this.mapGitApiStatus(workingChange?.status);
      
      // Special case: added in index + modified in working → "modified"
      if (indexStatus === 'added' && workingStatus === 'modified') {
        return 'modified';
      }
      
      // Working tree overrides index
      const finalStatus = workingStatus ?? indexStatus ?? null;
      return finalStatus;
    }
  } catch {
    // Silent fail if git is not available
  }
  
  return null;
}
```

**Path normalization (CRITICAL):**
```typescript
private normalizeFsPath(fsPath: string | undefined): string | null {
  if (!fsPath) return null;
  
  const normalized = path.normalize(fsPath);
  
  // Windows: case-insensitive (lowercase)
  // Unix/Mac: case-sensitive (preserve case)
  return path.sep === '\\' ? normalized.toLowerCase() : normalized;
}

private isPathInsideRepo(filePath: string, repoRoot: string): boolean {
  // Exact match OR starts with repo root + separator
  return filePath === repoRoot || 
         filePath.startsWith(`${repoRoot}${path.sep}`);
}
```

**Status mapping (19 codes → 6 values):**
```typescript
private mapGitApiStatus(status: number | undefined): GitStatus {
  switch (status) {
    case 7:  // INDEX_ADDED_BY_US
      return 'untracked';
    
    case 1:  // INDEX_MODIFIED
    case 9:  // INDEX_ADDED_BY_THEM
      return 'added';
    
    case 0:  // INDEX_MODIFIED
    case 3:  // INDEX_RENAMED
    case 4:  // INDEX_COPIED
    case 5:  // WT_MODIFIED
    case 10: // WT_NEW
    case 11: // WT_DELETED
      return 'modified';
    
    case 2:  // INDEX_DELETED
    case 6:  // WT_DELETED
      return 'deleted';
    
    case 8:  // IGNORED
      return 'ignored';
    
    case 12: // BOTH_DELETED
    case 13: // BOTH_ADDED
    case 14: // BOTH_MODIFIED
    case 15: // DELETED_BY_US
    case 16: // DELETED_BY_THEM
    case 17: // ADDED_BY_US
    case 18: // ADDED_BY_THEM
      return 'conflict';
    
    default:
      return status === undefined ? null : 'modified';
  }
}
```

**Repository listeners (one per repo):**
```typescript
private _gitRepoListeners = new Set<string>();

private attachGitRepoListener(repo: any): void {
  const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
  if (!repoRoot) return;
  
  // Check if already attached
  if (this._gitRepoListeners.has(repoRoot)) {
    return;  // ⚠️ Avoid duplicate listeners
  }
  
  this._gitRepoListeners.add(repoRoot);
  
  // Listen to state changes
  this.disposables.push(
    repo.state.onDidChange(() => {
      this.updateGitStatusForRepo(repo);
    })
  );
}

private updateGitStatusForRepo(repo: any): void {
  const repoRoot = this.normalizeFsPath(repo?.rootUri?.fsPath);
  if (!repoRoot) return;
  
  // Update only bays in this repo
  for (const tab of this.stateService.getAllBays()) {
    const uri = tab.metadata.uri;
    if (!uri) continue;
    
    const targetPath = this.normalizeFsPath(uri.fsPath);
    if (!targetPath || !this.isPathInsideRepo(targetPath, repoRoot)) continue;
    
    const newGitStatus = this.getGitStatus(uri);
    
    if (tab.state.gitStatus !== newGitStatus) {
      tab.state.gitStatus = newGitStatus;
      this.stateService.updateBayStateWithAnimation(tab);
    }
  }
}
```

### CopilotService: GitHub Copilot Chat Integration

**Availability check:**
```typescript
private copilotExtension?: vscode.Extension<unknown>;

constructor() {
  this.copilotExtension = vscode.extensions.getExtension('github.copilot-chat');
}

isAvailable(): boolean {
  return this.copilotExtension !== undefined;
}
```

**Attach single file:**
```typescript
// Overloaded signatures (backward compatibility)
async addFileToChat(tab: Bay): Promise<boolean>;
async addFileToChat(uri: vscode.Uri | undefined): Promise<boolean>;

async addFileToChat(tabOrUri: Bay | vscode.Uri | undefined): Promise<boolean> {
  // Handle both signatures
  let uri: vscode.Uri | undefined;
  let tab: Bay | undefined;
  
  if (tabOrUri instanceof Bay) {
    tab = tabOrUri;
    uri = tab.metadata.uri;
  } else {
    uri = tabOrUri;
  }
  
  if (!uri) return false;
  if (!this.isAvailable()) return false;
  
  try {
    // Execute VS Code command
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query: '',
      isPartialQuery: true,  // Pre-fill, don't auto-send
      attachFiles: [uri],
    } satisfies ChatOpenOptions);
    
    // Update integration state if tab was provided
    if (tab) {
      tab.addToCopilotContext();  // ⚠️ Track in Bay state
    }
    
    return true;
  } catch (error) {
    vscode.window.showWarningMessage(
      `Failed to attach file to Copilot Chat: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}
```

**Attach multiple files (batch):**
```typescript
// Overloaded signatures
async addFilesToChat(tabs: Bay[], query?: string): Promise<boolean>;
async addFilesToChat(uris: vscode.Uri[], query?: string): Promise<boolean>;

async addFilesToChat(tabsOrUris: Bay[] | vscode.Uri[], query?: string): Promise<boolean> {
  if (tabsOrUris.length === 0) return false;
  if (!this.isAvailable()) return false;
  
  // Determine if we have tabs or URIs
  const areTabs = tabsOrUris.length > 0 && tabsOrUris[0] instanceof Bay;
  const tabs = areTabs ? (tabsOrUris as Bay[]) : undefined;
  const uris = areTabs 
    ? (tabsOrUris as Bay[]).map(t => t.metadata.uri).filter((u): u is vscode.Uri => !!u)
    : (tabsOrUris as vscode.Uri[]);
  
  try {
    // Single command for all files
    await vscode.commands.executeCommand('workbench.action.chat.open', {
      query: query ?? '',
      isPartialQuery: !query,  // If query provided, auto-send
      attachFiles: uris,       // ⚠️ Batch attach
    } satisfies ChatOpenOptions);
    
    // Update integration state for all tabs
    if (tabs) {
      for (const tab of tabs) {
        if (tab.metadata.uri) {
          tab.addToCopilotContext();
        }
      }
    }
    
    return true;
  } catch (error) {
    vscode.window.showWarningMessage(
      `Failed to attach files to Copilot Chat: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}
```

**QuickPick UI for multi-select:**
```typescript
async addMultipleFiles(tabs: Bay[]): Promise<void> {
  const fileTabs = tabs.filter(t => t.metadata.uri);
  
  if (fileTabs.length === 0) {
    vscode.window.showInformationMessage('No file tabs to add');
    return;
  }
  
  // Show multi-select QuickPick
  const selected = await vscode.window.showQuickPick(
    fileTabs.map(tab => ({
      label: tab.metadata.label,
      description: tab.metadata.detailLabel,
      detail: tab.metadata.tooltipText,
      tab,  // Preserve tab reference
    })),
    {
      canPickMany: true,  // ⚠️ Multi-select enabled
      placeHolder: 'Select files to add to Copilot Chat context',
    }
  );
  
  if (!selected || selected.length === 0) return;
  
  // Extract tabs from selection
  const selectedTabs = selected.map(item => item.tab);
  
  // Batch attach
  const success = await this.addFilesToChat(selectedTabs);
  
  if (success) {
    vscode.window.showInformationMessage(
      `Added ${selectedTabs.length} file(s) to Copilot Chat context`
    );
  }
}
```

**ChatOpenOptions interface:**
```typescript
interface ChatOpenOptions {
  /** Prompt text to pre-fill in the chat input. */
  query?: string;
  
  /** If true, the query is placed in the input but not sent automatically. */
  isPartialQuery?: boolean;
  
  /** File URIs (or URI + range) to attach as context. */
  attachFiles?: (vscode.Uri | { 
    uri: vscode.Uri; 
    range: { 
      startLineNumber: number; 
      startColumn: number; 
      endLineNumber: number; 
      endColumn: number 
    } 
  })[];
  
  /** Chat mode: 'agent', 'ask', or 'edit'. */
  mode?: string;
}
```

### ClaudeConversationService: Conversation-Title Enrichment

**Purpose:** VS Code only exposes the tab title Claude Code itself sets on its chat/plan webview panels, and
Claude deliberately truncates it to `aiTitle.substring(0, 24) + "…"`. There is no VS Code API to read another
extension's webview state, so the FULL conversation title is instead read straight from Claude Code's own
on-disk session transcripts and patched onto `bay.metadata.label`. File: `ClaudeConversationService.ts`.
Icons live in `src/utils/webviewExtensionIcons.ts` + `src/utils/builtinIcons.ts` (see below).

**Detection — `isClaudeConversationBay()`:**
```typescript
static isClaudeConversationBay(bay: Bay): boolean {
  return bay.metadata.bayType === 'webview'
    && (bay.metadata.viewType ?? '').toLowerCase().includes('claudevscodepanel');
}
```
Matches both the chat panel viewType `mainThreadWebview-claudeVSCodePanel` and the plan-preview viewType
`mainThreadWebview-claudePlanPreview` — both lowercase to a string containing `claudevscodepanel`.

**Transcript location & matching:**
- Transcripts live at `~/.claude/projects/<workspace-slug>/<sessionId>.jsonl`, one file per session. The
  slug is the workspace's fsPath with `:`, `\`, `/` all replaced by `-` (`slugFor()`), matched
  case-insensitively against the existing `projects/` subdirectories.
- Per transcript, only the tail (`TAIL_BYTES` = 256 KB) is scanned first for speed; a full read is the
  fallback only if the tail contains no title line at all.
- Two JSONL line types carry a title: `{type:"custom-title", customTitle:"…"}` (set by the user) and
  `{type:"ai-title", aiTitle:"…"}` (auto-generated). A non-empty `custom-title` always wins over `ai-title`;
  the newest of each type in the scanned range is used (`readTitle()` scans backwards from the end).
- Up to `MAX_TRANSCRIPTS` = 24 newest transcripts per project dir are scanned to resolve one bay's title.
- Matching a bay's truncated label to a transcript title: strip the trailing `…` from the label to get the
  prefix, then require `title.startsWith(prefix)`. If more than one transcript's title matches the same
  prefix, the match is ambiguous and is discarded — only an unambiguous single match is used.
- Resolved titles are cached per transcript file keyed by `mtimeMs`; a changed mtime invalidates the entry.

**`enrichLabels(bays)` flow:**
```typescript
async enrichLabels(bays: Bay[]): Promise<string[]> {
  const changed: string[] = [];
  for (const bay of bays) {
    const full   = await this.resolveFullTitle(bay.metadata.label);
    const native = BayHelpers.findNativeTab(bay.metadata, bay.state)?.label;
    const desired = full ?? native ?? bay.metadata.label;

    if (desired && desired !== bay.metadata.label) {
      bay.metadata.label = desired;
      bay.metadata.tooltipText = full ?? desired;
      changed.push(bay.metadata.id);
    }
  }
  return changed;
}
```
Mutates `metadata.label`/`tooltipText` **in place** (safe: a webview bay's id derives from the stable
`viewType`, never the label — see `tabConverter.generateId`) and returns only the ids that actually
changed. `extension.ts` then calls `stateService.notifyBayLabelChange(id)` for each changed id, which fires
`onDidChangeBayLabel` → `provider.notifyBayLabelChanged()` posts `{type:'updateBayLabel', …}` — a partial
webview patch of just that row's label, no full HTML rebuild.

**Live updates — `watch()`:** `fs.watch()`s the resolved transcript directories (non-recursive, one watcher
per dir) and invokes the caller's `onChange` callback debounced 800ms after the last write, so a fast-typing
conversation doesn't spam re-enrichment. `extension.ts` wires this into a single-flight
`enrichClaudeTitles()` that also runs on `stateService.onDidChangeState` (a new chat tab opened) and once at
startup; re-entrant calls while a run is in flight are coalesced into one extra pass rather than queued.

**Iconography:** Claude's webview tabs get the real brand logo, not a generic codicon, via two layers:
- `webviewExtensionIcons.ts`: `preloadWebviewExtensionIcons()` (called at startup and on extensions-changed)
  maps the viewType substring `claude` → extension id `anthropic.claude-code`, reads
  `resources/claude-logo.svg` from that extension's install dir, and caches it as an inline base64
  `<img src="data:image/svg+xml;base64,…">` (the webview CSP already allows `img-src data:`).
  `resolveWebviewExtensionIcon(viewType)` returns that cached `<img>` html, or `undefined` if the extension
  isn't installed/loaded — callers then fall back to a codicon.
- `builtinIcons.ts` supplies that codicon fallback: `mainThreadWebview-claudeVSCodePanel` → `sparkle`,
  `mainThreadWebview-claudePlanPreview` → `checklist` (plus a viewType-substring regex fallback for either,
  since the label itself is unreliable for icon lookup the same way it is for identity).

**Special cases:**
1. **No transcript dir for the workspace** — `projectDirs()` logs and skips that workspace folder;
   `enrichLabels()` then has nothing to match against and the bay keeps whatever `findNativeTab()` reports
   (the truncated native label), never blocking or erroring.
2. **Brand-new session ("Claude Code" generic title)** — `resolveFullTitle()` short-circuits and returns
   `undefined` for the literal label `"Claude Code"` (no `…` to strip, nothing meaningful to match), so a
   fresh chat isn't mis-matched against an unrelated older transcript.
3. **Ambiguous prefix match** — if the truncated prefix matches more than one transcript's latest title
   (`matches.size !== 1`), the service intentionally returns no result rather than guessing; the bay falls
   back to the native label.
4. **`BayEventService` exclusion** — the generic webview-label refresh in `BayEventService` (which normally
   re-syncs `metadata.label` from the native tab on any webview title change) explicitly skips bays where
   `ClaudeConversationService.isClaudeConversationBay()` is true, so the two mechanisms never fight over the
   same label (see `BayEventService.ts`, around the native-tab diffing loop).
5. **Coupling to Claude Code's on-disk format** — this only works because it reverse-engineers Claude Code's
   `~/.claude` JSONL layout (verified against a specific Claude Code version); it degrades cleanly if the
   format changes or the file is missing — the bay simply keeps its native (truncated) label.

---

## KNOWN SPECIAL CASES

### 1. Git Extension Not Available

**Scenario:** User does not have Git extension enabled or installed.

**Detection:**
```typescript
const gitApi = this.resolveGitApi();
// → null
```

**Behavior:**
```typescript
getGitStatus(uri) {
  if (!this._gitApi) return null;  // ⚠️ Silent fail
  // No badges shown, no errors logged
}
```

**Result:** Extension works normally, without Git badges.

### 2. Git Startup Race Condition

**Problem:** Git extension activates AFTER Bays extension.

**Solution - Retry pattern:**
```typescript
activate(context) {
  // Immediate attempt
  this._gitApi = this.resolveGitApi();  // → null
  
  // Retry after 500ms
  setTimeout(() => {
    if (!this._gitApi) {
      this._gitApi = this.resolveGitApi();  // → may succeed
      if (this._gitApi) {
        this.setupGitListeners();
        this.refreshAllGitStatuses();
      }
    }
  }, 500);
  
  // Retry after 2000ms (last attempt)
  setTimeout(() => {
    if (!this._gitApi) {
      this._gitApi = this.resolveGitApi();
      if (this._gitApi) {
        this.setupGitListeners();
        this.refreshAllGitStatuses();
      }
    }
  }, 2000);
}
```

### 3. Merge Conflict Status Priority

**Scenario:** File has merge conflict AND modifications in working tree.

**Resolution:**
```typescript
// 1. Check merge conflicts FIRST
const mergeChanges = repo.state.mergeChanges || [];
const hasMergeConflict = mergeChanges.some(c => changeMatchesPath(c, targetPath));

if (hasMergeConflict) {
  return 'conflict';  // ⚠️ STOPS HERE, ignores working/index
}

// 2. Only if NO conflict, check working/index
const workingStatus = ...;
const indexStatus = ...;
```

**Result:** Conflict badge is shown, "modified" badge is NOT shown.

### 4. Added + Modified Status

**Scenario:** File staged (added) and then modified in working tree.

**Design decision:**
```typescript
const indexStatus = mapGitApiStatus(indexChange?.status);  // 'added'
const workingStatus = mapGitApiStatus(workingChange?.status);  // 'modified'

// Special case
if (indexStatus === 'added' && workingStatus === 'modified') {
  return 'modified';  // ⚠️ Show "modified", not "added"
}
```

**Reason:** User sees the file as "modified" (more intuitive).

### 5. Path Normalization Windows vs Unix

**Problem:** Windows paths case-insensitive, Unix case-sensitive.

**Normalization:**
```typescript
// Windows input: "C:\\Users\\File.ts"
// Unix input: "/home/user/File.ts"

private normalizeFsPath(fsPath: string): string | null {
  const normalized = path.normalize(fsPath);
  
  // Windows: "c:\\users\\file.ts" (lowercase)
  // Unix: "/home/user/File.ts" (preserve case)
  return path.sep === '\\' ? normalized.toLowerCase() : normalized;
}
```

**Comparison:**
```typescript
// Windows: c:\users\file.ts === C:\USERS\FILE.TS → true
// Unix: /home/user/File.ts === /home/user/file.ts → false
```

### 6. Repository Listener Duplication

**Problem:** Git extension may re-fire onDidOpenRepository.

**Prevention:**
```typescript
private _gitRepoListeners = new Set<string>();

private attachGitRepoListener(repo: any): void {
  const repoRoot = normalizeFsPath(repo.rootUri.fsPath);
  
  // Check if already attached
  if (this._gitRepoListeners.has(repoRoot)) {
    return;  // ⚠️ Skip, already listening
  }
  
  this._gitRepoListeners.add(repoRoot);
  
  this.disposables.push(
    repo.state.onDidChange(() => {
      this.updateGitStatusForRepo(repo);
    })
  );
}
```

**Result:** Only one listener per repository, no duplication.

### 7. Copilot Extension Not Installed

**Scenario:** User does not have GitHub Copilot Chat.

**Detection:**
```typescript
constructor() {
  this.copilotExtension = vscode.extensions.getExtension('github.copilot-chat');
  // → undefined if not installed
}

isAvailable(): boolean {
  return this.copilotExtension !== undefined;
}
```

**UI behavior:**
```typescript
// In package.json when clause:
"when": "view == bays && bays.copilotAvailable"

// Context key set in extension.ts:
vscode.commands.executeCommand('setContext', 'bays.copilotAvailable', copilotService.isAvailable());
```

**Result:** Copilot commands do not appear in UI if not installed.

### 8. Webview Tabs in Copilot

**Scenario:** User tries to add webview tab to Copilot.

**Validation:**
```typescript
async addFileToChat(tab: Bay): Promise<boolean> {
  const uri = tab.metadata.uri;
  
  if (!uri) return false;  // ⚠️ Webview does NOT have URI
  
  // Continue with attach...
}
```

**Result:** Webviews cannot be attached (no URI).

---

## REAL OBSERVED EXAMPLES

### Example 1: Git Status Resolution (Modified File)

```yaml
Input:
  uri: "file:///c:/project/src/extension.ts"
  Git state:
    workingTreeChanges: [{ uri: "file:///c:/project/src/extension.ts", status: 5 }]
    indexChanges: []
    mergeChanges: []

Processing (getGitStatus):
  1. normalizeFsPath("c:\\project\\src\\extension.ts")
     → "c:\\project\\src\\extension.ts" (Windows lowercase)
  
  2. Find repository containing path
     repoRoot: "c:\\project"
     isPathInsideRepo: true
  
  3. Check merge conflicts
     mergeChanges.length → 0 (no conflicts)
  
  4. Check index changes
     indexChanges.length → 0
     indexStatus → null
  
  5. Check working tree changes
     workingTreeChanges[0].status → 5 (WT_MODIFIED)
     mapGitApiStatus(5) → 'modified'
  
  6. Final status
     workingStatus: 'modified', indexStatus: null
     return: 'modified'

Output:
  gitStatus: 'modified'
  
UI Effect:
  Orange "M" badge shown on bay
```

### Example 2: Git Status Resolution (Conflict)

```yaml
Input:
  uri: "file:///home/user/project/README.md"
  Git state:
    mergeChanges: [{ uri: "file:///home/user/project/README.md" }]
    workingTreeChanges: [{ uri: "file:///home/user/project/README.md", status: 5 }]
    indexChanges: []

Processing:
  1. normalizeFsPath("/home/user/project/README.md")
     → "/home/user/project/README.md" (Unix, preserve case)
  
  2. Find repository
     repoRoot: "/home/user/project"
     isPathInsideRepo: true
  
  3. Check merge conflicts ⚠️ PRIORITY
     mergeChanges contains path → true
     return: 'conflict'  // STOPS HERE

Output:
  gitStatus: 'conflict'
  
UI Effect:
  Red "!" badge shown, "modified" badge NOT shown (conflict overrides)
```

### Example 3: Git Startup Retry Success

```yaml
Initial State:
  t=0ms: Bays extension activates
    resolveGitApi() → null (Git not ready yet)
  
  t=100ms: Git extension activates
  
  t=500ms: First retry
    resolveGitApi() → GitExtensionAPI (success!)
    setupGitListeners()
    refreshAllGitStatuses()
    → All bays get Git status badges

Result:
  Git badges appear 500ms after activation
```

### Example 4: Added + Modified Status

```yaml
Input:
  uri: "file:///project/newFile.ts"
  Git state:
    indexChanges: [{ uri: "...", status: 1 }]  # INDEX_MODIFIED (added)
    workingTreeChanges: [{ uri: "...", status: 5 }]  # WT_MODIFIED

Processing:
  1-3. No conflicts, find both changes
  
  4. mapGitApiStatus(1) → 'added' (indexStatus)
     mapGitApiStatus(5) → 'modified' (workingStatus)
  
  5. Special case check
     indexStatus === 'added' && workingStatus === 'modified' → true
     return: 'modified'  // ⚠️ Override to "modified"

Output:
  gitStatus: 'modified' (not 'added')
```

### Example 5: Copilot Attach Single File

```yaml
Input:
  tab: Bay { 
    metadata: { uri: "file:///project/src/app.ts", label: "app.ts" }
    state: { integrations: { copilot: { inContext: false } } }
  }

Processing (addFileToChat):
  1. Check availability
     isAvailable() → true (extension installed)
  
  2. Extract URI
     uri: "file:///project/src/app.ts"
  
  3. Execute command
     vscode.commands.executeCommand('workbench.action.chat.open', {
       query: '',
       isPartialQuery: true,
       attachFiles: ["file:///project/src/app.ts"]
     })
  
  4. Update integration state
     tab.addToCopilotContext()
     → tab.state.integrations.copilot.inContext = true
     → tab.state.integrations.copilot.addedAt = Date.now()

Output:
  - Copilot Chat opens with file attached
  - Bay shows Copilot badge in UI
  - Integration state tracked
```

### Example 6: Copilot Batch Attach Multiple Files

```yaml
Input:
  tabs: [
    Bay { uri: "file:///src/a.ts" },
    Bay { uri: "file:///src/b.ts" },
    Bay { uri: "file:///src/c.ts" }
  ]
  query: "Refactor these files"

Processing (addFilesToChat):
  1. Check availability → true
  
  2. Extract URIs
     uris: [
       "file:///src/a.ts",
       "file:///src/b.ts",
       "file:///src/c.ts"
     ]
  
  3. Single command execution ⚠️ Batch
     vscode.commands.executeCommand('workbench.action.chat.open', {
       query: "Refactor these files",
       isPartialQuery: false,  // Auto-send
       attachFiles: [uris]  // All 3 files
     })
  
  4. Update all integration states
     for each tab: tab.addToCopilotContext()

Output:
  - Copilot Chat opens with 3 files attached
  - Query "Refactor these files" auto-sent
  - All 3 bays show Copilot badge
```

### Example 7: Path Comparison Windows

```yaml
Scenario: Git repo path matching on Windows

Input:
  filePath: "C:\\Users\\Dev\\Project\\src\\file.ts"
  repoRoot: "c:\\users\\dev\\project"  # Different case

Processing:
  1. normalizeFsPath(filePath)
     path.normalize("C:\\Users\\Dev\\Project\\src\\file.ts")
     → "C:\\Users\\Dev\\Project\\src\\file.ts"
     path.sep === '\\' → true (Windows)
     → toLowerCase()
     → "c:\\users\\dev\\project\\src\\file.ts"
  
  2. normalizeFsPath(repoRoot)
     → "c:\\users\\dev\\project"
  
  3. isPathInsideRepo check
     "c:\\users\\dev\\project\\src\\file.ts".startsWith("c:\\users\\dev\\project\\")
     → true (case-insensitive match worked)

Result:
  Path matched despite different original case
```

### Example 8: Copilot Extension Not Installed

```yaml
Scenario: User doesn't have Copilot Chat

Initial State:
  copilotExtension = vscode.extensions.getExtension('github.copilot-chat')
  → undefined

User Action:
  Right-click bay → "Add to Copilot Chat" command
  
Processing:
  // Command not visible in UI (when clause)
  "when": "bays.copilotAvailable"  → false
  
  // If called programmatically:
  isAvailable() → false
  addFileToChat() → return false immediately

Result:
  - Command hidden in UI
  - No error shown to user
  - Extension works normally without Copilot
```

---

## DEBUGGING TIPS

**Logger patterns in services/integration:**
```typescript
// GitSyncService - Silent failures (NO logging)
try {
  const status = getGitStatus(uri);
} catch {
  // Silent fail, no log
}

// CopilotService - Only warnings on user-facing errors
vscode.window.showWarningMessage(
  `Failed to attach file to Copilot Chat: ${error.message}`
);
```

**Check Git API:**
```typescript
const gitService = new GitSyncService(stateService);
console.log('Git API available:', gitService.resolveGitApi() !== null);

const gitApi = gitService.resolveGitApi();
console.log('Git repositories:', gitApi?.repositories.length ?? 0);
```

**Check Git status:**
```typescript
const uri = vscode.Uri.file('/path/to/file.ts');
const status = gitService.getGitStatus(uri);
console.log('Git status:', status);  // 'modified' | 'added' | 'conflict' | null
```

**Check Copilot availability:**
```typescript
const copilotService = new CopilotService();
console.log('Copilot available:', copilotService.isAvailable());

const ext = vscode.extensions.getExtension('github.copilot-chat');
console.log('Copilot extension:', ext ? 'installed' : 'not installed');
```

**Check path normalization:**
```typescript
const path1 = gitService.normalizeFsPath('C:\\Users\\File.ts');
const path2 = gitService.normalizeFsPath('c:\\users\\file.ts');
console.log('Paths match:', path1 === path2);  // true on Windows
```

**Check Claude conversation-title enrichment:**
```typescript
const bay = stateService.getAllBays().find(b => ClaudeConversationService.isClaudeConversationBay(b));
console.log('Is Claude bay:', !!bay, bay?.metadata.viewType, bay?.metadata.label);

// Force one enrichment pass and see what changed:
const changed = await claudeConversation.enrichLabels(stateService.getAllBays()
  .filter(ClaudeConversationService.isClaudeConversationBay));
console.log('Labels enriched:', changed);
```
If a title never resolves, check `~/.claude/projects/` for a directory whose name is the workspace fsPath
with `:`/`\`/`/` replaced by `-`, and confirm the session's `.jsonl` actually contains an `ai-title` or
`custom-title` line matching the tab's truncated prefix.

---

## RESPONSIBILITY LIMITS

**This module MUST NOT:**
- Execute Git commands (read-only status only)
- Render badges or UI (providers/)
- Manage Bays state (services/core/BayStateService)
- Synchronize with VS Code Tab API (services/core/BaySyncService)
- Generate code with Copilot (only attach files)
- Interact with the Claude Code chat UI or read its webview state directly (only read its transcripts on disk)
- Rewrite the label of a non-Claude webview bay (that stays with `BayEventService`'s native-tab sync)

**This module MUST:**
- Detect availability of optional extensions
- Read Git status of files
- Listen to Git repository changes
- Attach files to Copilot Chat
- Resolve and patch the full Claude conversation title onto `metadata.label`/`tooltipText`, and only for
  ids it actually changed
- Update Bay integration state after interactions
- Handle errors with silent failures (Git, Claude transcript I/O) or warnings (Copilot)

---

## PERFORMANCE CONSIDERATIONS

**Git status resolution:**
- **NO status cache** - Git API caches internally
- **Lazy initialization** - Only resolves API when used
- **Repository-scoped updates** - Only bays of the affected repo
- **Path normalization cached** - String comparison O(1) after normalize

**Copilot integration:**
- **Check availability once** - Extension reference cached in constructor
- **Batch attach when possible** - Multiple files in a single command
- **No state persistence** - Integration state in-memory only

**Claude conversation-title enrichment:**
- **Tail read first** - only the last 256 KB of a transcript is scanned; a full read is the rare fallback
- **Per-file cache keyed by mtime** - unchanged transcripts are never re-scanned
- **Bounded scan** - at most 24 newest transcripts per project dir considered per bay
- **Debounced re-enrichment** - `fs.watch` writes are coalesced to one pass per 800ms, not one per write
- **Single-flight** - `extension.ts` coalesces overlapping `enrichClaudeTitles()` calls into one extra pass
- **Partial patch only** - only bays whose label actually changed are pushed to the webview (`updateBayLabel`), never a full rebuild

**Listeners:**
- **One listener per repo** - Set prevents duplication
- **One `fs.watch` per Claude transcript dir** - non-recursive, closed in `dispose()`
- **Proper disposes** - All listeners/watchers in disposables array / `dispose()`
- **Silent failures** - Try/catch without logging to avoid spam (Claude transcript reads log at most a `Logger.log`/`Logger.warn`, never throw)
