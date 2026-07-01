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
| `file` | ✅ Siempre | `index.ts`, `README.md` | `uri.toString() + '-' + viewColumn` |
| `webview` | ❌ Nunca | Settings, Extensions | `'webview:' + label + '-' + viewColumn` |
| `custom` | ✅ Siempre | Editores visuales | `uri.toString() + '-' + viewColumn` |
| `notebook` | ✅ Siempre | `.ipynb` | `uri.toString() + '-' + viewColumn` |

**Variants** (diffs, snapshots): son Bays de tipo `file` con `sourceBayId` definido y un `diffType`.

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
- **`BaySyncService`**: orquestador. Escucha `onDidChangeTabs`, convierte native tabs a `Bay`, delega en sub-servicios.
- **`BayStateService`**: store en memoria (`Map<string, Bay>`). Dispara `onDidChangeState` (reconstruye HTML) u `onDidChangeStateSilent` (solo actualiza clases CSS).
- **`BayHierarchyService`**: gestiona relaciones parent→variant, placeholders y recuentos.
- **`DocumentManager`**: rastrea metadatos de documentos complejos (snapshots, versiones).

### ui/
- **`BayIconManager`**: resuelve iconos por nombre/extensión desde el tema activo a data URIs base64.
- **`ThemeService`**: detecta cambios de tema y notifica para reconstruir el icon map.
- **`BayDragDropService`**: valida y ejecuta reordenación. Los pinned NUNCA se mueven.

### integration/
- **`GitSyncService`**: lee estado Git (solo lectura) y actualiza `bay.state.gitStatus`.
- **`CopilotService`**: adjunta archivos al chat de Copilot, actualiza `bay.state.integrations.copilot`.

## Rendering: actualizaciones de la vista

| Tipo de cambio | Método | Coste |
|---|---|---|
| Bay añadida/eliminada/movida | `refresh()` | Alto: reconstruye HTML completo |
| Tab activa cambió | `refreshSilent()` | Bajo: mensaje `updateBayState` al webview |
| isDirty / diagnostics | `notifyTabStateChanged()` | Bajo: mensaje `tabStateChanged` al webview |

## Decisiones de diseño

- **WebviewView** en lugar de `TreeView`: control total de height, layout y hover buttons.
- **URI opcional**: evita `[UriError]` con webview tabs.
- **Acciones puras en `models/actions/`**: testables de forma aislada, sin efectos en servicios.
- **Una capa de abstracción máxima**: directo > cleverness.
dizar en los tipos y helpers, consulta los archivos bajo `src/models` y `src/services`.
bajo `src/models` y `src/services`.
