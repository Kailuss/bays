# 2. Arquitectura y diseño

[📄 Índice](INDEX.md) | [🏁 Introducción](01_introduccion.md) | [🎯 Acciones](03_acciones.md) | [📦 Implementación](04_implementacion.md) | [🤖 Agentes](05_agentes.md)

-## El modelo Bay

`Bay` es la unidad fundamental. Representa una pestaña VS Code con metadata inmutable y estado mutable.

```typescript
// src/models/Bay.ts (simplificado)
class Bay extends BayActions {
  constructor(
    public readonly metadata: BayMetadata,  // inmutable
    public state: BayState,                 // mutable
  ) {}
}

type BayType = 'file' | 'webview' | 'custom' | 'notebook';

type BayMetadata = {
  id          : string;         // URI-based para files, label-based para webview
  sourceBayId?: string;         // Parent ID para Variants (diffs)
  bayType     : BayType;
  uri?        : vscode.Uri;     // undefined para webview tabs — NO falsificar
  label       : string;
  fileExtension: string;
  languageId? : string;
  // ...25+ campos enriquecidos (ver Bay.ts)
};

type BayState = {
  isActive   : boolean;         // Tab actualmente visible
  isDirty    : boolean;         // Cambios sin guardar
  isPinned   : boolean;
  isPreview  : boolean;         // Tab en itálica (reemplazable)
  viewMode   : BayViewMode;     // 'source' | 'preview' | 'split'
  hasVariant : boolean;         // Tiene child tabs (diffs)
  isVariant  : boolean;         // Es child de otra bay
  gitStatus  : GitStatus;       // null | 'modified' | 'added' | ...
  capabilities: BayCapabilities;
  // ...más campos (ver Bay.ts)
};
```

### BayType en detalle

| Tipo | URI | Ejemplo | ID generado |
|------|-----|---------|-------------|
| `file` | ✅ Siempre | `index.ts`, `README.md` | `${uri}-${viewColumn}` |
| `webview` | ❌ Nunca | Settings, Extensions, Claude Code | `${bayType}:${key}-${viewColumn}` |
| `custom` | ✅ Siempre | Editores visuales | `${uri}-${viewColumn}` |
| `notebook` | ✅ Siempre | `.ipynb` | `${uri}-${viewColumn}` |

En webviews, `key = (viewType || label)` saneado (`[^a-zA-Z0-9]→'-'`, minúsculas). Se indexa por el `viewType` **estable** (no el label) para que las webviews que reescriben su título en runtime —como Claude Code— no queden huérfanas.

**Variants** (diffs, snapshots): son Bays de tipo `file` con `sourceBayId` definido y un `diffType`. Sus IDs usan el esquema `diff:${modifiedUri}::${original}-${viewColumn}`.

### 🚨 Regla crítica

> **NUNCA crear URIs falsas** para webviews. Usar siempre `uri: undefined`.
> Comprobar `if (bay.metadata.uri)` antes de cualquier operación de archivo.

## Flujo de datos

```
vscode.Tab (evento onDidChangeTabs)
  ↓
BaySyncService → BayEventService + BayHeadService + ActiveStateService
  ↓ convierte → Bay (metadata + state)
  ↓ almacena en
BayStateService  (Map<string, Bay> — única fuente de verdad)
  ↓ dispara evento onDidChangeState
BaysWebviewProvider
  ↓ delega en
BaysHtmlBuilder + Renderers (BayRowRenderer, VariantRowRenderer, GroupHeaderRenderer)
  ↓ HTML → webview.html
  ↔ postMessage / onDidReceiveMessage
Webview JS (webview.js, dragdrop.js)
```

## Servicios

### core/
- **`BaySyncService`**: orquestador delgado. Convierte native tabs a `Bay` y delega en `BayEventService` (listeners), `ActiveStateService` (`isActive` + huérfanos) y `BayHeadService` (padres de variants), todos en `core/bay/`.
- **`BayStateService`**: store en memoria (`Map<string, Bay>` + grupos). Dispara cuatro eventos (ver tabla de renderizado).
- **`BayHierarchyService`**: gestiona relaciones padre→variant, recuentos y sync de cursor.
- **`DocumentManager`**: rastrea metadatos de documentos complejos (snapshots, versiones).

### ui/
- **`BayIconManager`**: resuelve iconos por nombre/extensión desde el tema activo a data URIs base64.
- **`ThemeService`**: detecta cambios de tema y notifica para reconstruir el icon map.
- **`BayDragDropService`**: valida y ejecuta reordenación. Los pinned NUNCA se mueven; los variants no se arrastran.
- **`GroupCustomizationService`**: persiste rename/color/lock de grupos en `workspaceState`, indexado por `viewColumn`.

### integration/
- **`GitSyncService`**: lee estado Git (solo lectura) y actualiza `bay.state.gitStatus`.
- **`CopilotService`**: adjunta archivos al chat de Copilot, actualiza `bay.state.integrations.copilot`.
- **`ClaudeConversationService`**: enriquece los títulos de las pestañas de Claude Code leyendo sus transcripts JSONL.

## Rendering: actualizaciones de la vista

| Tipo de cambio | Evento → método | Mensaje al webview | Coste |
|---|---|---|---|
| Bay añadida/eliminada/movida, pin, grupos | `onDidChangeState` → `refresh()` | `webview.html` completo | Alto: reconstruye el DOM |
| Bay activa cambió | `onDidChangeStateSilent` → `refreshSilent()` | `updateActiveBay` | Bajo: togglea `.active` |
| isDirty / git / diagnósticos | `onDidChangeBayState` → `notifyBayStateChanged()` | `bayStateChanged` | Bajo: cambia el nodo `.bay-state` |
| Título de conversación (Claude Code) | `onDidChangeBayLabel` → `notifyBayLabelChanged()` | `updateBayLabel` | Bajo: cambia solo el texto |

El canal silencioso vivo es `notifyActiveChange()`; `updateBaySilent()` sigue en el código pero está sin cablear. Tras la primera pintura, `patchIcons()` envía `updateIcons` para intercambiar los iconos diferidos.

## Decisiones de diseño

- **WebviewView** en lugar de `TreeView`: control total de height, layout y hover buttons.
- **URI opcional**: evita `[UriError]` con webview tabs.
- **Acciones puras en `models/actions/`**: testables de forma aislada, sin efectos en servicios.
- **Una capa de abstracción máxima**: directo > cleverness.

## Subsistemas destacados

- **Claude Code** — `ClaudeConversationService` detecta las pestañas de Claude (`viewType` con `claudevscodepanel`) y sustituye el título truncado por el completo leído de `~/.claude/projects/<slug>/<sessionId>.jsonl`.
- **Personalización de grupos** — rename/color/lock por grupo (`GroupCustomizationService` + `GroupActions` + `groupCommands`), persistido por `viewColumn`. Un grupo bloqueado oculta sus cierres.
- **Menú View Options** — submenú `bays.viewOptions` en la barra de la vista con toggles de compacto y ruta; `bays.saveAll` aparece con `bays.hasUnsavedBays`.
- **Rename/move/delete** — `BayEventService` remapea (`rekeyBay`) o purga los Bays afectados; los casos complejos caen en `resyncAll()`.
- **Menú contextual propio** — `BayContextMenu` genera un `MenuItem[]` y `webview/contextmenu.js` lo pinta como réplica del menú nativo en la posición del cursor.

Para profundizar en los tipos y helpers, consulta los archivos bajo `src/models` y `src/services`, y los `AGENT.md` de cada módulo.
