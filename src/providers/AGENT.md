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
5. **Markdown previews are real bays, not filtered** – a markdown preview is a variant (`diffType: 'preview'`) of its source `.md` bay; it renders as a child row (or standalone if orphaned), same as any other diff
6. **Nonces are unique per refresh** – generated with 32 random characters
7. **Critical CSS is inline** – prevents FOUC (Flash of Unstyled Content)
8. **IconRenderer returns an HTML string** – never a ThemeIcon (does not work in webview)
9. **Renderers are pure functions** – they do not mutate Bay state, they only read it
10. **Message handlers execute actions on Bay instances** – retrieved via `stateService.getBayById()`

---

## IMPLEMENTATION RULES

### Rendering Architecture (Specialization)

```
BaysWebviewProvider (orchestrator)
  ↓ delegates to
BaysHtmlBuilder (assembler, async: buildHtml() → { html, pendingIcons })
  ↓ uses
renderers/ (specialized)
  ├─ GroupHeaderRenderer: group headers (label/color/lock + collapse twisty)
  ├─ BayRowRenderer: normal parent bays
  └─ VariantRowRenderer: variant bays (diffs), attached or orphan
html/ (utilities)
  ├─ IconRenderer: base64/codicon icons (sync from cache; misses deferred)
  └─ StylesBuilder: critical CSS + CSP

BaysWebviewProvider also owns two collaborators outside the HTML pipeline:
  ├─ BayContextMenu: builds the serializable MenuItem[] model + executes the chosen action
  └─ GroupActions: rename/color/lock QuickPick & input-box flows (injected from extension.ts)
```

### Update Flows

Four host→webview event channels, all wired in the `BaysWebviewProvider` constructor from `BayStateService` events:

**Full Refresh (`refresh()`, from `onDidChangeState`):**
- Structural: bay added/removed/moved, pin/unpin, group changes — any direct state mutator (`addBay`, `removeBay`, `updateBay`, `rekeyBay`, `replaceBays`, `addGroup`, `removeGroup`, `reorderOnPin/Unpin`, `clear`, `refreshGroupCustomizations`, …) fires `notifyChange()`
- Debounced **30ms** (`TIMINGS.WEBVIEW_REFRESH_DEBOUNCE`) — `if (this._debounceTimer) clearTimeout(...)` then `setTimeout(..., TIMINGS.WEBVIEW_REFRESH_DEBOUNCE)`
- Reconstruye HTML completo con `await htmlBuilder.buildHtml()` (ASYNC — devuelve `{ html, pendingIcons }`)
- Setea `webview.html = ...`, luego dispara `void this.patchIcons(pendingIcons)` sin bloquear

**Silent Update (`refreshSilent()`, from `onDidChangeStateSilent`):**
- Solo cambios visuales: isActive (bay activa cambió), disparado por `notifyActiveChange()`
- NO reconstruye HTML
- Envía mensaje `{ type: 'updateActiveBay', activeBayIds }` con el array completo de ids activos (uno por grupo)
- webview.js hace `toggle('active', activeSet.has(t.dataset.bayId))` sin re-render
- (`updateBaySilent()` sigue existiendo en `BayStateService` pero está **muerto/desconectado** — `notifyActiveChange()` es el único disparador vivo)

**Bay State Changed (`notifyBayStateChanged()`, from `onDidChangeBayState`):**
- Cambios de estado visual de UNA bay (isDirty, diagnostics, git status)
- Fired ONLY by `updateBayStateWithAnimation()`
- Calcula `stateIndicator` (`getStateIndicator(bay)`) y envía `{ type: 'bayStateChanged', bayId, stateClass, stateHtml }`
- webview.js reemplaza solo el nodo `.bay-state` del Bay afectado

**Bay Label Changed (`notifyBayLabelChanged()`, from `onDidChangeBayLabel`) — NEW:**
- Cuando el título de una bay se reescribe en caliente (webviews de Claude Code, cuyo tab label VS Code trunca/actualiza tras crearse)
- Envía `{ type: 'updateBayLabel', bayId, label }` con el label en crudo (sin HTML)
- webview.js lo aplica como `textContent` sobre `.bay-name`, dejando intactos los badges (pin) que le siguen

### Manejo de Mensajes (Protocolo)

Todos los mensajes siguen este patrón:
```typescript
{ type: 'actionName', bayId?: string, ...params }
```

**17 tipos inbound (webview→host), enrutados por un `Map<string, handler>` en `messageHandlers`:**
- `openBay` → `bay.activate()` (con reintento tras `SYNC_PROPAGATION_DELAY` si el sync aún no propagó)
- `closeBay` → `bay.close()`
- `closeVariant` → cierre de variante con reconciliación de jerarquía en 4 fases (ver más abajo)
- `pinBay`/`unpinBay` → `bay.pin()`/`unpin()` + `stateService.reorderOnPin/Unpin()`
- `addToChat` → `copilotService.addFileToChat()`
- `contextMenu` → `handleContextMenu()`, construye el modelo y lo devuelve (ver sección "Custom context menu")
- `menuAction` → `handleMenuAction()` → `contextMenu.execute(actionId, bay)`
- `dropBay` → `dragDropService.reorderWithinGroup()` o `moveBetweenGroups()`
- `fileAction` → `fileActionRegistry.execute()` (el "Open Preview" de Markdown ya no necesita caso especial, ver "Markdown 'Open Preview'")
- `saveAll` → `vscode.workspace.saveAll(false)`
- `reorder` → placeholder ("Coming soon")
- `renameGroup`/`setGroupColor`/`toggleGroupLock` → `handleGroupAction(groupId, groupActions.rename|pickColor|toggleLock)`
- `toggleCompactMode` → flip de `bays.compactMode` en configuración Global
- `refresh` → `this.refresh()`

**Siempre (patrón por handler):**
1. Recuperar Bay: `const bay = this.findBay(msg.bayId)` (delega en `stateService.getBayById()`)
2. Validar existencia: `if (!bay) { Logger.warn(...); this.refresh(); return; }`
3. Ejecutar acción delegada: `await bay.action()`
4. Capturar errores: try/catch con Logger.error + refresh si el mensaje de error contiene "not found" / "no longer exists" / "does not correspond"

### Renderizado de Bay Blocks (Drag & Drop)

Cada parent con sus variants se envuelve en un `.bay-block`:
```html
<div class="bay-block has-children" data-bay-id="..." data-pinned="..." data-groupid="..." data-group-color="...">
  <div class="bay">...</div>            <!-- parent -->
  <div class="bay variant">...</div>    <!-- variant 1 -->
  <div class="bay variant">...</div>    <!-- variant 2 -->
</div>
```

**Propósito:** `.bay-block` es la unidad de D&D (dragdrop.js clona/posiciona el bloque completo). `data-group-color` viaja en el bloque, no en la cabecera, para que las filas se lean como pertenecientes al grupo también al hacer scroll (solo con >1 grupo).

**Orphan variants** (`bay.metadata.sourceBayId` apunta a una Bay no presente en la lista — archivo fuente cerrado, o vive en otro grupo):
- Renderizados con `renderOrphanVariantBay()`, delega en el mismo `VariantRowRenderer.render({ orphan: true })`
- Envueltos individualmente en su propio `.bay-block` (sin `.has-children`, con `data-variant="true"`)
- Clase `.orphan` en el `.bay.variant` para estilado diferenciado; muestra el label nativo (incluye el nombre de archivo) en vez del tipo de diff, y no se indenta (no hay parent del que colgar)

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
font-src ${webview.cspSource} data:;             // data: para @font-face de iconos basados en fuente
img-src ${webview.cspSource} data:;              // data: para base64 icons
script-src 'nonce-${nonce}';                     // solo scripts con nonce
```

### Manejo de Iconos (IconRenderer)

`renderImmediate(bay)` es SÍNCRONO — solo lee de caché — y devuelve `{ html, pending }`; un cache-miss no bloquea el primer pintado: se pinta el fallback y la bay se apunta en `pendingIcons` para resolverse en paralelo (ver "Deferred icon patching" más abajo).

**Para `bayType === 'webview'`, en orden de prioridad:**

1. **Logo real de la extensión propietaria** (NEW): `resolveWebviewExtensionIcon(viewType)` — p. ej. Claude Code resuelve a `resources/claude-logo.svg` embebido como `<img>` base64. Si hay match, gana siempre.
2. **Codicon genérico**: `resolveBuiltInCodicon(label, viewType)` → `<span class="codicon codicon-${id}" style="color: #d4d7d6;"></span>`

**Para bays con archivo:**

1. **Base64 del tema (cache hit)**: `iconManager.getCachedIcon(fileName)` → `parseIconString()` → `renderIconData()`. Puede resolver a `<img src="data:...">` (base64), a un glyph `<span class="seti-icon" style="font-family:...">` (temas de icono basados en fuente, p. ej. Seti), o a un fallback si el marcador no trae `fontFamily`.
2. **Cache miss**: se devuelve el fallback inmediatamente y `{ fileName, languageId }` viaja a `pendingIcons`; `renderByFileName()` lo resuelve después vía `iconManager.getFileIconAsBase64()` y se parchea con `updateIcons`.
3. **Fallback (sin icono disponible o resolución fallida)**: `renderFallback()` — un `<svg>` de archivo genérico inline (no un codicon, no distingue por extensión: `.xyz` y `.ts` sin tema comparten el mismo SVG).

**NUNCA** usar `ThemeIcon` directamente (no renderiza en webview).

### Markdown "Open Preview" (Caso Especial)

`PreviewService` **ya no existe** — no hay ownership de preview que gestionar, y ya no es un toggle: solo hay una acción, `openMarkdownPreview` (`MARKDOWN_TOGGLE_ACTION` en `src/constants/fileQuickActions/quickActions/markdown.ts`, `setFocus: false`), que crea el preview. Corre íntegramente por el camino genérico de `fileAction`, sin caso especial en `BaysWebviewProvider`:

1. `handleFileAction()` resuelve `shouldFocus = fileActionRegistry.shouldSetFocus(actionId)`
2. `await fileActionRegistry.execute(actionId, bay.metadata.uri, { viewMode: bay.state.viewMode })` → ejecuta `vscode.commands.executeCommand(MARKDOWN_SHOW_PREVIEW, uri)`
3. Si `shouldFocus && !bay.state.isActive` → `await bay.activate()` (para `openMarkdownPreview`, `setFocus` es `false`: el foco lo toma la propia pestaña del preview, no se reactiva el source)

"Open Preview" abre el preview como su propia tab de VS Code, que llega como una **variant bay** (`diffType: 'preview'`) a través de los eventos nativos normales (`BayEventService`), y el rebuild estructural que dispara oculta el botón del parent (ver `renderFileActionButton` — `hasPreviewVariant` esconde "Open Preview" una vez que ya existe la fila hija "Preview"). Cerrar esa fila (su propia X, `closeVariant`) es lo que "vuelve" a la fuente — no hay acción "Edit Source" que ejecutar.

---

## CASOS ESPECIALES CONOCIDOS

### 1. Bay Closed During Activation

**Síntoma:** `msg.type === 'openBay'` pero `bay === undefined`

**Causa:** Race condition - usuario cerró la bay antes de que llegara el mensaje

**Tratamiento:**
```typescript
if (!bay) {
  Logger.warn('[Bays] Bay not found for activation (likely closed): ' + bayId);
  this.refresh(); // Limpia UI inmediatamente
  return;
}
```

### 2. Sync Propagation Delay

**Problema:** Estado de pestañas de VS Code no está sincronizado inmediatamente después de cambios.

**Tratamiento en `openBay`:**
```typescript
if (this.syncService?.syncActiveState) {
  this.syncService.syncActiveState();
  await new Promise(resolve => setTimeout(resolve, TIMINGS.SYNC_PROPAGATION_DELAY));
}
```

**Valor:** `SYNC_PROPAGATION_DELAY = 5ms`

### 3. Variants Sin Parent Abierto

**Escenario:** Usuario tiene diff abierto pero cerró el archivo base.

**Detección:**
```typescript
const orphans = variantBays.filter(child => 
  !parentBays.some(p => p.metadata.id === child.metadata.sourceBayId)
);
```

**Renderizado:** `renderOrphanVariantBay()` con clase `.orphan` y sin indentación parent

### 4. Webview Tabs (No URI)

**Bays afectados:** Settings, Extensions, custom webviews

**Invariantes:**
- `bay.metadata.uri === undefined`
- `bay.metadata.bayType === 'webview'`
- `bay.metadata.viewType` define el tipo exacto (ej: `'settings'`)

**Consecuencias en renderizado:**
- No mostrar acciones de archivo (compareWithActive, revealInExplorer, etc.)
- No mostrar chatBtn si Copilot requiere URI
- Icono normalmente es codicon; **excepción NEW:** `resolveWebviewExtensionIcon(viewType)` puede resolver a un logo real en base64 (Claude Code) antes de caer al codicon genérico — ver "Manejo de Iconos"

### 5. File Actions Dinámicos (Markdown)

**No es un toggle fuente↔preview** (a pesar del nombre interno `MARKDOWN_TOGGLE_ACTION`): `resolve()` siempre devuelve la misma acción `openMarkdownPreview` / tooltip "Open Preview" — no hay contraparte "Edit Source" ni rama por `viewMode` (el campo `context.viewMode` que recibe `resolve()` está ahí en el tipo pero **ningún** action dinámico registrado lo lee hoy). El botón solo CREA el preview; la variante creada es su propia fila con su propia X para cerrarla.

**Problema real a resolver:** una vez creada la variante preview, el botón "Open Preview" del parent debe desaparecer (crear un segundo preview sería redundante).

**Solución (`renderFileActionButton` en `BaysHtmlBuilder`):**
```typescript
const context = { viewMode: bay.state.viewMode };
const resolved = this.fileActionRegistry.resolve(bay.metadata.label, bay.metadata.uri, context);
if (!resolved) { return ''; }

// hasPreviewVariant = children.some(child => child.metadata.diffType === 'preview')
if (resolved.id === 'openMarkdownPreview' && hasPreviewVariant) { return ''; }
```

`hasPreviewVariant` se calcula en `renderBayList()` a partir de los hijos ya recolectados para ese parent, y se pasa a `renderBay()` → `renderFileActionButton()`.

### 6. Debounce Overlap

**Escenario:** `refresh()` llamado múltiples veces en <30ms.

**Comportamiento:**
```typescript
if (this._debounceTimer) { clearTimeout(this._debounceTimer); }
this._debounceTimer = setTimeout(async () => {
  // Solo la última invocación ejecuta
}, TIMINGS.WEBVIEW_REFRESH_DEBOUNCE);
```

**Efecto:** Evita múltiples rebuilds costosos, pero última renderización siempre ejecuta.

### 7. Initial Load Fade-in

**Objetivo:** Evitar "flash" de contenido no estilizado al cargar.

**Implementación:**
```typescript
const bodyClass = initialLoad ? '' : 'loaded';
// <body class="loaded"> → opacity: 1 (CSS transition)
```

Sin `loaded`, body tiene `opacity: 0` + `transition-delay: 1500ms`.

### 8. Custom Context Menu (NEW)

**Problema:** Un `QuickPick` de VS Code aparece centrado arriba de la ventana, no bajo el cursor — para un menú contextual de clic derecho eso rompe la expectativa. Solución: el host construye el *modelo* del menú y el webview lo *dibuja* él mismo, a mano, replicando el menú nativo de monaco.

**Flujo:**
1. Clic derecho sobre `.bay` en `webview.js` → `postMessage({ type: 'contextMenu', bayId, x: e.clientX, y: e.clientY })`. El clic derecho sobre `.group-header` está suprimido (no dispara menú).
2. Host `handleContextMenu(msg)` → `contextMenu.build(bay)` construye un `MenuItem[]` **serializable** (nada de funciones ni instancias: cruza `postMessage`) y responde `postMessage({ type: 'showContextMenu', bayId, x, y, items })`. Si `items.length === 0` (p. ej. grupo bloqueado sin ninguna acción) no se envía nada.
3. Webview: `BaysContextMenu.show({ x, y, items, onSelect })` (en `src/webview/contextmenu.js`) pinta el menú en la posición del cursor. Al elegir un item: `onSelect(actionId)` → `postMessage({ type: 'menuAction', bayId, actionId })`.
4. Host `handleMenuAction(bayId, actionId)` → `contextMenu.execute(actionId, bay)` — un `switch` que delega en los métodos de `Bay` (`bay.close()`, `bay.pin()`, `bay.revealInExplorerView()`, …).

**`MenuItem` (`src/providers/BayContextMenu.ts`):**
```typescript
type MenuItem =
  | { type: 'separator' }
  | { id: string; label: string; icon?: string; keybinding?: string; enabled?: boolean; tooltip?: string; submenu?: MenuItem[] };
```

**`BayContextMenu.build(bay)` — items condicionales:**
- Grupo bloqueado (`stateService.getGroup(bay.state.groupId)?.isLocked`) → **ningún** item de cierre (ni Close, ni Close Others, ni Close to the Right, ni Close Group): si el menú los siguiera listando, el candado solo escondería el botón sin proteger nada.
- Si no está bloqueado: Close / Close Others / Close to the Right, luego Pin o Unpin según `bay.state.isPinned`.
- Más de un grupo abierto y no bloqueado → Close Group.
- `bay.metadata.uri` presente → Reveal in Explorer View / Reveal in File Explorer / Open Timeline / Copy Relative Path / Copy Path / Copy File Contents / Duplicate File / Compare with Active Editor / Open Changes / Split Right / Move to New Window.
- `uri` presente y `copilotService.isAvailable()` → Add to Copilot Chat.

**`contextmenu.js` (`BaysContextMenu`)** es una réplica del menú nativo de monaco: un único menú vivo a la vez, submenús anidados con hover de 250ms, posicionamiento consciente del viewport (no se sale de pantalla), navegación completa por teclado + typeahead, la regla del "group leader" (solo el primer item tras un separador dibuja su icono, para alinear el resto), overlay que cierra al hacer clic fuera, y auto-cierre en scroll/resize/blur.

### 9. Group Headers (NEW)

`GroupHeaderRenderer.render(group, esc)` solo se pinta cuando hay más de un grupo poblado (`BaysHtmlBuilder.renderAllBays` — con un único grupo no hay nada que distinguir):
```html
<div class="group-header" data-groupid="1" data-color="blue" data-locked="false">
  <button class="group-toggle" data-action="toggleGroup" data-groupid="1" title="Collapse/Expand"><span class="codicon codicon-chevron-down"></span></button>
  <span class="group-label">Group 1</span>
  <span class="group-actions">
    <button class="group-btn" data-action="renameGroup" data-groupid="1" title="Rename Group">...</button>
    <button class="group-btn" data-action="setGroupColor" data-groupid="1" title="Set Color">...</button>
    <button class="group-btn group-lock-btn" data-action="toggleGroupLock" data-groupid="1" title="Lock Group">...</button>
  </span>
</div>
```
- El twisty de colapso (`data-action="toggleGroup"`) es puramente cliente: `webview.js` lo alterna sin ida y vuelta al host.
- Rename/color/lock sí van al host (`renameGroup`/`setGroupColor`/`toggleGroupLock`) → `handleGroupAction(groupId, action)` en `BaysWebviewProvider`, que resuelve el `BayGroup` vía `stateService.getGroup(groupId)` y delega en **`GroupActions`** (`src/providers/GroupActions.ts`):
  - `rename(group)` → `showInputBox` (máx. 60 caracteres, vaciar restaura el label por defecto `"Group N"`).
  - `pickColor(group)` → `showQuickPick` con "Auto" (vuelve al color por columna, `defaultGroupColor(viewColumn)`) + los 6 `GROUP_COLORS`.
  - `toggleLock(group)` → invierte `isLocked`.
  - Las tres persisten vía `GroupCustomizationService` (`context.workspaceState`, clave `bays.groupCustomizations`, keyed por `viewColumn` — VS Code no expone un id de grupo estable) y, si devuelven `true`, `handleGroupAction` llama `stateService.refreshGroupCustomizations()` (dispara `onDidChangeState` → full rebuild).
- El candado no es solo visual: un grupo bloqueado no ofrece ningún item de cierre en el menú contextual (ver caso 8) y su botón de cierre por-bay (`closeBtn`) se omite en `BaysHtmlBuilder.renderBay()` (`hover && !locked && ...`).

### 10. Deferred Icon Patching & Label Patching (NEW)

**Iconos diferidos:** `buildHtml()` es async (espera `iconManager.getFontFaceCss()`), pero el render de bays en sí sigue siendo síncrono/cache-only (`iconRenderer.renderImmediate`). Un cache-miss no bloquea el primer pintado:
1. Se pinta el fallback SVG inline y `{ bayId, fileName, languageId }` se acumula en `pendingIcons`.
2. `refresh()` asigna `webview.html` y dispara `void this.patchIcons(pendingIcons)` sin esperarlo.
3. `patchIcons()` resuelve todos en paralelo (`Promise.all` sobre `htmlBuilder.resolveIconHtml()`), y si ningún rebuild completo reemplazó la vista mientras tanto (`this._view !== view || this._fullRefreshPending` aborta), envía `postMessage({ type: 'updateIcons', icons: [{ bayId, html }, ...] })`.
4. `webview.js` busca cada `.bay[data-bay-id="..."] .bay-icon` (con `CSS.escape(bayId)`) y sustituye su `innerHTML`.

**Label patching (Claude Code, NEW):** VS Code solo expone el título truncado (`aiTitle.slice(0,24)+"…"`) de las tabs de Claude Code; `ClaudeConversationService` lee el título completo del transcript JSONL y llama `stateService.notifyBayLabelChange(id)`, que dispara `onDidChangeBayLabel` → `notifyBayLabelChanged()` → `postMessage({ type: 'updateBayLabel', bayId, label })` con el label en texto plano (sin HTML). El cliente lo aplica como `textContent` sobre `.bay-name`, preservando el badge de pin que le sigue en el DOM.

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
  bay.state.hasVariant: true
  bay.state.variantCount: 2

Input (Variant Bays):
  - sourceBayId: "file:///c:/src/file.ts-1"
    diffType: "working-tree"
    diffStats: { linesAdded: 5, linesRemoved: 2 }
  - sourceBayId: "file:///c:/src/file.ts-1"
    diffType: "staged"
    diffStats: { linesAdded: 3, linesRemoved: 1 }

Output (HTML):
  <div class="bay-block has-children" data-bay-id="file:///c:/src/file.ts-1" data-pinned="false" data-groupid="1">
    <div class="bay">file.ts</div>
    <div class="bay variant working-tree" data-bay-id="..." data-parentid="file:///c:/src/file.ts-1">
      <span class="bay-icon"><span class="codicon codicon-git-commit"></span></span>
      <span class="variant-label">Working Tree</span>
      <span class="variant-stats"><span class="stats-added">+5</span><span class="stats-removed">-2</span></span>
      <span class="bay-actions"><button data-action="closeVariant" ...>...</button></span>
    </div>
    <div class="bay variant staged">...</div>
  </div>
```

### Ejemplo 3: Orphan Variant (Parent Cerrado)

```yaml
Input:
  bay.metadata.sourceBayId: "file:///c:/src/missing.ts-1"
  bay.metadata.diffType: "working-tree"

Parent Bays: []  # Parent no existe en la lista de este render (cerrado, o en otro grupo)

Output:
  <div class="bay-block" data-bay-id="..." data-pinned="false" data-variant="true" data-groupid="1">
    <div class="bay variant orphan working-tree" data-bay-id="..." data-parentid="file:///c:/src/missing.ts-1">
      <span class="bay-icon"><span class="codicon codicon-git-commit"></span></span>
      <span class="variant-label">missing.ts</span>  <!-- label nativo, no "Working Tree": sin parent, la fila necesita decir de qué archivo habla -->
      ...
    </div>
  </div>
```

### Ejemplo 4: Markdown "Open Preview" Message

```yaml
Input Message:
  type: "fileAction"
  bayId: "file:///readme.md-1"
  actionId: "openMarkdownPreview"

Processing (sin caso especial — camino genérico de fileAction):
  1. shouldFocus = fileActionRegistry.shouldSetFocus("openMarkdownPreview")
  2. await fileActionRegistry.execute("openMarkdownPreview", uri, { viewMode: "source" })
  3. if (shouldFocus && !bay.state.isActive) await bay.activate()

Result:
  - VS Code abre el preview como una tab nueva de verdad
  - BayEventService la detecta por los eventos nativos y la agrega como VARIANTE
    (diffType: 'preview') del bay.readme.md-1 → dispara onDidChangeState (rebuild)
  - En el rebuild, BaysHtmlBuilder ve hasPreviewVariant === true y oculta el botón
    "Open Preview" del parent (renderFileActionButton)
```

### Ejemplo 5: Drag & Drop Between Groups

```yaml
Input Message:
  type: "dropBay"
  sourceBayId: "file:///a.ts-1"
  targetBayId: "file:///b.ts-2"
  insertPosition: "after"
  sourceGroupId: 1
  targetGroupId: 2

Processing (handleDropBay):
  # El webview ya movió el DOM client-side; el host solo reconcilia el modelo.
  const moved = await dragDropService.moveBetweenGroups(
    "file:///a.ts-1",  // source
    2,                  // target group
    "file:///b.ts-2",  // target bay
  )
  if (!moved) { this.refresh(); }  // rechazado (webview sin URI, bay pinneada, ...) → restaurar DOM

Result:
  - Éxito: bay.close()+reopen en el grupo destino dispara eventos nativos que
    ya reconstruyen el árbol — no hace falta postMessage adicional
  - Mismo grupo (sourceGroupId === targetGroupId): reorderWithinGroup() en su lugar,
    sin cierre/reapertura
```

### Ejemplo 6: Icon Fallback Chain

```yaml
Scenario: Archivo .xyz sin icono en tema (cache miss)

Ejecución (renderImmediate, síncrono):
  1. iconManager.getCachedIcon("file.xyz") → undefined (cache miss)
  2. return { html: renderFallback(".xyz"), pending: { fileName: "file.xyz", languageId } }
  3. pendingIcons.push({ bayId, fileName: "file.xyz", languageId })

Ejecución diferida (patchIcons, tras el primer pintado):
  4. renderByFileName("file.xyz") → iconManager.getFileIconAsBase64(...) → aún null
  5. renderFallback() de nuevo

Output (ambas veces — el fallback NO distingue por extensión):
  '<svg width="16" height="16" viewBox="0 0 16 16" ...>...</svg>'  <!-- icono de archivo genérico inline -->
```

---

## DEBUGGING TIPS

**Logger en providers:**
- `BaysWebviewProvider`: Usa `Logger.log()` para diagnóstico de mensajes (ya implementado)
- `BaysHtmlBuilder`: Usa `Logger.log()` para diagnóstico de variants (ya implementado)
- `IconRenderer`: Usa `Logger.error()` solo para errores fatales

**Verificar refresh loop:**
```typescript
Logger.log('[Bays] refresh() called, view exists: ' + !!this._view);
```

**Verificar variants rendering:**
```typescript
Logger.log(`[BaysHtmlBuilder] Rendering parent "${label}" with ${children.length} children`);
```

**Verificar mensajes recibidos:** (no hay log genérico por mensaje hoy — cada handler loguea con su propio prefijo cuando falla, p. ej. `Logger.warn('[Bays] Bay not found for activation (likely closed): ' + bayId)`)

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
