# providers/ - WebView Rendering Module

## MODULE PURPOSE

This module is exclusively responsible for the **visual presentation** of Bays in VS Code.
It converts Bay state (from BayStateService) into HTML/CSS embedded in a WebviewView.
It implements the bidirectional communication protocol between the webview (plain JavaScript) and the extension (TypeScript).

**Exact responsibilities:**
- Generate the full webview HTML using specialized renderers
- Manage messages (postMessage/onDidReceiveMessage) between webview and extension
- Orchestrate incremental rendering (full refresh vs silent update)
- Resolve assets (icons, CSS, scripts) with correct webview URIs
- Maintain a strict Content Security Policy (CSP)

**NOT responsible for:**
- Synchronization with VS Code Tab API (see services/core/)
- Bay state logic (see models/)
- Detection of native tab changes (see services/core/BaySyncService)
- File or system operations (see models/actions/)

---

## TECHNICAL INVARIANTS

1. **The webview has NO direct access to the vscode API** – all communication is async via messages
2. **HTML always escapes attributes using `escapeHtml()`** – prevents XSS in Bay IDs/labels
3. **Bay IDs use `CSS.escape()` in selectors in webview.js** – they contain special characters (`://`)
4. **Assets use `webview.asWebviewUri()`** – never file:// URLs directly
5. **Markdown previews are filtered from rendering** – `viewType !== 'markdown.preview'`
6. **Nonces are unique per refresh** – generated with 32 random characters
7. **Critical CSS is inline** – prevents FOUC (Flash of Unstyled Content)
8. **IconRenderer returns an HTML string** – never a ThemeIcon (does not work in webview)
9. **Renderers are pure functions** – they do not mutate Bay state, they only read it
10. **Message handlers execute actions on Bay instances** – retrieved via `stateService.fetchBayById()`

---

## IMPLEMENTATION RULES

### Rendering Architecture (Specialization)

```
BaysWebviewProvider (orchestrator)
  ↓ delegates to
BaysHtmlBuilder (assembler)
  ↓ uses
renderers/ (specialized)
  ├─ GroupHeaderRenderer: group headers
  ├─ BayRowRenderer: normal parent bays
  └─ VariantRowRenderer: child bays (diffs)
html/ (utilities)
  ├─ IconRenderer: base64/codicon icons
  └─ StylesBuilder: critical CSS + CSP
```

### Update Flows

**Full Refresh (`refresh()`):**
- Structural: bay added/removed/moved, pin/unpin, hasChildren
- Debounced 100ms (TIMINGS.DEBOUNCE_DELAY)
- Reconstruye HTML completo con `htmlBuilder.buildHtml()`
- Setea `webview.html = ...`

**Silent Update (`refreshSilent()`):**
- Solo cambios visuales: isActive (tab activa cambió)
- NO reconstruye HTML
- Envía mensaje `updateBayState` con nuevos valores
- webview.js actualiza clases CSS sin re-render

**Tab State Changed (`notifyTabStateChanged()`):**
- Cambios de estado visual (isDirty, diagnostics)
- Calcula `stateIndicator` y envía mensaje `tabStateChanged`
- webview.js actualiza solo el badge/clase del Bay afectado

### Manejo de Mensajes (Protocolo)

Todos los mensajes siguen este patrón:
```typescript
{ type: 'actionName', tabId?: string, ...params }
```

**Acciones implementadas:**
- `openTab` → `bay.activate()` + gestión de preview ownership
- `closeTab` → `bay.close()`
- `pinTab`/`unpinTab` → `bay.pin()`/`unpin()` + reordenamiento
- `addToChat` → `copilotService.addFileToChat()`
- `contextMenu` → `BayContextMenu.show()`
- `dropTab` → `dragDropService.reorderWithinGroup()` o `moveBetweenGroups()`
- `fileAction` → `fileActionRegistry.execute()` + manejo especial Markdown toggle
- `saveAll` → `vscode.workspace.saveAll()`
- `closeGroup`/`toggleCompactMode`/`refresh` → operaciones globales

**Siempre:**
1. Recuperar Bay: `const tab = this.stateService.fetchBayById(msg.tabId)`
2. Validar existencia: `if (!tab) { Logger.warn(...); this.refresh(); return; }`
3. Ejecutar acción delegada: `await tab.action()`
4. Capturar errores: try/catch con Logger.error + refresh si "not found"

### Renderizado de Bay Blocks (Drag & Drop)

Cada parent con sus children se envuelve en un `.bay-block`:
```html
<div class="bay-block has-children" data-bay-id="..." data-pinned="..." data-groupid="...">
  <div class="bay">...</div>          <!-- parent -->
  <div class="bay child-bay">...</div> <!-- variant 1 -->
  <div class="bay child-bay">...</div> <!-- variant 2 -->
</div>
```

**Propósito:** `.bay-block` es la unidad de D&D (dragdrop.js clona/posiciona el bloque completo)

**Orphan variants** (parentId apunta a Bay no abierta):
- Renderizados con `renderOrphanVariantBay()`
- Envueltos individualmente en `.bay-block` sin `.has-children`
- Clase `.orphan` para estilado diferenciado

### Resolución de Assets (Security)

**localResourceRoots:**
```typescript
[this._extensionUri, vscode.Uri.joinPath(this._extensionUri, 'dist')]
```

**URIs convertidas:**
```typescript
webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'styles', 'webview.css'))
// → vscode-webview://guid/dist/styles/webview.css
```

**CSP estricto:**
```
default-src 'none';
style-src ${webview.cspSource} 'unsafe-inline';  // inline para CSS crítico
font-src ${webview.cspSource};
img-src ${webview.cspSource} data:;              // data: para base64 icons
script-src 'nonce-${nonce}';                     // solo scripts con nonce
```

### Manejo de Iconos (IconRenderer)

**3 estrategias (en orden de prioridad):**

1. **Codicons (webviews/unknowns):**
   - `bayType === 'webview'` → `resolveBuiltInCodicon(label, viewType)`
   - Retorna: `<span class="codicon codicon-${id}" style="color: #d4d7d6;"></span>`

2. **Base64 del tema (archivos):**
   - `iconManager.getFileIconAsBase64(fileName, context)`
   - Retorna: `<img src="data:image/svg+xml;base64,..." class="tab-icon">`

3. **Fallback (sin icono disponible):**
   - Extensión conocida → codicon específico (`.js` → `symbol-method`)
   - Desconocido → `codicon-file` genérico

**NUNCA** usar `ThemeIcon` directamente (no renderiza en webview).

### Markdown Toggle (Caso Especial)

Cuando `fileAction` es `openMarkdownPreview` o `editMarkdownSource`:

1. **Toggle viewMode state:** `tab.state.viewMode = newViewMode`
2. **Actualizar preview:** `previewService.showPreviewFor()` o `hidePreview()`
3. **Ejecutar acción:** `fileActionRegistry.execute(actionId, uri, context)`
4. **Activar tab:** `await tab.activate()` (SIEMPRE para MD toggle)
5. **Notificar cambio:** `stateService.updateTab(tab)`

Esto sincroniza el estado interno con la vista de VS Code.

---

## CASOS ESPECIALES CONOCIDOS

### 1. Markdown Preview Ownership

**Problema:** Archivos `.md` pueden mostrar su tab de origen como activo cuando el preview está visible.

**Tratamiento:**
- PreviewService detecta si webview activo es `markdown.preview`
- Encuentra Bay de origen: compara `preview.activeCustomEditorId` con `bay.metadata.uri`
- Marca `bay.state.isPreviewOwner = true` en el Bay fuente
- BaysHtmlBuilder **filtra** bays con `viewType === 'markdown.preview'` (no renderiza dupe)
- CSS `.preview-owner` estiliza el Bay origen como activo

### 2. Tab Closed During Activation

**Síntoma:** `msg.type === 'openTab'` pero `tab === undefined`

**Causa:** Race condition - usuario cerró tab antes de que llegara el mensaje

**Tratamiento:**
```typescript
if (!tab) {
  Logger.warn('[bays] Tab not found for activation (likely closed): ' + msg.tabId);
  this.refresh(); // Limpia UI inmediatamente
  return;
}
```

### 3. Sync Propagation Delay

**Problema:** Estado de pestañas de VS Code no está sincronizado inmediatamente después de cambios.

**Tratamiento en `openTab`:**
```typescript
if (this.syncService?.syncActiveState) {
  this.syncService.syncActiveState();
  await new Promise(resolve => setTimeout(resolve, TIMINGS.SYNC_PROPAGATION_DELAY));
}
```

**Valor típico:** `SYNC_PROPAGATION_DELAY = 50ms`

### 4. Variants Sin Parent Abierto

**Escenario:** Usuario tiene diff abierto pero cerró el archivo base.

**Detección:**
```typescript
const orphans = variantBays.filter(child => 
  !parentBays.some(p => p.metadata.id === child.metadata.parentId)
);
```

**Renderizado:** `renderOrphanVariantBay()` con clase `.orphan` y sin indentación parent

### 5. Webview Tabs (No URI)

**Bays afectados:** Settings, Extensions, custom webviews

**Invariantes:**
- `bay.metadata.uri === undefined`
- `bay.metadata.bayType === 'webview'`
- `bay.metadata.viewType` define el tipo exacto (ej: `'settings'`)

**Consecuencias en renderizado:**
- No mostrar acciones de archivo (compareWithActive, revealInExplorer, etc.)
- No mostrar chatBtn si Copilot requiere URI
- Icono siempre es codicon, nunca base64 del tema

### 6. File Actions Dinámicos (Markdown)

**Problema:** Botón debe reflejar estado actual (preview vs source).

**Solución:**
```typescript
const context = { viewMode: bay.state.viewMode };
const resolved = fileActionRegistry.resolve(label, uri, context);
// → viewMode === 'preview' → acción "Edit Source"
// → viewMode === 'source'  → acción "Open Preview"
```

El registry devuelve acción contextual basada en `viewMode`.

### 7. Debounce Overlap

**Escenario:** `refresh()` llamado múltiples veces en <100ms.

**Comportamiento:**
```typescript
if (this._debounceTimer) { clearTimeout(this._debounceTimer); }
this._debounceTimer = setTimeout(async () => {
  // Solo la última invocación ejecuta
}, TIMINGS.DEBOUNCE_DELAY);
```

**Efecto:** Evita múltiples rebuilds costosos, pero última renderización siempre ejecuta.

### 8. Initial Load Fade-in

**Objetivo:** Evitar "flash" de contenido no estilizado al cargar.

**Implementación:**
```typescript
const bodyClass = initialLoad ? '' : 'loaded';
// <body class="loaded"> → opacity: 1 (CSS transition)
```

Sin `loaded`, body tiene `opacity: 0` + `transition-delay: 1500ms`.

---

## EJEMPLOS REALES OBSERVADOS

### Ejemplo 1: Webview Tab (Settings)

```yaml
Input (BayMetadata):
  bayType: webview
  viewType: settings
  label: "Settings"
  uri: undefined

Output (IconRenderer):
  HTML: '<span class="codicon codicon-settings-gear" style="color: #d4d7d6;"></span>'
  
Output (BayRowRenderer):
  chatBtn: ""  # No URI, no Copilot button
  closeBtn: '<button data-action="closeBay" ...>...</button>'
  fileActionBtn: ""  # No canTogglePreview
```

### Ejemplo 2: Parent Bay con Variants

```yaml
Input (Parent Bay):
  bay.metadata.id: "file:///c:/src/file.ts-1"
  bay.state.hasChildren: true
  
Input (Child Bays):
  - parentId: "file:///c:/src/file.ts-1"
    diffType: "working-tree"
    diffStats: { linesAdded: 5, linesRemoved: 2 }
  - parentId: "file:///c:/src/file.ts-1"
    diffType: "staged"
    diffStats: { linesAdded: 3, linesRemoved: 1 }

Output (HTML):
  <div class="bay-block has-children" data-bay-id="file:///c:/src/file.ts-1" ...>
    <div class="bay">file.ts</div>
    <div class="bay child-bay working-tree">
      <span class="codicon codicon-git-commit"></span>
      <span>Working Tree</span>
      <span class="child-stats">
        <span class="stats-added">+5</span>
        <span class="stats-removed">-2</span>
      </span>
    </div>
    <div class="bay child-bay staged">...</div>
  </div>
```

### Ejemplo 3: Orphan Variant (Parent Cerrado)

```yaml
Input:
  bay.metadata.parentId: "file:///c:/src/missing.ts-1"
  bay.metadata.diffType: "working-tree"
  
Parent Bays: []  # Parent no existe en estado actual

Output:
  <div class="bay-block" data-bay-id="..." data-pinned="false">
    <div class="bay variant orphan working-tree">
      <span class="codicon codicon-git-commit"></span>
      <span>Working Tree</span>
      ...
    </div>
  </div>
```

### Ejemplo 4: Markdown Toggle Message

```yaml
Input Message:
  type: "fileAction"
  tabId: "file:///readme.md-1"
  actionId: "openMarkdownPreview"

Processing:
  1. tab.state.viewMode = "preview"
  2. previewService.showPreviewFor(tab)
  3. fileActionRegistry.execute("openMarkdownPreview", uri, { viewMode: "preview" })
  4. await tab.activate()
  5. stateService.updateTab(tab)

Result:
  - VS Code muestra preview webview
  - Bay fuente marcado como `isPreviewOwner: true`
  - Preview webview filtrado del renderizado
  - Botón file action ahora muestra "Edit Source" en próximo refresh
```

### Ejemplo 5: Drag & Drop Between Groups

```yaml
Input Message:
  type: "dropTab"
  sourceTabId: "file:///a.ts-1"
  targetTabId: "file:///b.ts-2"
  insertPosition: "after"
  sourceGroupId: 1
  targetGroupId: 2

Processing:
  await dragDropService.moveBetweenGroups(
    "file:///a.ts-1",  // source
    2,                  // target group
    "file:///b.ts-2",  // target tab
    "after"            // position
  )
  
  if (moved && tab.state.viewMode === "preview") {
    await previewService.showPreviewFor(tab);
  }

Result:
  - Bay movido de grupo 1 a grupo 2
  - Posicionado después de b.ts
  - Si era preview, preview resource actualizado al nuevo grupo
```

### Ejemplo 6: Icon Fallback Chain

```yaml
Scenario: Archivo .xyz sin icono en tema

Ejecución:
  1. iconManager.getFileIconAsBase64("file.xyz", context) → null
  2. parseIconString(null) → null
  3. renderFallback(".xyz")
     - fileType === ".xyz" no está en map
     - return renderCodicon("file", "#cccccc")

Output:
  '<span class="codicon codicon-file" style="color: #cccccc;"></span>'
```

---

## DEBUGGING TIPS

**Logger en providers:**
- `BaysWebviewProvider`: Usa `Logger.log()` para diagnóstico de mensajes (ya implementado)
- `BaysHtmlBuilder`: Usa `Logger.log()` para diagnóstico de variants (ya implementado)
- `IconRenderer`: Usa `Logger.error()` solo para errores fatales

**Verificar refresh loop:**
```typescript
Logger.log('[bays] refresh() called, view exists: ' + !!this._view);
```

**Verificar variants rendering:**
```typescript
Logger.log(`[BaysHtmlBuilder] Rendering parent "${label}" with ${children.length} children`);
```

**Verificar mensajes recibidos:**
```typescript
Logger.log(`[bays] Message received: ${msg.type}, tabId: ${msg.tabId}`);
```

---

## LÍMITES DE RESPONSABILIDAD

**Este módulo NO debe:**
- Detectar cambios en VS Code Tab API (BaySyncService)
- Calcular capabilities o enrichment (helpers/)
- Gestionar jerarquía parent-child (BayHierarchyService)
- Ejecutar operaciones de archivo (models/actions/)
- Determinar git status o diagnostics (GitSyncService)

**Este módulo SÍ debe:**
- Generar HTML a partir de estado ya calculado
- Rutear mensajes del webview a métodos de Bay
- Gestionar timing de refreshes (debounce)
- Resolver URIs de assets correctamente
- Mantener CSP estricto para seguridad
