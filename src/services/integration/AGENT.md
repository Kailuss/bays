# services/integration/ - External APIs Integration Module

## MODULE PURPOSE

This module manages optional integrations with external VS Code APIs that are NOT part of the Bays core.
It provides decoupled connections with GitHub Copilot Chat and Git Extension without affecting base functionality.

**Exact responsibilities:**
- Detect Git status of files (modified, added, conflict, etc.)
- Listen to Git repository changes and update badges
- Attach files to GitHub Copilot Chat context
- Handle availability of optional extensions (may not be installed)
- Update Bay integration state after interactions

**It is NOT responsible for:**
- Synchronization with VS Code Tab API (see services/core/BaySyncService)
- Rendering Git/Copilot badges (see providers/)
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
```

**Separation of responsibilities:**
- **GitSyncService** - Read-only Git status, NO Git commands
- **CopilotService** - Only attach files to chat, NO code generation

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
  for (const tab of this.stateService.fetchAllBays()) {
    const uri = tab.metadata.uri;
    if (!uri) continue;
    
    const targetPath = this.normalizeFsPath(uri.fsPath);
    if (!targetPath || !this.isPathInsideRepo(targetPath, repoRoot)) continue;
    
    const newGitStatus = this.getGitStatus(uri);
    
    if (tab.state.gitStatus !== newGitStatus) {
      tab.state.gitStatus = newGitStatus;
      this.stateService.updateTabStateWithAnimation(tab);
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

---

## RESPONSIBILITY LIMITS

**This module MUST NOT:**
- Execute Git commands (read-only status only)
- Render badges or UI (providers/)
- Manage Bays state (services/core/BayStateService)
- Synchronize with VS Code Tab API (services/core/BaySyncService)
- Generate code with Copilot (only attach files)

**This module MUST:**
- Detect availability of optional extensions
- Read Git status of files
- Listen to Git repository changes
- Attach files to Copilot Chat
- Update Bay integration state after interactions
- Handle errors with silent failures (Git) or warnings (Copilot)

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

**Listeners:**
- **One listener per repo** - Set prevents duplication
- **Proper disposes** - All listeners in disposables array
- **Silent failures** - Try/catch without logging to avoid spam
