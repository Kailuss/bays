# 3. Acciones y extensiones

[📄 Índice](INDEX.md) | [🏁 Introducción](01_introduccion.md) | [🏗️ Arquitectura](02_arquitectura.md) | [📦 Implementación](04_implementacion.md) | [🤖 Agentes](05_agentes.md)

---

## Acciones sobre Bays

Las acciones están implementadas como **funciones puras** en `src/models/actions/`. La clase `BayActions` las delega pasando `(metadata, state)`:

```typescript
// Patrón de cada acción (ejemplo: closeActions.ts)
export async function close(metadata: BayMetadata, state: BayState): Promise<void> {
  if (!state.capabilities.canClose) return;
  const tab = findNativeTab(metadata, state);
  if (tab) await vscode.window.tabGroups.close(tab);
}

// BayActions lo expone como método:
async close(): Promise<void> {
  return actions.close(this.metadata, this.state);
}
```

### Módulos de acciones

| Archivo | Acciones principales |
|---------|---------------------|
| `closeActions.ts` | `close`, `closeOthers`, `closeGroup`, `closeToDown` |
| `pinActions.ts` | `pin`, `unpin` |
| `revealActions.ts` | `revealInExplorer`, `revealInFileExplorer`, `openTimeline` |
| `copyActions.ts` | `copyRelativePath`, `copyAbsolutePath`, `copyContent` |
| `fileActions.ts` | `openInTerminal`, `compareWithActive`, `duplicateFile` |
| `activationActions.ts` | `activate` (con retry para preview tabs) |
| `stateActions.ts` | `updateViewMode`, `addToCopilotContext` |
| `customActions.ts` | `executeCustomAction`, `addCustomAction` |

### Reglas de las acciones
1. **Siempre verificar `bay.metadata.uri`** antes de operaciones de archivo (webviews no tienen URI)
2. Las acciones **mutan `state`** y NO acceden a servicios globales
3. `activateFn` se inyecta como callback para evitar dependencias circulares

## Sistema de FileActions

Acciones que aparecen contextualmente según el tipo de archivo. Definidas en `src/constants/fileActions/`.

```typescript
// FileAction estática (coincide por nombre o extensión)
type FileAction = {
  id: string;
  label: string;
  icon: string;
  match: MatchRule;       // extensiones, nombres, patrones
  setFocus?: boolean;     // ¿Hacer foco en la bay al ejecutar?
  execute: (bay: Bay) => Promise<void>;
};

// DynamicFileAction (se resuelve en runtime por contexto)
type DynamicFileAction = FileAction & {
  resolver: (bay: Bay) => boolean;  // devuelve si aplica
};
```

Las acciones se agrupan por categoría en `quickActions/` (media, web, development, configuration, data, docker, markdown) y se registran en `FileActionRegistry`.

### setFocus

Por defecto las acciones **NO hacen foco**. `setFocus: true` activa la bay después de ejecutar (útil para acciones que abren algo, no para copiar al portapapeles).

## Estado mutable relacionado

```typescript
// Contexto dinámico (cómo se visualiza la bay)
bay.state.actionContext = {
  viewMode?: 'source' | 'preview' | 'split';
  editMode?: 'readonly' | 'editable';
  compareMode?: boolean;
};

// Estado de operación asíncrona
bay.state.operationState = {
  isProcessing: boolean;
  currentOperation?: string;
  canCancel: boolean;
  progress?: number;  // 0-100
};

// Permisos granulares
bay.state.permissions = {
  canRename: boolean;
  canDelete: boolean;
  canMove: boolean;
  restrictedActions?: string[];  // IDs bloqueados
};

// Acciones custom (extensibles)
bay.state.customActions = [{
  id: string; label: string; icon: string;
  execute: (metadata, state) => Promise<void>;
}];
```
