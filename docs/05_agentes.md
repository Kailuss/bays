# 5. Guía para agentes y Copilot

[📄 Índice](INDEX.md) | [🏁 Introducción](01_introduccion.md) | [🏗️ Arquitectura](02_arquitectura.md) | [🎯 Acciones](03_acciones.md) | [📦 Implementación](04_implementacion.md)

---

> Guía de referencia rápida para agentes AI que trabajan en este proyecto.

## Nomenclatura correcta

| ~~Obsoleto~~ | ✅ Actual |
|---|---|
| `SideTab` | `Bay` |
| `SideTabMetadata` | `BayMetadata` |
| `SideTabState` | `BayState` |
| `TabSyncService` | `BaySyncService` |
| `TabStateService` | `BayStateService` |
| `TabIconManager` | `BayIconManager` |
| `TabDragDropService` | `BayDragDropService` |
| `tabType` | `bayType` |
| `parentId` | `sourceBayId` |
| `.tab` / `.child-tab` (CSS) | `.bay` / `.bay.variant` (CSS) |

## Patrones de código esenciales

```typescript
// ✅ Comprobar URI antes de operaciones de archivo (CRÍTICO)
if (bay.metadata.uri) { /* operaciones de archivo */ }
if (bay.metadata.bayType === 'webview') { /* sin URI aquí */ }

// ✅ Importaciones correctas
import type { Bay, BayMetadata, BayState } from './models/Bay';
import { BayStateService } from './services/core/BayStateService';

// ✅ Estado mutable directamente
bay.state.isPinned = true;
stateService.notifyChange(); // dispara rebuilda del HTML

// ✅ CSS selector con escape (IDs tienen :, /, %)
document.querySelector(`.bay[data-bay-id="${CSS.escape(id)}"]`);

// ✅ Logger — Logger.log / Logger.warn / Logger.error (nunca console.log)
Logger.log('[NombreModulo] Info');
Logger.warn('[NombreModulo] Advertencia');
Logger.error('[NombreModulo] Mensaje:', error);

// ✅ I/O async siempre
await vscode.workspace.fs.readFile(uri);

// ✅ Guard para acciones file-only
if (!bay.metadata.uri) return;
```

## Qué está dónde

| Tarea | Dónde buscar |
|-------|-------------|
| Tipos Bay, BayMetadata, BayState | `src/models/Bay.ts` |
| Métodos de Bay (close, pin, etc.) | `src/models/BayActions.ts` |
| Funciones puras de acciones | `src/models/actions/` |
| Sincronización con VS Code | `src/services/core/BaySyncService.ts` + `core/bay/` |
| Store en memoria de Bays | `src/services/core/BayStateService.ts` |
| Relaciones padre-variant | `src/services/core/BayHierarchyService.ts` |
| Conversión native tab → Bay | `src/services/core/helpers/tabConverter.ts` + `tabClassifier.ts` |
| Iconos de archivos | `src/services/ui/BayIconManager.ts` |
| Drag & drop | `src/services/ui/BayDragDropService.ts` |
| Personalización de grupos | `src/services/ui/GroupCustomizationService.ts` + `providers/GroupActions.ts` |
| Integración Git | `src/services/integration/GitSyncService.ts` |
| Integración Copilot | `src/services/integration/CopilotService.ts` |
| Títulos de Claude Code | `src/services/integration/ClaudeConversationService.ts` |
| Generación HTML | `src/providers/BaysHtmlBuilder.ts` + `renderers/` |
| Menú contextual | `src/providers/BayContextMenu.ts` + `src/webview/contextmenu.js` |
| Mensajería webview | `src/providers/BaysWebviewProvider.ts` |
| Comandos VS Code | `src/commands/bayCommands.ts`, `groupCommands.ts`, `copilotCommands.ts` |
| Acciones por tipo de archivo | `src/constants/fileQuickActions/` |
| JS cliente (webview) | `src/webview/webview.js` |

## AGENT.md por módulo

Cada módulo tiene un `AGENT.md` con invariantes, patrones y reglas específicas:

| Módulo | Archivo | Leer cuando... |
|--------|---------|----------------|
| `models/` | `src/models/AGENT.md` | Añadir/modificar acciones Bay |
| `services/core/` | `src/services/core/AGENT.md` | Tocar sincronización o estado |
| `providers/` | `src/providers/AGENT.md` | Modificar HTML o mensajería |
| `services/ui/` | `src/services/ui/AGENT.md` | Cambiar iconos, drag&drop, temas |
| `services/integration/` | `src/services/integration/AGENT.md` | Integraciones Git/Copilot |
| `commands/` | `src/commands/AGENT.md` | Añadir nuevos comandos |

## Flujo de trabajo recomendado

```
1. semantic_search → encontrar código similar al que quiero hacer
2. read_file → entender contexto antes de editar
3. Implementar siguiendo patrones existentes
4. npm run compile → verificar que no hay errores
5. Revisar checklist: URI?, Logger?, async?
```

## Reglas nunca romper

1. **NUNCA** crear URIs falsas para webview tabs — produce `[UriError]`
2. **NUNCA** usar `console.log()`, `Logger.info()`, `Logger.debug()`
3. **NUNCA** I/O síncrono (`fs.readFileSync`, etc.)
4. **NUNCA** modificar `BayMetadata` tras creación
5. **NUNCA** acceder a `BayStateService` desde `models/actions/`

## Añadir una nueva acción Bay

```typescript
// 1. Crear src/models/actions/myActions.ts
export async function myAction(metadata: BayMetadata, state: BayState): Promise<void> {
  if (!metadata.uri) return;  // guard webview
  // implementación...
}

// 2. Exportar desde src/models/actions/index.ts
export { myAction } from './myActions';

// 3. Añadir método en src/models/BayActions.ts
async myAction(): Promise<void> {
  return actions.myAction(this.metadata, this.state);
}

// 4. Registrar comando en src/commands/bayCommands.ts si es necesario
```

## Añadir una nueva integración

```typescript
// 1. Actualizar BayIntegrations en src/models/Bay.ts
export type BayIntegrations = {
  // ...existing...
  myService?: { synced: boolean; lastSync?: number };
};

// 2. Crear src/services/integration/MyService.ts
export class MyService {
  async sync(bay: Bay): Promise<void> {
    bay.state.integrations.myService = { synced: true, lastSync: Date.now() };
    // el provider refleja el cambio en el render
  }
}
```
