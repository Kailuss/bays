# Plan de Migración: SideTab → Bay

**Contexto:** Los archivos AGENT.md describen una versión futura de la extensión con nomenclatura "Bay" en lugar de "SideTab". Este plan detalla los cambios necesarios para alinear el código actual con esa visión.

**Fecha:** Marzo 2026  
**Estado:** PENDIENTE

---

## 📊 Resumen de Cambios

### Nomenclatura Principal

| Actual | Esperado |
|--------|----------|
| `SideTab` | `Bay` |
| `SideTabMetadata` | `BayMetadata` |
| `SideTabState` | `BayState` |
| `SideTabCapabilities` | `BayCapabilities` (5 campos) |
| `SideTabActions` | `BayActions` |
| `SideTabGroup` | `BayGroup` |
| `SideTabHelpers` | 3 módulos en `models/helpers/` |
| `SideTabType` (6 tipos) | `BayType` (4 tipos) |

### Servicios

| Actual | Esperado |
|--------|----------|
| `TabStateService` | `BayStateService` |
| `TabSyncService` | `BaySyncService` + subdirectorio `bay/` |
| `TabHierarchyService` | `BayHierarchyService` |
| `TabDragDropService` | `BayDragDropService` |
| `TabIconManager` | `BayIconManager` |

### Comandos

| Actual | Esperado |
|--------|----------|
| `tabCommands.ts` | `bayCommands.ts` |
| variables `tab` | variables `bay` |

---

## 📁 Estructura Final Esperada

```
src/
├── models/
│   ├── Bay.ts                     # antes: SideTab.ts
│   ├── BayActions.ts              # antes: SideTabActions.ts
│   ├── BayGroup.ts                # antes: SideTabGroup.ts
│   ├── DocumentModel.ts           # mantener
│   ├── index.ts                   # actualizar exports
│   ├── actions/                   # mantener estructura
│   │   ├── activationActions.ts
│   │   ├── closeActions.ts
│   │   ├── copyActions.ts
│   │   ├── customActions.ts
│   │   ├── fileActions.ts
│   │   ├── index.ts
│   │   ├── pinActions.ts
│   │   ├── revealActions.ts
│   │   └── stateActions.ts
│   └── helpers/                   # NUEVO: extraer de SideTabHelpers.ts
│       ├── nativeTabHelper.ts     # findNativeTab, activateByNativeTab, etc.
│       ├── metadataEnricher.ts    # enrichMetadata, categorizeFile
│       ├── capabilitiesComputer.ts # computeCapabilities, createDefaultState
│       └── index.ts
│
├── services/
│   ├── core/
│   │   ├── BayStateService.ts     # antes: TabStateService.ts
│   │   ├── BaySyncService.ts      # antes: TabSyncService.ts
│   │   ├── BayHierarchyService.ts # antes: TabHierarchyService.ts
│   │   ├── PreviewService.ts      # NUEVO: extraer de TabSyncService
│   │   ├── bay/                   # NUEVO: subdirectorio modular
│   │   │   ├── BayEventService.ts    # VS Code listeners
│   │   │   ├── BayHeadService.ts     # Parent placeholders
│   │   │   └── ActiveStateService.ts # isActive sync
│   │   ├── helpers/               # mantener
│   │   │   ├── tabClassifier.ts   # (quizás renombrar a bayClassifier.ts)
│   │   │   └── tabConverter.ts    # (quizás renombrar a bayConverter.ts)
│   │   └── document/              # mantener
│   │
│   ├── ui/
│   │   ├── BayDragDropService.ts  # antes: TabDragDropService.ts
│   │   ├── BayIconManager.ts      # antes: TabIconManager.ts
│   │   └── ThemeService.ts        # mantener
│   │
│   ├── integration/               # mantener estructura
│   └── registry/                  # mantener
│
├── commands/
│   ├── bayCommands.ts             # antes: tabCommands.ts
│   └── copilotCommands.ts         # mantener
│
├── providers/                     # actualizar imports
└── ...
```

---

## 🔄 Fases de Migración

### FASE 1: Preparación (Sin cambios de código)
- [ ] Crear backup del branch actual
- [ ] Documentar el estado actual en README si es necesario
- [ ] Revisar que no hay errores de compilación actuales
- [ ] Ejecutar tests existentes para baseline

### FASE 2: Modelo Principal (models/)

#### 2.1 Renombrar tipos base
- [ ] **BayType simplificado**: Cambiar de 6 tipos a 4
  ```typescript
  // Antes
  type SideTabType = 'file' | 'diff' | 'webview' | 'custom' | 'notebook' | 'unknown';
  
  // Después
  type BayType = 'file' | 'webview' | 'custom' | 'notebook';
  ```
  - `'diff'` eliminado → los diffs son Bays con `parentId` definido
  - `'unknown'` eliminado → mapear a 'custom' o manejarlo como caso especial

#### 2.2 Simplificar BayCapabilities
- [ ] Reducir de 15+ campos a 5 campos:
  ```typescript
  type BayCapabilities = {
    canClose: boolean;
    canPin: boolean;
    canRevealInExplorer: boolean;
    canTogglePreview: boolean;
    canHaveChildren: boolean;
  };
  ```
- [ ] Mover capacidades adicionales a cálculo on-demand en actions

#### 2.3 Renombrar archivos del modelo
- [ ] `SideTab.ts` → `Bay.ts`
- [ ] `SideTabActions.ts` → `BayActions.ts`
- [ ] `SideTabGroup.ts` → `BayGroup.ts`
- [ ] Actualizar todos los `type SideTab*` → `type Bay*`
- [ ] Actualizar clase `SideTab` → `Bay`
- [ ] Actualizar clase `SideTabActions` → `BayActions`

#### 2.4 Extraer helpers a módulos separados
Crear `models/helpers/` con 3 módulos extraídos de `SideTabHelpers.ts`:

- [ ] **nativeTabHelper.ts** (~160 LOC)
  - `findNativeTab()`
  - `nativeGroup()`
  - `matchesNative()`
  - `activateByNativeTab()`
  - `focusGroup()`
  - `isMarkdownPreview()`
  - Constantes: `WEBVIEW_COMMANDS`, `FOCUS_GROUP_CMDS`

- [ ] **metadataEnricher.ts** (~160 LOC)
  - `enrichMetadata()`
  - `categorizeFile()`
  - `categorizeNonFileTab()`
  - `mapPreviewModeToViewMode()`

- [ ] **capabilitiesComputer.ts** (~105 LOC)
  - `computeCapabilities()`
  - `createDefaultState()`
  - `createEmptyCapabilities()`

- [ ] `SideTabHelpers.ts` → Eliminar después de extraer (o mantener como re-export)

#### 2.5 Actualizar index.ts del modelo
- [ ] Exportar `Bay`, `BayMetadata`, `BayState`, `BayCapabilities`, `BayType`, etc.
- [ ] Exportar helpers desde `./helpers`

### FASE 3: Servicios Core (services/core/)

#### 3.1 Renombrar servicios principales
- [ ] `TabStateService.ts` → `BayStateService.ts`
  - Renombrar clase `TabStateService` → `BayStateService`
  - Actualizar métodos: `getTab()` → `fetchBayById()` (según AGENT.md)
  - Actualizar eventos: mantener nombres pero usar Bay internamente

- [ ] `TabSyncService.ts` → `BaySyncService.ts`
  - Renombrar clase `TabSyncService` → `BaySyncService`
  - Actualizar referencias internas

- [ ] `TabHierarchyService.ts` → `BayHierarchyService.ts`
  - Renombrar clase `TabHierarchyService` → `BayHierarchyService`

#### 3.2 Crear subdirectorio bay/ (modularización)
Extraer de `BaySyncService` según arquitectura en AGENT.md:

- [ ] **services/core/bay/BayEventService.ts**
  - Registro de listeners de VS Code
  - `handleTabChanges()`, `handleGroupChanges()`, etc.

- [ ] **services/core/bay/BayHeadService.ts**
  - Gestión de placeholders para parents
  - `ensureParentExists()`, `createParentPlaceholder()`, `replaceWithRealParent()`

- [ ] **services/core/bay/ActiveStateService.ts**
  - Sincronización de `isActive`
  - `syncActiveState()`, `syncPreviewOwnership()`, `removeOrphanedTabs()`

- [ ] **services/core/PreviewService.ts** (si no existe)
  - Gestión del Markdown Preview
  - `showPreviewFor()`, `hidePreview()`, tracking de ownership

#### 3.3 Actualizar helpers
- [ ] Considerar renombrar `tabClassifier.ts` → `bayClassifier.ts`
- [ ] Considerar renombrar `tabConverter.ts` → `bayConverter.ts`
- [ ] Actualizar imports de `SideTab` → `Bay`

### FASE 4: Servicios UI (services/ui/)

- [ ] `TabDragDropService.ts` → `BayDragDropService.ts`
  - Renombrar clase `TabDragDropService` → `BayDragDropService`

- [ ] `TabIconManager.ts` → `BayIconManager.ts`
  - Renombrar clase `TabIconManager` → `BayIconManager`

- [ ] `ThemeService.ts` → Mantener nombre

### FASE 5: Comandos (commands/)

- [ ] `tabCommands.ts` → `bayCommands.ts`
  - Renombrar función `registerTabCommands()` → `registerBayCommands()`
  - Variable `tab` → `bay`
  - Variable `resolve` retorna `Bay | undefined`
  - Comentarios actualizados

### FASE 6: Providers

- [ ] Actualizar todos los imports para usar `Bay*` en lugar de `SideTab*`
- [ ] Actualizar referencias de `TabStateService` → `BayStateService`
- [ ] Variables locales `tab` → `bay` donde sea apropiado

### FASE 7: Extension.ts y Punto de Entrada

- [ ] Actualizar instanciación de servicios:
  - `new TabStateService()` → `new BayStateService()`
  - `new TabSyncService()` → `new BaySyncService()`
  - etc.
- [ ] Actualizar llamadas a `registerTabCommands()` → `registerBayCommands()`
- [ ] Actualizar imports

### FASE 8: Actualización de Imports Global

- [ ] Buscar y reemplazar en todos los archivos:
  - `import { SideTab` → `import { Bay`
  - `import type { SideTab` → `import type { Bay`
  - `from '../models/SideTab'` → `from '../models/Bay'`
  - etc.

### FASE 9: Verificación y Testing

- [ ] `npm run compile` - sin errores
- [ ] Revisar todos los warnings
- [ ] Ejecutar tests
- [ ] Probar en Extension Development Host:
  - [ ] Abrir tabs normales
  - [ ] Abrir webviews (Settings, Extensions)
  - [ ] Crear diffs de Git
  - [ ] Pin/unpin tabs
  - [ ] Drag & drop
  - [ ] Markdown preview toggle
  - [ ] Copilot integration

### FASE 10: Limpieza Final

- [ ] Eliminar archivos obsoletos (`SideTab*.ts` si se crearon nuevos)
- [ ] Actualizar comentarios y JSDoc
- [ ] Verificar que AGENT.md coincide con el código
- [ ] Actualizar ARCHITECTURE.md si es necesario
- [ ] Actualizar CHANGELOG.md

---

## 🚨 Puntos Críticos de Atención

### 1. BayType Simplificado
El cambio de 6 a 4 tipos requiere:
- Revisar todas las comparaciones con `tabType`/`bayType`
- Asegurar que 'diff' tabs ahora son 'file' con `parentId`
- Asegurar que 'unknown' se mapea correctamente

### 2. BayCapabilities Reducido
Solo 5 campos en vez de 15+:
- Mover lógica de capacidades a actions (on-demand)
- Revisar UI que dependa de capabilities específicas

### 3. Estructura de Helpers
`SideTabHelpers.ts` es monolítico (489 LOC) → dividir en 3 módulos:
- Sin romper funcionalidad existente
- Mantener exports compatibles temporalmente si es necesario

### 4. Modularización de BaySyncService
El AGENT.md espera subdirectorio `bay/` con 3 servicios:
- `BayEventService`
- `BayHeadService` 
- `ActiveStateService`

Esto es una refactorización significativa del actual `TabSyncService`.

### 5. Variables Internas
Muchas funciones usan `tab` como nombre de variable:
- Decidir: ¿renombrar todo a `bay`?
- O mantener `tab` para referirse a VS Code native tabs?

**Recomendación del AGENT.md:**
- `bay` para instancias de `Bay`
- `nativeTab` para `vscode.Tab`

---

## 📋 Orden de Ejecución Recomendado

1. **Tipos y modelo base** (Fase 2.1, 2.2) - Low risk
2. **Renombrar archivos modelo** (Fase 2.3) - Medium risk
3. **Extraer helpers** (Fase 2.4) - Medium risk
4. **Renombrar servicios** (Fase 3.1, 4) - Medium risk
5. **Modularizar BaySyncService** (Fase 3.2) - High risk
6. **Comandos y extension.ts** (Fase 5, 7) - Low risk
7. **Providers** (Fase 6) - Medium risk
8. **Testing exhaustivo** (Fase 9) - Critical
9. **Limpieza** (Fase 10) - Low risk

---

## 🔧 Comandos Útiles Durante Migración

```powershell
# Compilar y verificar errores
npm run compile

# Buscar referencias restantes
grep -r "SideTab" src/
grep -r "TabStateService" src/
grep -r "TabSyncService" src/

# Ejecutar tests
npm test

# Watch mode para desarrollo
npm run watch
```

---

## ⏱️ Estimación de Tiempo

| Fase | Estimación |
|------|------------|
| Fase 1: Preparación | 30 min |
| Fase 2: Modelo | 3-4 horas |
| Fase 3: Servicios Core | 4-6 horas |
| Fase 4: Servicios UI | 1 hora |
| Fase 5: Comandos | 30 min |
| Fase 6: Providers | 2 horas |
| Fase 7: Extension | 30 min |
| Fase 8: Imports | 1-2 horas |
| Fase 9: Testing | 2-3 horas |
| Fase 10: Limpieza | 1 hora |
| **TOTAL** | **15-20 horas** |

---

## ✅ Criterios de Éxito

- [ ] `npm run compile` sin errores
- [ ] `npm test` pasa
- [ ] Extension funciona en Dev Host
- [ ] Nomenclatura consistente con AGENT.md
- [ ] Estructura de archivos coincide con esperada
- [ ] No hay `SideTab` en el código (excepto comentarios históricos si aplica)
