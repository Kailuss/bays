# Diagramas de Arquitectura

> Verificado contra el código de la rama `developer` (2026-07-24). Los identificadores
> (servicios, métodos, mensajes host↔webview, atributos DOM) reflejan el código actual.
> El dominio usa el término **"Bay"** (nunca "Tab"): cada Bay es una pestaña de VS Code.

## Arquitectura actual (modular)

La arquitectura es **modular**. `BaySyncService` NO es un monolito: es un orquestador
delgado que delega en subservicios especializados. Históricamente existió un
`TabSyncService` de ~1000 líneas que concentraba conversión, clasificación, jerarquía y
limpieza; esa etapa ya no existe.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              extension.ts                                  │
│  Cablea los servicios en orden y registra el WebviewViewProvider.          │
│  BayStateService → GroupCustomizationService → BaySyncService →            │
│  BayDragDropService → FileActionRegistry → BayIconManager → ThemeService → │
│  CopilotService → GroupActions → BaysWebviewProvider → ClaudeConversation  │
└──────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                            BaySyncService                                  │
│                     [Orquestador delgado]                                  │
│  • activate(context)     - registra listeners vía BayEventService          │
│  • resyncAll()           - resincronización total                          │
│  • updateActiveTab()     - recomputa activo                                │
│  • handleCursorChange()  - sincroniza cursor bay↔variantes                 │
│  • updateTabDiagnostics()- severidad de diagnósticos por uri               │
│  • dispose()                                                               │
└───────┬────────────────────────────────────────────────────────────────────┘
        │ delega en (6 colaboradores):
        │
        ├──────────────────┬──────────────────┬──────────────────────────────┐
        ↓                  ↓                  ↓                              │
┌────────────────┐ ┌────────────────┐ ┌────────────────────┐                │
│ BayEventService│ │  BayHeadService│ │ ActiveStateService │                │
│ (bay/)         │ │  (bay/)        │ │ (bay/)             │                │
├────────────────┤ ├────────────────┤ ├────────────────────┤                │
│ • activate()   │ │ • ensureParent │ │ • syncActiveState()│                │
│ • handleFiles  │ │   Exists()     │ │ • removeOrphaned   │                │
│   Renamed()    │ │ • ensureParent │ │   Tabs()           │                │
│ • handleFiles  │ │   ExistsForSync│ └────────────────────┘                │
│   Deleted()    │ │ • buildParent  │                                       │
│ • handleGroup  │ │   Bay()        │                                       │
│   Changes()    │ └────────────────┘                                       │
└────────────────┘                                                          │
        │                                                                   │
        ├──────────────────┬──────────────────────────────┐                │
        ↓                  ↓                              ↓                │
┌────────────────────┐ ┌────────────────┐ ┌────────────────────┐          │
│ BayHierarchyService│ │  GitSyncService│ │  DocumentManager   │◄─────────┘
├────────────────────┤ ├────────────────┤ ├────────────────────┤
│ • inheritState()   │ │ • estado git   │ │ • documentos y     │
│ • variantCount /   │ │   por bay      │ │   metadatos        │
│   hasVariant       │ └────────────────┘ └────────────────────┘
│ • sync de cursor   │
└────────────────────┘

Funciones puras (helpers), sin estado, fáciles de testear:
┌──────────────────────────────────┐   ┌──────────────────────────────────┐
│ services/core/helpers/           │   │ services/core/helpers/           │
│ tabConverter.ts                  │   │ tabClassifier.ts                 │
├──────────────────────────────────┤   ├──────────────────────────────────┤
│ • convertToBay(nativeTab)        │   │ • classifyDiffType()             │
│ • generateId() / generateVariant │   │ • determineParentId()            │
│   Id()                           │   │ • determineParentUri()           │
│ • remapFileBayUri()  (rename)    │   │ • resolveSourceUri()             │
│ • getDiagnosticSeverity()        │   └──────────────────────────────────┘
└──────────────────────────────────┘
        (la lógica de BayHelpers.ts vive en src/models/BayHelpers.ts)
```

`BaySyncService` inyecta `hierarchyService` y `documentManager` de vuelta en
`BayStateService`. La conversión de pestañas nativas a bays vive en los helpers puros
(`tabConverter`/`tabClassifier`), no en el orquestador.

**Beneficios de la modularidad:**
- Cada subservicio tiene una responsabilidad única y es testeable de forma aislada.
- La jerarquía padre↔variante se mantiene consistente (`hasVariant`/`variantCount`).
- Los helpers puros no dependen del estado global.

---

## Fuente de verdad y bucle de actualización

`BayStateService` es la **fuente de verdad en memoria** (`Map<id, Bay>` + grupos). Sus
mutaciones disparan **cuatro canales de eventos** hacia `BaysWebviewProvider`, cada uno
con una estrategia de actualización distinta.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BayStateService (estado)                           │
└───┬───────────────────┬────────────────────┬───────────────────────┬─────────┘
    │                   │                    │                       │
    │ onDidChange       │ onDidChange        │ onDidChangeBayState   │ onDidChange
    │ State             │ StateSilent        │                       │ BayLabel
    │ (notifyChange)    │ (notifyActive      │ (updateBayState       │ (notifyBay
    │                   │  Change)           │  WithAnimation)       │  LabelChange)
    ↓                   ↓                    ↓                       ↓
┌───────────────┐ ┌───────────────┐ ┌───────────────────┐ ┌───────────────────┐
│ refresh()     │ │refreshSilent()│ │notifyBayState     │ │notifyBayLabel     │
│ debounce 30ms │ │               │ │Changed()          │ │Changed()          │
├───────────────┤ ├───────────────┤ ├───────────────────┤ ├───────────────────┤
│ buildHtml()   │ │ postMessage   │ │ postMessage       │ │ postMessage       │
│ async →       │ │ updateActive  │ │ bayStateChanged   │ │ updateBayLabel    │
│ {html,        │ │ Bay           │ │ {bayId,stateClass,│ │ {bayId, label,…}  │
│  pendingIcons}│ │ {activeBayIds}│ │  stateHtml}       │ │                   │
│ webview.html  │ │ toggle .active│ │ swap .bay-state   │ │ actualiza título  │
├───────────────┤ └───────────────┘ └───────────────────┘ └───────────────────┘
│ RECONSTRUYE   │   parcial            parcial               parcial
│ TODO el DOM   │   (activo)           (git/diagnósticos)    (Claude Code)
└───────────────┘
```

- **`onDidChangeState`** → `refresh()` (debounce **30 ms**, `TIMINGS.WEBVIEW_REFRESH_DEBOUNCE`).
  Reconstrucción estructural completa: asigna `webview.html`. Se dispara al abrir/cerrar
  bay, pin/unpin (reordena), cambio de grupo, cambios de customización de grupo.
- **`onDidChangeStateSilent`** → `refreshSilent()` publica `{type:'updateActiveBay', activeBayIds}`
  (solo alterna `.active`). Lo dispara `notifyActiveChange()`. *(`updateBaySilent()` sigue
  existiendo pero está sin cablear — es código muerto.)*
- **`onDidChangeBayState`** → `notifyBayStateChanged()` publica
  `{type:'bayStateChanged', bayId, stateClass, stateHtml}` (reemplaza el nodo `.bay-state`).
  Lo dispara ÚNICAMENTE `updateBayStateWithAnimation()` (git/diagnóstico de un solo bay).
- **`onDidChangeBayLabel`** → `notifyBayLabelChanged()` publica `{type:'updateBayLabel', …}`.
  Lo dispara `notifyBayLabelChange()` (usado por el enriquecimiento de títulos de Claude Code).

Además: tras el primer pintado, `patchIcons()` publica `{type:'updateIcons', …}` para
intercambiar los iconos diferidos (los iconos resuelven de caché de forma síncrona; los
fallos se difieren). `handleContextMenu()` publica `{type:'showContextMenu', bayId, x, y, items}`.

`BaysHtmlBuilder.buildHtml()` es **async** y devuelve `{html, pendingIcons}`. El HTML se
ensambla desde los renderers: `BayRowRenderer` (filas padre/estándar), `GroupHeaderRenderer`
(etiqueta/color/lock + twisty + botones rename/color/lock), `VariantRowRenderer` (variantes
adjuntas y huérfanas), con `html/IconRenderer` y `html/StylesBuilder` (CSS/CSP).

**Contrato host↔webview (17 mensajes entrantes):** `openBay`, `closeBay`, `closeVariant`,
`pinBay`, `unpinBay`, `addToChat`, `contextMenu`, `menuAction`, `dropBay`, `fileAction`,
`saveAll`, `reorder`, `renameGroup`, `setGroupColor`, `toggleGroupLock`, `toggleCompactMode`,
`refresh`. Los `type` y los nombres de campo deben coincidir exactamente en ambos lados, y
los atributos `data-bay-id` (kebab-case, leídos como `dataset.bayId`) deben coincidir con los
selectores del cliente. Cualquier desajuste descarta la actualización en silencio.

---

## Flujo de datos: añadir una variante (diff) bajo su bay padre

Las **variantes** (diffs, snapshots, staged, etc.) NO son un tipo aparte: son un bay normal
con `bayType:'file'` cuyo `metadata.sourceBayId` apunta al padre y con `metadata.diffType`
fijado. El orden importa: el padre debe existir antes de añadir la variante.

```
VS Code abre un diff tab
        ↓
BayEventService  (listener onDidChangeTabs)
        ↓
convertToBay(nativeTab)          [helper tabConverter.ts]
   ├─ classifyDiffType()          → 'working-tree'          [tabClassifier.ts]
   ├─ determineParentId()         → 'file:///…/extension.ts-1'
   └─ devuelve Bay {
        metadata: { bayType:'file', sourceBayId:'…', diffType:'working-tree' },
        state:    { isVariant:true, hasVariant:false }
      }
        ↓
if (bay.metadata.sourceBayId) {
    await BayHeadService.ensureParentExists(variant, nativeTab)   ← se ESPERA
}
        ↓ (padre garantizado)
BayHierarchyService.inheritState(variant, parent)
   └─ la variante NO hereda gitStatus, diagnósticos ni iconos del padre
        ↓
El padre queda actualizado:
   • parent.state.hasVariant   = true
   • parent.state.variantCount++
   • stateService.updateBay(parent)
        ↓
BayStateService.addBay(variant)   → onDidChangeState.fire()
        ↓
BaysWebviewProvider.refresh()     → buildHtml() reconstruye el DOM con el padre actualizado
        ↓
UI: extension.ts
        └─ Working Tree   +15 -3
```

---

## Jerarquía de bays: ejemplo visual

```
┌─────────────────────────────────────────────────────────────┐
│ Group 1                                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  extension.ts                                 [Padre]      │
│     ├─ isPinned: false                                      │
│     ├─ hasVariant: true                                     │
│     └─ variantCount: 2                                      │
│                                                             │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│                                                             │
│  Working Tree                             [Variante #1]    │
│     ├─ bayType: 'file'                                      │
│     ├─ sourceBayId: "file:///…/extension.ts-1"             │
│     ├─ diffType: "working-tree"                             │
│     ├─ diffStats: { +15, -3 }                               │
│     └─ NO hereda gitStatus/diagnósticos                     │
│                                                             │
│  Staged Changes                           [Variante #2]    │
│     ├─ bayType: 'file'                                      │
│     ├─ sourceBayId: "file:///…/extension.ts-1"             │
│     ├─ diffType: "staged"                                   │
│     ├─ diffStats: { +8, -2 }                                │
│     └─ NO hereda gitStatus/diagnósticos                     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  BaySyncService.ts                            [Padre]      │
│     ├─ isPinned: true                                       │
│     ├─ hasVariant: false                 (sin variantes)   │
│     └─ variantCount: 0                                      │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  README.md                                    [Padre]      │
│     ├─ isPinned: false                                      │
│     ├─ hasVariant: true                                     │
│     └─ variantCount: 1                                      │
│                                                             │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│                                                             │
│  Snapshot                           14:30   [Variante]     │
│                                                             │
│  Copilot Edit                      +12 -3   [Variante]     │
│                                                             │
│  Compare to README.backup.md                [Variante]     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Nota sobre IDs: un bay de archivo usa `` `${uri}-${viewColumn}` ``; un webview usa
`` `${bayType}:${key}-${viewColumn}` `` (con `key` derivado del **viewType estable**, no del
título); una variante/diff usa `` `diff:${modifiedUri}::${original}-${viewColumn}` ``. El mismo
archivo abierto en dos grupos son dos bays distintos.

---

## UI de jerarquía padre-variante

```
┌────────────────────────────────────────────────────────────┐
│ Visualización normal (padre activo):                       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│┃ extension.ts  ← Borde 5px izquierdo            [✕]      │
│     ├─ Working Tree    +15 -3                    [──]      │
│     ├─ Staged Changes  +8 -2                     [──]      │
│     └─ Snapshot 14:30  2h ago                    [──]      │
│                                                            │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ Variante activa (el padre sigue visualmente activo):       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  extension.ts ← Activo pero SIN borde 5px       [✕]      │
│┃    ├─ Working Tree    +15 -3  ← Borde aquí     [──]      │
│     ├─ Staged Changes  +8 -2                     [──]      │
│     └─ Snapshot 14:30  2h ago                    [──]      │
│                                                            │
└────────────────────────────────────────────────────────────┘

Notas:
- Las variantes se renderizan indentadas bajo su padre con la clase CSS `.bay.variant`.
- Las variantes NO tienen bay-actions completas; solo el botón cerrar con codicon 'dash'.
- Cuando una variante está activa, el padre mantiene apariencia activa.
- El borde izquierdo de 5px pasa del padre a la variante activa.
```

---

## Secuencia de actualización de estado

```
┌───────────────────┐
│ El usuario abre   │
│ "Open Working     │
│ Tree"             │
└─────────┬─────────┘
          ↓
┌───────────────────────────────────────────────────────────┐
│ VS Code abre un diff tab                                  │
│ TabInputTextDiff { original: uri, modified: uri }         │
└─────────┬─────────────────────────────────────────────────┘
          ↓
┌───────────────────────────────────────────────────────────┐
│ onDidChangeTabs → BayEventService                         │
│ e.opened = [diffTab]                                      │
└─────────┬─────────────────────────────────────────────────┘
          ↓
┌───────────────────────────────────────────────────────────┐
│ convertToBay(diffTab)                     [tabConverter]  │
│ ├─ classifyDiffType()      → 'working-tree'  [tabClassif] │
│ ├─ determineParentId()     → 'file:///…/extension.ts-1'  │
│ └─ Bay { metadata:{ sourceBayId, diffType, bayType:'file'},│
│          state:{ isVariant:true, hasVariant:false } }     │
└─────────┬─────────────────────────────────────────────────┘
          ↓
┌───────────────────────────────────────────────────────────┐
│ if (bay.metadata.sourceBayId)                             │
│   await BayHeadService.ensureParentExists(bay, diffTab)   │
└─────────┬─────────────────────────────────────────────────┘
          ↓ (el padre existe)
┌───────────────────────────────────────────────────────────┐
│ BayHierarchyService.inheritState(variant, parent)         │
│ └─ NO se heredan gitStatus, diagnósticos ni iconos        │
└─────────┬─────────────────────────────────────────────────┘
          ↓
┌───────────────────────────────────────────────────────────┐
│ parent.state.hasVariant = true; variantCount++            │
│ stateService.updateBay(parent)                            │
└─────────┬─────────────────────────────────────────────────┘
          ↓
┌───────────────────────────────────────────────────────────┐
│ BayStateService.addBay(variant)                           │
│ └─ onDidChangeState.fire()                                │
└─────────┬─────────────────────────────────────────────────┘
          ↓
┌───────────────────────────────────────────────────────────┐
│ BaysWebviewProvider.refresh()  (debounce 30ms)            │
│ └─ buildHtml() async → {html, pendingIcons}; webview.html │
└─────────┬─────────────────────────────────────────────────┘
          ↓
┌───────────────────────────────────────────────────────────┐
│ UI muestra:                                               │
│   extension.ts                                            │
│      └─ Working Tree             +15 -3                   │
└───────────────────────────────────────────────────────────┘
```

---

## Subsistema: pestañas de Claude Code (`ClaudeConversationService`)

VS Code solo expone el título truncado de la pestaña de Claude Code
(`aiTitle.slice(0,24)+"…"`). `ClaudeConversationService`
(`src/services/integration/ClaudeConversationService.ts`) recupera el título COMPLETO
leyendo los transcripts JSONL de Claude.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ClaudeConversationService                                                 │
├──────────────────────────────────────────────────────────────────────────┤
│ Detección:  static isClaudeConversationBay(bay)                           │
│   bayType==='webview' && viewType(lower).includes('claudevscodepanel')    │
│   • chat panel   : mainThreadWebview-claudeVSCodePanel                     │
│   • plan preview : mainThreadWebview-claudePlanPreview                     │
├──────────────────────────────────────────────────────────────────────────┤
│ Fuente del título completo:                                               │
│   ~/.claude/projects/<workspace-slug>/<sessionId>.jsonl                   │
│   (slug = ruta con ':' '\' '/' → '-')                                     │
│   Escanea la cola de 256KB de hasta 24 transcripts más recientes;         │
│   el 'custom-title' más nuevo gana al 'ai-title'; empareja la pestaña     │
│   quitando el '…' final + startsWith (solo coincidencias únicas);         │
│   cacheado por mtime.                                                      │
├──────────────────────────────────────────────────────────────────────────┤
│ enrichLabels(bays) muta label/tooltipText y devuelve los ids cambiados    │
│   → stateService.notifyBayLabelChange(id)  → canal onDidChangeBayLabel     │
│   fs.watch (debounce 800ms) sobre los dirs de transcripts re-dispara.     │
│   extension.ts corre enrichClaudeTitles() single-flight en                │
│   onDidChangeState, en escrituras de transcripts y al arrancar.           │
└──────────────────────────────────────────────────────────────────────────┘
```

`BayEventService` excluye explícitamente las pestañas de chat de Claude del refresco
genérico de etiquetas de webview para que no compitan. Iconos: el registro
`webviewExtensionIcons` mapea el viewType que contiene `claude` a la extensión
`anthropic.claude-code` (`resources/claude-logo.svg` como `<img>` base64 inline); codicon de
respaldo `sparkle` (panel) o `checklist` (plan preview).

---

## Subsistema: personalización de grupos (rename / color / lock)

Archivos: `src/models/BayGroup.ts`, `src/services/ui/GroupCustomizationService.ts`,
`src/providers/GroupActions.ts`, `src/commands/groupCommands.ts`,
`src/providers/renderers/GroupHeaderRenderer.ts`.

```
BayGroup { label:"Group N", customLabel?, color:BayGroupColor, isLocked }
   GROUP_COLORS = ['blue','green','yellow','orange','red','purple']
   defaultGroupColor(viewColumn)  reparte color por columna
   getGroupLabel(group) = customLabel?.trim() || label
   (los colores mapean a tokens --vscode-charts-*  → siguen el tema)

Persistencia: context.workspaceState clave 'bays.groupCustomizations'
   Record<string, {label?, color?, locked?}> indexado por viewColumn (string)
   (VS Code no expone un id de grupo estable → la customización se ancla a la columna)

Comandos → GroupActions → stateService.refreshGroupCustomizations():
   bays.renameGroup     → rename()     input box, tope 60 chars, vacío = restaura default
   bays.setGroupColor   → pickColor()  QuickPick "Auto" + 6 colores
   bays.toggleGroupLock → toggleLock()
   (cada uno recibe un id numérico de grupo o cae al grupo activo)

GroupHeaderRenderer emite:
   <div class="group-header" data-groupid data-color data-locked>
     + twisty de colapso (data-action="toggleGroup", cliente)
     + botones rename / color / lock

Semántica de lock: un grupo bloqueado no ofrece items de cierre ni "Close Group"
   en su menú contextual; la X por bay queda oculta.
```

---

## Subsistema: menú "View Options" (view/title)

En `package.json`, la barra de título de la vista (`view/title`) contiene:

```
navigation@1 : bays.saveAll        (icono $(save-all))
               when: view==bays && bays.hasUnsavedBays
navigation@2 : bays.viewOptions    (submenú, label "View Options", icono $(settings))
                 ├─ bays.toggleCompactMode  → alterna bays.compactMode  (Global)
                 └─ bays.toggleShowPath     → alterna bays.showFilePath  (Global)

bays.saveAll → vscode.workspace.saveAll(false)
El context key bays.hasUnsavedBays se recalcula en tabGroups.onDidChangeTabs.
```

---

## Subsistema: sincronización de rename / move / delete de archivos

`BayEventService` escucha `workspace.onDidRenameFiles` y `workspace.onDidDeleteFiles` para
que los bays abiertos reflejen los cambios del sistema de archivos.

```
onDidRenameFiles → handleFilesRenamed(event)
   Encuentra bays afectados con isSameOrUnder (mismo scheme+authority, ruta igual o bajo base+'/')
   ┌─ ¿algún bay afectado es variante o padre-con-variantes (sourceBayId || hasVariant)?
   │     SÍ → resyncAll()   (resincronización total, más segura)
   │     NO ↓
   └─ remapFileBayUri()  [tabConverter] reconstruye el bay de forma determinista:
         nuevo id `${newUri}-${viewColumn}`, re-deriva label/pathParts/tooltip/ext/languageId,
         git + diagnósticos frescos, arrastra los flags nativos
         (NUNCA lee la pestaña nativa)  → stateService.rekeyBay(oldId, fresh)
      Colisión de id → resyncAll()

onDidDeleteFiles → handleFilesDeleted(event)
   Purga bays de archivo top-level bajo la uri borrada que ya no tienen pestaña nativa viva
   (findNativeTabByUri). Omite variantes y bays que VS Code mantuvo abiertos (sin guardar).

Cambios estructurales de grupo (split abrir/cerrar → renumera viewColumns → ids inválidos)
   → handleGroupChanges → resyncAll()
```

---

## Subsistema: menú contextual propio (`BayContextMenu` + `contextmenu.js`)

El menú contextual de un bay es una réplica hecha a mano del menú nativo de Monaco (un
QuickPick se renderiza centrado-arriba, no en el cursor).

```
Click derecho en .bay
   webview → host  { type:'contextMenu', bayId, x, y }   (se suprime en group-header)
        ↓
BayContextMenu.build(bay)  construye MenuItem[]
        ↓
host → webview  { type:'showContextMenu', bayId, x, y, items }
        ↓
BaysContextMenu.show({x, y, items, onSelect})   [contextmenu.js]
        ↓
onSelect(actionId)  →  webview → host  { type:'menuAction', bayId, actionId }
        ↓
BayContextMenu.execute(actionId, bay)

MenuItem = {type:'separator'} | {id, label, icon?, keybinding?, enabled?, tooltip?, submenu?}

Items condicionales de build(bay):
  • (grupo bloqueado → sin items de cierre) si no: Close / Close Others / Close to the Right
  • Pin  ó  Unpin
  • (varios grupos y desbloqueado → Close Group)
  • (bay con uri → Reveal in Explorer View / Reveal in File Explorer / Open Timeline /
     Copy Relative Path / Copy Path / Copy File Contents / Duplicate File /
     Compare with Active Editor / Open Changes / Split Right / Move to New Window)
  • (uri + copilot disponible → Add to Copilot Chat)

contextmenu.js (BaysContextMenu): menú vivo único, submenús anidados (hover 250ms),
  colocación consciente del viewport, navegación por teclado + typeahead, regla de icono
  de líder de grupo (solo el primer item tras un separador dibuja icono), overlay que
  cierra al hacer scroll/resize/blur.
```

---

## Testeo

El código está estructurado para ser testeable, pero la suite actual es mínima. Los helpers
`tabConverter.ts` y `tabClassifier.ts` son **funciones puras** sin estado (candidatas
naturales a tests unitarios: `convertToBay`, `classifyDiffType`, `determineParentId`,
`generateId`, `remapFileBayUri`), y los subservicios (`BayHierarchyService`,
`ActiveStateService`, `BayHeadService`) tienen responsabilidad única con dependencias
inyectables.

```
Estado actual:
  src/test/extension.test.ts   → un único "Sample test" (suite de arranque)

Ejecución (ver CLAUDE.md):
  npm test   → pretest compila tests+extensión+lint y corre @vscode/test-cli
              sobre out/test/**/*.test.js
  Un solo test: añadir .only al it/describe, o npx vscode-test --grep "<patrón>"
```

Nota: no existen (todavía) archivos de test por módulo (`tabConverter.test.ts`, etc.); son
una oportunidad futura, no parte del código actual.

---

**Verificado:** 24 de julio de 2026 (rama `developer`)
