# Diagramas de Arquitectura

## Arquitectura Actual vs Propuesta

### 🔴 Arquitectura Actual (Monolítica)

```
┌─────────────────────────────────────────────────────────┐
│                    TabSyncService                       │
│                    (~1000 líneas)                       │
├─────────────────────────────────────────────────────────┤
│ • handleTabChanges()         [Event handler]            │
│ • syncAll()                  [Full sync]                │
│ • convertToSideTab()         [~400 líneas]              │
│ • classifyDiffType()         [~80 líneas]               │
│ • syncActiveState()          [~120 líneas]              │
│ • removeOrphanedTabs()       [~40 líneas]               │
│ • ensureParentExists()       [~70 líneas]               │
│ • inheritParentState()       [~15 líneas]               │
│ • updateActiveTab()                                     │
│ • updateTabDiagnostics()                                │
│ • calculateDiffStats()                                  │
│ • generateId()                                          │
│ • getDiagnosticSeverity()                               │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│                   TabStateService                       │
│                                                         │
│ • addTab()                                              │
│ • removeTab()      ❌ No actualiza parent               │
│ • updateTab()                                           │
│ • getTab()                                              │
│ • getAllTabs()                                          │
│                                                         │
│ PROBLEMA: No conoce jerarquía parent-child              │
└─────────────────────────────────────────────────────────┘
```

**Problemas:**
- ❌ TabSyncService hace demasiado
- ❌ Difícil testear (muchas dependencias)
- ❌ `hasChildren` nunca se actualiza
- ❌ `childrenCount` siempre en 0
- ❌ Eliminar child no actualiza parent
- ❌ Alta complejidad ciclomática

---

### 🟢 Arquitectura Propuesta (Pragmática)

```
┌────────────────────────────────────────────────────────────────┐
│                     TabSyncService                             │
│                     (~300 líneas)                              │
│                     [Orquestador]                              │
├────────────────────────────────────────────────────────────────┤
│ • activate()              - Inicialización                     │
│ • handleTabChanges()      - Event handler                      │
│ • handleGroupChanges()    - Event handler                      │
│ • syncAll()               - Full sync orchestration            │
│ • ensureParentExists()    - Parent creation                    │
│ • dispose()               - Cleanup                            │
└───────┬────────────────────────────────────────────────────────┘
        │
        │ Delega a módulos especializados:
        │
        ├─────────────────────────────────────────────────┐
        │                                                 │
       ↓                                                 ↓
┌──────────────────┐                         ┌──────────────────────┐
│  TabConverter    │                         │  TabHierarchyService │
│  (~200 líneas)   │                         │   (~150 líneas)      │
├──────────────────┤                         ├──────────────────────┤
│ • convert()      │                         │ • registerChild()    │
│ • generateId()   │                         │ • unregisterChild()  │
│ • getDiagnostic  │                         │ • getChildren()      │
│   Severity()     │                         │ • inheritState()     │
└──────────────────┘                         │ • recalculateAll     │
        ↑                                    │   Counts()           │
        │ usa                                └──────────────────────┘
┌──────────────────┐                                  ↓
│  TabClassifier   │                                  │
│  (~120 líneas)   │                         ┌────────┴─────────┐
├──────────────────┤                         │  TabStateService │
│ • classifyDiff   │                         │   (enhanced)     │
│   Type()         │                         ├──────────────────┤
│ • determineParent│                         │ • addTab()       │
│   Id()           │◄───────────┐           │ • removeTab()    │
└──────────────────┘             │           │   ✅ Actualiza  │
                                 │           │      parent      │
┌──────────────────┐             │           │ • getTabTree()   │
│ ActiveStateSync  │             │           │ • setHierarchy   │
│  (~120 líneas)   │             │           │   Service()      │
├──────────────────┤             │           └──────────────────┘
│ • syncAll()      │             │
│ • detectActive   │             │
│   MarkdownPreview│             │
│ • updateActive   │             │
│   StateForGroup()│             │
└──────────────────┘             │
                                 │
┌──────────────────┐             │
│  OrphanCleaner   │             │
│  (~80 líneas)    │             │
├──────────────────┤             │
│ • removeOrphaned │─────────────┘
│   Tabs()         │   consulta clasificación
│ • removeTab()    │
│ • collectNative  │
│   TabIds()       │
└──────────────────┘
```

**Beneficios:**
- ✅ Cada módulo < 200 líneas
- ✅ Responsabilidad única
- ✅ Fácil testear (mocks simples)
- ✅ Jerarquía sincronizada siempre
- ✅ `hasChildren` y `childrenCount` actualizados
- ✅ Baja complejidad ciclomática

---

## Flujo de Datos: Añadir Tab con Child

### 🔴 Flujo Actual (Problemático)

```
VS Code Tab Opened
        ↓
TabSyncService.handleTabChanges()
        ↓
convertToSideTab(tab)
        ↓
    ┌───────────────────┐
    │ Si parentId existe│
    └───────────────────┘
            ↓
    ensureParentExists(childTab, tab)  ← Async (no se espera)
            ↓
    this.stateService.addTab(childTab)  ← ⚠️ Se ejecuta inmediatamente
            ↓
    ❌ Child añadido ANTES que parent
    ❌ hasChildren del parent nunca se actualiza
    ❌ childrenCount del parent queda en 0
```

### 🟢 Flujo Propuesto (Correcto)

```
VS Code Tab Opened
        ↓
TabSyncService.handleTabChanges()
        ↓
TabConverter.convert(tab)
        ↓
┌────────────────────┐
│ Si parentId existe │
└────────────────────┘
        ↓
    await ensureParentExists(childTab, tab)  ← ✅ Se espera
        ↓
    TabHierarchyService.inheritState(child, parent)
        ↓
    TabHierarchyService.registerChild(child.id, parent.id)
        ↓
┌────────────────────────────────────┐
│ Parent actualizado:                │
│ • hasChildren = true               │
│ • childrenCount++                  │
└────────────────────────────────────┘
        ↓
TabStateService.addTab(childTab)
        ↓
✅ Child añadido DESPUÉS del parent
✅ Parent actualizado correctamente
✅ Estado consistente
```

---

## Jerarquía de Tabs: Ejemplo Visual

```
┌─────────────────────────────────────────────────────────────┐
│ Group 1                                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  extension.ts                                 [Parent]      │
│     ├─ isPinned: false                                      │
│     ├─ hasChildren: true                                    │
│     └─ childrenCount: 2                                     │
│                                                             │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│                                                             │
│  Working Tree                               [Child #1]      │
│     ├─ parentId: "extension.ts-1"                           │
│     ├─ diffType: "working-tree"                             │
│     ├─ diffStats: { +15, -3 }                               │
│     └─ NO hereda gitStatus/diagnostics                      │
│                                                             │
│  Staged Changes                             [Child #2]      │
│     ├─ parentId: "extension.ts-1"                           │
│     ├─ diffType: "staged"                                   │
│     ├─ diffStats: { +8, -2 }                                │
│     └─ NO hereda gitStatus/diagnostics                      │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TabSyncService.ts                            [Parent]      │
│     ├─ isPinned: true                                       │
│     ├─ hasChildren: false                (No children)      │
│     ├─ childrenCount: 0                                     │
│     └─ capabilities.canExpand: false                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  README.md                                    [Parent]      │
│     ├─ isPinned: false                                      │
│     ├─ hasChildren: true                                    │
│     └─ childrenCount: 1                                     │
│                                                             │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│                                                             │
│  Snapshot                           14:30      [Child]      │
│                                                             │
│  Copilot Edit                      +12 -3      [Child]      │
│                                                             │
│  Compare to README.backup.md                   [Child]      │
│                                                             │
│  Compare to README.backup.md                   [Child]      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## UI de Jerarquía Parent-Child

```
┌────────────────────────────────────────────────────────────┐
│ Visualización normal (parent activo):                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│┃ extension.ts  ← Borde 5px izquierdo            [✕]      │
│     ├─ Working Tree    +15 -3                    [──]      │
│     ├─ Staged Changes  +8 -2                     [──]      │
│     └─ Snapshot 14:30  2h ago                    [──]      │
│                                                            │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ Child activo (parent sigue visualmente activo):            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  extension.ts ← Activo pero SIN borde 5px       [✕]      │
│┃    ├─ Working Tree    +15 -3  ← Borde aquí     [──]      │
│     ├─ Staged Changes  +8 -2                     [──]      │
│     └─ Snapshot 14:30  2h ago                    [──]      │
│                                                            │
└────────────────────────────────────────────────────────────┘

Notas:
- Los children siempre se muestran visibles bajo su parent
- Children NO tienen bay-actions, solo botón cerrar con codicon 'dash'
- Cuando un child está activo, el parent mantiene apariencia activa
- El borde izquierdo de 5px pasa del parent al child activo
```

---

## Secuencia de Actualización de Estado

```
┌───────────────────┐
│ User clicks       │
│ "Open Working     │
│ Tree"             │
└─────────┬─────────┘
          │
          ↓
┌───────────────────────────────────────────────────────────┐
│ VS Code abre diff tab                                     │
│ TabInputTextDiff { original: uri, modified: uri }         │
└─────────┬─────────────────────────────────────────────────┘
          │
          ↓
┌───────────────────────────────────────────────────────────┐
│ onDidChangeTabs event disparado                           │
│ e.opened = [diffTab]                                      │
└─────────┬─────────────────────────────────────────────────┘
          │
          ↓
┌───────────────────────────────────────────────────────────┐
│ TabSyncService.handleTabChanges(e)                        │
│ for (tab of e.opened) { ... }                             │
└─────────┬─────────────────────────────────────────────────┘
          │
          ↓
┌───────────────────────────────────────────────────────────┐
│ TabConverter.convert(diffTab)                             │
│ ├─ TabClassifier.classifyDiffType()                       │
│ │  └─ return 'working-tree'                               │
│ ├─ TabClassifier.determineParentId()                      │
│ │  └─ return 'file:///path/extension.ts-1'                │
│ └─ return SideTab {                                       │
│      metadata: { parentId: '...', diffType: ... },        │
│      state: { isChild: true, hasChildren: false }         │
│    }                                                      │
└─────────┬─────────────────────────────────────────────────┘
          │
          ↓
┌───────────────────────────────────────────────────────────┐
│ if (sideTab.metadata.parentId) {                          │
│   await ensureParentExists(sideTab, diffTab)              │
│ }                                                         │
└─────────┬─────────────────────────────────────────────────┘
          │
          ↓ (parent existe)
          │
┌───────────────────────────────────────────────────────────┐
│ TabHierarchyService.inheritState(child, parent)           │
│ ├─ Si parent es MD: child.state.viewMode = parent.viewMode│
│ ├─ NO se heredan gitStatus, diagnostics ni iconos         │
│ └─ calculateDiffStats(child)                              │
└─────────┬─────────────────────────────────────────────────┘
          │
          ↓
┌───────────────────────────────────────────────────────────┐
│ TabHierarchyService.registerChild(child.id, parent.id)    │
│ ├─ parent.state.hasChildren = true                        │
│ ├─ parent.state.childrenCount++                           │
│ └─ stateService.updateTab(parent)                         │
└─────────┬─────────────────────────────────────────────────┘
          │
          ↓
┌───────────────────────────────────────────────────────────┐
│ TabStateService.addTab(childTab)                          │
│ ├─ tabs.set(child.id, child)                              │
│ └─ onDidChangeState.fire()                                │
└─────────┬─────────────────────────────────────────────────┘
          │
          ↓
┌───────────────────────────────────────────────────────────┐
│ WebviewProvider.refresh()                                 │
│ └─ Rebuild HTML con parent actualizado                    │
└───────────────────────────────────────────────────────────┘
          │
          ↓
┌───────────────────────────────────────────────────────────┐
│ UI muestra:                                               │
│ � extension.ts                                            │
│    └─ 🔄 Working Tree             +15 -3                 │
└───────────────────────────────────────────────────────────┘
```

---

## Testing: Estrategia Modular

```
┌─────────────────────────────────────────────────────────┐
│ UNIT TESTS (aislados)                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ TabConverter.test.ts                                    │
│ ├─ should convert file tab correctly                    │
│ ├─ should convert diff tab with parentId                │
│ ├─ should handle webview tabs (uri: undefined)          │
│ └─ should generate stable IDs                           │
│                                                         │
│ TabClassifier.test.ts                                   │
│ ├─ should classify 'working-tree' correctly             │
│ ├─ should classify 'staged' correctly                   │
│ ├─ should classify 'snapshot' by timestamp pattern      │
│ └─ should determine parentId for diff tabs              │
│                                                         │
│ TabHierarchyService.test.ts                             │
│ ├─ should register child and update parent counts       │
│ ├─ should unregister child and decrement counts         │
│ ├─ should inherit state from parent to child            │
│ └─ should recalculate all counts correctly              │
│                                                         │
│ tabConverter.test.ts                                    │
│ ├─ should convert TabInputText to SideTab               │
│ ├─ should convert TabInputDiff to SideTab               │
│ ├─ should generate unique IDs correctly                 │
│ └─ should return null for unsupported types             │
│                                                         │
│ tabClassifier.test.ts                                   │
│ ├─ should classify Working Tree diffs                   │
│ ├─ should classify Staged diffs                         │
│ ├─ should determine parent ID correctly                 │
│ └─ should return undefined for non-child tabs           │
│                                                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ INTEGRATION TESTS                                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ TabSyncService.integration.test.ts                      │
│ ├─ should sync all tabs with correct hierarchy          │
│ ├─ should handle tab open/close events                  │
│ ├─ should ensure parent exists for orphan children      │
│ └─ should maintain consistent state across operations   │
│                                                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ E2E TESTS                                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ├─ should show correct hierarchy in webview             │
│ └─ should handle rapid tab operations                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

**Creado:** 22 de febrero de 2026  
**Autor:** Dr. Tabs (Copilot Agent)
