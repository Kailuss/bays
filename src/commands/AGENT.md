# commands/ - Command Registration Module

## MODULE PURPOSE

This module registers VS Code commands that expose Bays functionality to users and other systems.
It acts as a thin layer between the VS Code Command API and the business logic in Bay/services.

**Exact responsibilities:**
- Register commands in package.json as executables
- Resolve Bay ID string → Bay instance using BayStateService
- Delegate execution to Bay methods or services
- Handle global commands (saveAll, closeAll, toggleCompactMode)
- Validate arguments before delegation

**It is NOT responsible for:**
- Implementing business logic (see models/actions/)
- Managing Bays state (see services/core/BayStateService)
- Synchronizing with VS Code Tab API (see services/core/BaySyncService)
- Rendering UI (see providers/)
- Executing file actions (see models/actions/fileActions.ts)

---

## TECHNICAL INVARIANTS

1. **Commands receive Bay ID as string** - Never Bay instances directly
2. **Resolution always validates** - Check `resolve(arg)` returns undefined if not found
3. **Immediate delegation** - Commands contain NO logic, only delegate
4. **Registration in subscriptions** - All commands in context.subscriptions
5. **Consistent async/await** - All commands are async (even if they delegate sync)
6. **Validation before execution** - `if (bay)` before calling methods
7. **Zero side effects** - Commands do NOT modify state directly
8. **Type safety in resolve** - `arg: unknown` → validate → Bay | undefined
9. **Copilot commands separated** - copilotCommands.ts with its own register
10. **Quick picks for selection** - moveToGroup, addMultipleToCopilotChat use UI

---

## IMPLEMENTATION RULES

### Commands Architecture

```
bayCommands.ts (Bay-related commands)
  ├─ openBay/closeBay/closeOthers → Bay methods
  ├─ pinBay/unpinBay → Bay state methods
  ├─ copyRelativePath/compareWithActive → Bay file actions
  ├─ saveAll/closeAll → VS Code global commands
  └─ toggleCompactMode → Configuration changes

copilotCommands.ts (Copilot integration commands)
  ├─ addToCopilotChat → Single file attach
  └─ addMultipleToCopilotChat → Multi-select UI
```

**Design pattern:**
- **Thin wrapper** - Commands contain no logic
- **Clear delegation** - Bay methods or service methods
- **Type-safe resolution** - `resolve(arg)` pattern

### Pattern: Bay ID Resolution

**Resolve function:**
```typescript
const resolve = (arg: unknown) => {
  if (typeof arg === 'string') {
    return stateService.fetchBayById(arg);
  }
  return undefined;
};
```

**Usage:**
```typescript
vscode.commands.registerCommand('bays.openBay', async (arg: unknown) => {
  const bay = resolve(arg);  // string → Bay | undefined
  if (bay) {                  // Validation
    await bay.activate();     // Delegation
  }
});
```

**Reason for the pattern:**
- Commands invoked from webview send string (Bay ID)
- Commands invoked programmatically may send anything
- Type safety without runtime errors

### Bay Commands Registration

**Basic commands (open/close):**
```typescript
context.subscriptions.push(
  // Open (activate) bay
  vscode.commands.registerCommand('bays.openBay', async (arg: unknown) => {
    const bay = resolve(arg);
    if (bay) { await bay.activate(); }
  }),
  
  // Close specific bay
  vscode.commands.registerCommand('bays.closeBay', async (arg: unknown) => {
    const bay = resolve(arg);
    if (bay) { await bay.close(); }
  }),
  
  // Close all except one
  vscode.commands.registerCommand('bays.closeOthers', async (arg: unknown) => {
    const bay = resolve(arg);
    if (bay) { await bay.closeOthers(); }
  }),
  
  // Close tabs to the right
  vscode.commands.registerCommand('bays.closeToRight', async (arg: unknown) => {
    const bay = resolve(arg);
    if (bay) { await bay.closeToRight(); }
  }),
);
```

**Global commands (do not require Bay):**
```typescript
context.subscriptions.push(
  // Close all editors (delegates to VS Code)
  vscode.commands.registerCommand('bays.closeAll', async () => {
    await vscode.commands.executeCommand(VSCODE_COMMANDS.CLOSE_ALL_EDITORS);
  }),
  
  // Save all files
  vscode.commands.registerCommand('bays.saveAll', async () => {
    await vscode.workspace.saveAll(false);  // false = no untitled
  }),
  
  // Toggle compact mode setting
  vscode.commands.registerCommand('bays.toggleCompactMode', async () => {
    const cfg = vscode.workspace.getConfiguration('bays');
    const current = cfg.get<boolean>('compactMode', false);
    await cfg.update('compactMode', !current, vscode.ConfigurationTarget.Global);
  }),
);
```

**State commands (pin/unpin):**
```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('bays.pinBay', async (arg: unknown) => {
    const bay = resolve(arg);
    if (bay) { await bay.pin(); }
  }),
  
  vscode.commands.registerCommand('bays.unpinBay', async (arg: unknown) => {
    const bay = resolve(arg);
    if (bay) { await bay.unpin(); }
  }),
);
```

**File commands (copy/compare/reveal):**
```typescript
context.subscriptions.push(
  // Reveal in OS file explorer
  vscode.commands.registerCommand('bays.revealInExplorer', async (arg: unknown) => {
    const bay = resolve(arg);
    if (bay) { await bay.revealInExplorer(); }
  }),
  
  // Copy relative path
  vscode.commands.registerCommand('bays.copyRelativePath', async (arg: unknown) => {
    const bay = resolve(arg);
    if (bay) { await bay.copyRelativePath(); }
  }),
  
  // Copy file contents
  vscode.commands.registerCommand('bays.copyFileContents', async (arg: unknown) => {
    const bay = resolve(arg);
    if (bay) { await bay.copyFileContents(); }
  }),
  
  // Compare with active editor
  vscode.commands.registerCommand('bays.compareWithActive', async (arg: unknown) => {
    const bay = resolve(arg);
    if (bay) { await bay.compareWithActive(); }
  }),
);
```

**Command with UI (QuickPick):**
```typescript
vscode.commands.registerCommand('bays.moveToGroup', async (arg: unknown) => {
  const bay = resolve(arg);
  if (!bay) return;
  
  // Get all groups except current
  const groups = vscode.window.tabGroups.all;
  
  if (groups.length <= 1) {
    vscode.window.showInformationMessage('Only one group available');
    return;
  }
  
  // Build QuickPick options
  const options = groups
    .filter(g => g.viewColumn !== bay.state.viewColumn)
    .map(g => ({ 
      label: `Group ${g.viewColumn}`, 
      viewColumn: g.viewColumn 
    }));
  
  // Show picker
  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: 'Select target group',
  });
  
  // Execute move
  if (selected) { 
    await bay.moveToGroup(selected.viewColumn); 
  }
});
```

### Copilot Commands Registration

**Add single file:**
```typescript
vscode.commands.registerCommand('bays.addToCopilotChat', async (bayId: string) => {
  // ⚠️ Directly typed as string (known from webview)
  const bay = typeof bayId === 'string' 
    ? stateService.fetchBayById(bayId) 
    : undefined;
  
  if (bay) {
    await copilotService.addFileToChat(bay.metadata.uri);
  }
});
```

**Add multiple files with UI:**
```typescript
vscode.commands.registerCommand('bays.addMultipleToCopilotChat', async () => {
  const allBays = stateService.fetchAllBays();
  
  if (allBays.length === 0) {
    vscode.window.showInformationMessage('No tabs open');
    return;
  }
  
  // Delegate to service (handles QuickPick UI internally)
  await copilotService.addMultipleFiles(allBays);
});
```

---

## KNOWN SPECIAL CASES

### 1. Command Called with Invalid Bay ID

**Scenario:** Webview sends ID of bay that was already closed.

**Flow:**
```typescript
const bay = resolve('file:///path/deleted.ts-1');
// → undefined (bay does not exist in stateService)

if (bay) {
  // Does not execute, skip silently
}
```

**Result:** Command does nothing, shows no error.

### 2. Command Called Programmatically

**Scenario:** Other code calls command with incorrect arguments.

**Validation:**
```typescript
const resolve = (arg: unknown) => {
  if (typeof arg === 'string') {  // Type guard
    return stateService.fetchBayById(arg);
  }
  return undefined;  // Invalid arg type
};
```

**Example:**
```typescript
// Webview call: ✅
vscode.commands.executeCommand('bays.openBay', 'file:///path-1');

// Programmatic call: ✅
vscode.commands.executeCommand('bays.openBay', bay.id);

// Invalid call: ⚠️ (resolves to undefined)
vscode.commands.executeCommand('bays.openBay', null);
vscode.commands.executeCommand('bays.openBay', { some: 'object' });
```

### 3. Move to Group with Single Group

**Scenario:** User tries to move bay but there is only one group.

**UI feedback:**
```typescript
const groups = vscode.window.tabGroups.all;

if (groups.length <= 1) {
  vscode.window.showInformationMessage('Only one group available');
  return;  // Early exit
}
```

**Result:** Informational message, no error.

### 4. Copilot Command without Extension

**Scenario:** User executes command but Copilot is not installed.

**When clause in package.json:**
```json
{
  "command": "bays.addToCopilotChat",
  "when": "view == bays && bays.copilotAvailable"
}
```

**Runtime check:**
```typescript
await copilotService.addFileToChat(uri);
// → CopilotService.isAvailable() → false
// → return false (shows no error)
```

**Result:** Command hidden in UI if Copilot not available.

### 5. Close All Editors Delegation

**Scenario:** User executes "Close All" from Bays view.

**Delegation to VS Code:**
```typescript
vscode.commands.registerCommand('bays.closeAll', async () => {
  await vscode.commands.executeCommand(VSCODE_COMMANDS.CLOSE_ALL_EDITORS);
  // VSCODE_COMMANDS.CLOSE_ALL_EDITORS = 'workbench.action.closeAllEditors'
});
```

**Reason:** VS Code handles correct closing, Bays sync automatically via listeners.

### 6. Toggle Compact Mode (Configuration)

**Scenario:** User changes compactMode from command palette.

**Config update:**
```typescript
const cfg = vscode.workspace.getConfiguration('bays');
const current = cfg.get<boolean>('compactMode', false);

// Toggle
await cfg.update('compactMode', !current, vscode.ConfigurationTarget.Global);
```

**Propagation:**
```
1. Config change fires onDidChangeConfiguration
2. BaysWebviewProvider listens to event
3. Refresh webview with new style
```

---

## REAL OBSERVED EXAMPLES

### Example 1: Open Bay from Webview

```yaml
User Action:
  Click on bay "extension.ts" in webview

Webview Message:
  {
    command: 'openBay',
    bayId: 'file:///c:/project/src/extension.ts-1'
  }

Command Execution:
  1. Webview calls: vscode.commands.executeCommand('bays.openBay', bayId)
  
  2. Command handler:
     const bay = resolve('file:///c:/project/src/extension.ts-1')
     → stateService.fetchBayById('file:///c:/project/src/extension.ts-1')
     → Bay instance
  
  3. Validation:
     if (bay) → true
  
  4. Delegation:
     await bay.activate()
     → Opens file in editor at viewColumn 1

Result:
  File opens, becomes active, webview updates to show active state
```

### Example 2: Close Others

```yaml
User Action:
  Right-click bay "app.ts" → "Close Others"

Command Execution:
  1. Command: 'bays.closeOthers'
     bayId: 'file:///src/app.ts-1'
  
  2. Resolve bay:
     bay = Bay instance for app.ts
  
  3. Delegation:
     await bay.closeOthers()
     → Calls closeActions.closeOthers(metadata, state)
     → Closes all tabs except app.ts in same group

Result:
  Only app.ts remains open in group
```

### Example 3: Pin Bay

```yaml
User Action:
  Click pin icon on bay "config.json"

Command Execution:
  1. Command: 'bays.pinBay'
     bayId: 'file:///config.json-1'
  
  2. Resolve:
     bay = Bay instance
  
  3. Delegation:
     await bay.pin()
     → bay.state.isPinned = true
     → stateService.updateBay(bay)
     → BaysWebviewProvider refreshes
  
  4. UI updates:
     - Pin icon changes to "unpin"
     - Bay stays at top of list
     - Can't be closed by "Close Others"

Result:
  Bay pinned, UI reflects change immediately
```

### Example 4: Move to Group (QuickPick)

```yaml
User Action:
  Right-click bay → "Move to Group..."

Command Execution:
  1. Command: 'bays.moveToGroup'
     bayId: 'file:///readme.md-1'
  
  2. Resolve bay:
     bay = Bay { viewColumn: 1 }
  
  3. Get available groups:
     groups = [
       { viewColumn: 1 },  ← current (skip)
       { viewColumn: 2 },
       { viewColumn: 3 }
     ]
  
  4. Build options:
     options = [
       { label: 'Group 2', viewColumn: 2 },
       { label: 'Group 3', viewColumn: 3 }
     ]
  
  5. Show QuickPick:
     User selects: "Group 2"
  
  6. Execute move:
     await bay.moveToGroup(2)
     → Closes in group 1
     → Opens in group 2
     → New ID: 'file:///readme.md-2'

Result:
  Bay moved to group 2, webview refreshes
```

### Example 5: Add to Copilot Chat (Single File)

```yaml
User Action:
  Click Copilot icon on bay "utils.ts"

Command Execution:
  1. Command: 'bays.addToCopilotChat'
     bayId: 'file:///src/utils.ts-1'
  
  2. Resolve bay:
     bay = Bay { uri: 'file:///src/utils.ts' }
  
  3. Delegation:
     await copilotService.addFileToChat(bay.metadata.uri)
     → Opens Copilot Chat
     → Attaches file
     → Updates bay.state.integrations.copilot

Result:
  - Copilot Chat opens with file attached
  - Bay shows Copilot badge
```

### Example 6: Add Multiple to Copilot Chat

```yaml
User Action:
  Command Palette → "Bays: Add Multiple to Copilot Chat"

Command Execution:
  1. Command: 'bays.addMultipleToCopilotChat' (no args)
  
  2. Get all bays:
     allBays = stateService.fetchAllBays()
     → [bay1, bay2, bay3, ...]
  
  3. Delegation:
     await copilotService.addMultipleFiles(allBays)
     → Shows QuickPick (multi-select)
     → User selects: [bay1, bay3]
     → Batch attach to Copilot Chat

Result:
  - Copilot Chat opens with 2 files attached
  - Both bays show Copilot badge
```

### Example 7: Toggle Compact Mode

```yaml
User Action:
  Command Palette → "Bays: Toggle Compact Mode"

Command Execution:
  1. Command: 'bays.toggleCompactMode' (no args)
  
  2. Read current config:
     cfg = vscode.workspace.getConfiguration('bays')
     current = cfg.get('compactMode')  → false
  
  3. Toggle:
     await cfg.update('compactMode', true, Global)
  
  4. Config change propagation:
     onDidChangeConfiguration fires
     → BaysWebviewProvider.refresh()
     → HTML rebuild with compact styles

Result:
  - Bay rows change to 28px height
  - Single-line layout
  - Setting persisted globally
```

### Example 8: Invalid Bay ID (Race Condition)

```yaml
Scenario:
  1. User clicks bay
  2. Before command executes, bay is closed
  3. Command executes with stale ID

Command Execution:
  1. Command: 'bays.openBay'
     bayId: 'file:///deleted.ts-1'
  
  2. Resolve:
     bay = resolve('file:///deleted.ts-1')
     → stateService.fetchBayById('file:///deleted.ts-1')
     → undefined (bay was removed)
  
  3. Validation:
     if (bay) → false
     // Skip execution

Result:
  - No error shown
  - Command silently skips
  - UI already updated (bay removed)
```

---

## DEBUGGING TIPS

**Check command registration:**
```typescript
// Check if command is registered
const commands = await vscode.commands.getCommands();
console.log('bays.openBay registered:', commands.includes('bays.openBay'));
```

**Check Bay resolution:**
```typescript
const bayId = 'file:///path-1';
const bay = stateService.fetchBayById(bayId);
console.log('Bay resolved:', bay ? 'yes' : 'no');
console.log('Bay details:', bay?.metadata.label);
```

**Execute command manually:**
```typescript
// From debug console or extension code
await vscode.commands.executeCommand('bays.openBay', 'file:///path-1');
await vscode.commands.executeCommand('bays.toggleCompactMode');
```

**Check when clause:**
```typescript
// Check context keys
const copilotAvailable = vscode.extensions.getExtension('github.copilot-chat') !== undefined;
await vscode.commands.executeCommand('setContext', 'bays.copilotAvailable', copilotAvailable);
```

---

## RESPONSIBILITY LIMITS

**This module MUST NOT:**
- Implement business logic (models/actions/)
- Manage Bays state (services/core/)
- Execute file operations directly (uses Bay methods)
- Render UI or HTML (providers/)
- Synchronize with VS Code Tab API (services/core/BaySyncService)

**This module MUST:**
- Register commands in VS Code
- Resolve Bay ID string → Bay instance
- Validate arguments before delegation
- Delegate to Bay methods or services
- Handle global commands (saveAll, closeAll, config changes)
- Show basic UI (QuickPick, InformationMessage)

---

## PERFORMANCE CONSIDERATIONS

**Command execution:**
- **Resolve is O(1)** - Map lookup in BayStateService
- **Validation before execution** - Avoids unnecessary errors
- **Consistent async/await** - Does not block UI thread
- **Thin wrappers** - Minimal overhead over Bay methods

**No performance concerns:**
- Commands executed by user action (no loops)
- Registration once in activate()
- No cache needed (BayStateService already caches)
