# Guía de Estilos - Bays

## Índice
1. [Arquitectura de Estilos](#arquitectura-de-estilos)
2. [Normal Tabs vs Child Tabs](#normal-tabs-vs-child-tabs)
3. [Sistema de Iconos](#sistema-de-iconos)
4. [Sistema de Hover](#sistema-de-hover)
5. [Botones de Acción](#botones-de-acción)
6. [Guía de Modificación](#guía-de-modificación)

---

## Arquitectura de Estilos

Los estilos están organizados en módulos especializados ubicados en `src/styles/`:

```
src/styles/
├── webview.css           # Punto de entrada, imports y documentación
├── base.css              # Reset, variables CSS, estilos globales
├── group-header.css      # Encabezados de grupos de tabs
├── tab-layout.css        # Layout base + iconos de TABS NORMALES
├── child-tabs.css        # Todo lo relacionado con CHILD TABS
├── tab-states.css        # Estados interactivos (active, hover, drag)
├── tab-animations.css    # Transiciones y animaciones
├── tab-content.css       # Contenido de texto (labels, paths)
├── tab-file-states.css   # Estados de archivos (git, dirty, etc.)
├── tab-actions.css       # Botones de acción de TABS NORMALES
└── utilities.css         # Clases utilitarias
```

### Principio de Separación

**CRÍTICO**: Normal tabs y child tabs tienen sistemas de estilos completamente separados.

- **Normal tabs**: Estilos en `tab-layout.css` + `tab-actions.css`
- **Child tabs**: TODO en `child-tabs.css` (layout, iconos, acciones)

**No usar selectores genéricos que afecten ambos tipos**. Siempre especificar:
- `.tab:not(.child-tab)` para tabs normales
- `.tab.child-tab` para child tabs

---

## Normal Tabs vs Child Tabs

### Comparación Visual

| Propiedad | Normal Tabs | Child Tabs |
|-----------|-------------|------------|
| **Altura** | 39px (29px compact) | 20px |
| **Padding** | `0 8px 0 0` | `0 12px 0 32px` |
| **Iconos** | 22×22px, fontSize 16px | 14×14px, fontSize 13px |
| **Iconos img** | 18×18px | 14×14px |
| **Botones** | 20×20px, fontSize 13px | 16×16px, fontSize 11px |
| **Botones img** | 14×14px | 12×12px |
| **Gap botones** | 4px | 2px |
| **Border-left** | 5px (transparente) | 3px (coloreado) |
| **Hover fondo** | No cambia | `rgba(128,128,128,0.12)` |
| **Margin iconos** | `0 8px 0 0` | `0 6px 0 0` |

### Normal Tab Structure

```html
<div class="tab" data-tabid="..." data-pinned="..." data-groupid="...">
  <span class="tab-icon">🔵</span>
  <div class="tab-text">
    <div class="tab-name">index.ts</div>
    <div class="tab-path">src/</div>
  </div>
  <span class="tab-state state-modified">M</span>
  <span class="tab-actions">
    <button data-action="...">▶</button>
    <button data-action="closeTab">×</button>
  </span>
</div>
```

### Child Tab Structure

```html
<div class="tab child-tab" data-tabid="..." data-parentid="..." data-groupid="...">
  <span class="tab-icon">📊</span>
  <div class="child-label">
    <span class="child-name">Working Tree</span>
    <span class="child-stats">
      <span class="stats-added">+12</span>
      <span class="stats-removed">-5</span>
    </span>
  </div>
  <span class="state-indicator-error">⚠</span>
  <span class="tab-actions">
    <button data-action="closeTab">×</button>
  </span>
</div>
```

---

## Sistema de Iconos

### Normal Tabs

**Archivo**: `tab-layout.css`

```css
.tab:not(.child-tab) .tab-icon {
  width: 22px;
  min-width: 22px;
  height: 22px;
  margin: 0 8px 0 0;
  opacity: 0.9;
}

/* CRÍTICO: Selector específico para codicon con !important */
.tab:not(.child-tab) .tab-icon .codicon[class*='codicon-'] {
  font-size: 16px !important;
}

.tab:not(.child-tab) .tab-icon img {
  width: 18px;
  height: 18px;
}
```

**Uso**:
- Iconos codicon: `<span class="codicon codicon-file"></span>`
- Iconos base64: `<img src="data:image/png;base64,..." />`
- Renderizado por `IconRenderer.render()`

### Child Tabs

**Archivo**: `child-tabs.css`

```css
.tab.child-tab .tab-icon {
  width: 14px;
  min-width: 14px;
  height: 14px;
  margin: 0 6px 0 0;
  opacity: 0.75;
}

/* CRÍTICO: Selector específico para codicon con !important */
.tab.child-tab .tab-icon .codicon[class*='codicon-'] {
  font-size: 13px !important;
}

.tab.child-tab .tab-icon img {
  width: 14px;
  height: 14px;
}
```

**Tipos de iconos child**:
- `codicon-diff`: Diff genérico
- `codicon-source-control`: Working tree
- `codicon-git-stage`: Staged
- `codicon-history`: Snapshot
- `codicon-git-merge`: Merge conflict
- `codicon-arrow-down`: Incoming
- `codicon-arrow-right`: Current

**Renderizado**: `BaysHtmlBuilder.renderChildTab()`

---

## Sistema de Hover

### Normal Tabs

**NO** cambian fondo en hover (como las tabs nativas de VS Code).

```css
.tab:not(.child-tab):hover {
  /* Solo cambia opacidad de iconos, NO fondo */
}

.tab:not(.child-tab):hover .tab-icon {
  opacity: 1;
}

.tab:not(.child-tab):hover .tab-state {
  display: none;  /* Ocultar estado */
}

.tab:not(.child-tab):hover .tab-actions {
  display: flex;  /* Mostrar botones */
}
```

### Child Tabs

**SÍ** cambian fondo en hover (indican interactividad).

```css
.tab.child-tab:hover {
  opacity: 1;
  background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12));
  border-left-color: var(--vscode-list-hoverForeground, #e2c08d);
}

.tab.child-tab:hover .tab-icon {
  opacity: 0.9;
}

.tab.child-tab:hover .child-stats {
  display: none;  /* Ocultar stats */
}

.tab.child-tab:hover .tab-actions {
  display: flex;  /* Mostrar botones */
}
```

**Transiciones**:
- Normal tabs: 200ms cubic-bezier (drag & drop)
- Child tabs: 120ms ease (más rápido)

---

## Botones de Acción

### Normal Tabs

**Archivo**: `tab-actions.css`

**Dimensiones**:
```css
.tab:not(.child-tab) .tab-actions button {
  width: 20px;
  height: 20px;
  font-size: 13px;  /* Codicons */
  gap: 4px;         /* Entre botones */
}

.tab:not(.child-tab) .tab-actions button img {
  width: 14px;      /* Iconos de imagen */
  height: 14px;
}
```

**Hover**:
```css
.tab:not(.child-tab) .tab-actions button:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,0.31));
  transform: scale(1.08);
}
```

**Tipos**:
- `data-action="fileAction"`: Acción personalizada por tipo de archivo
- `data-action="addToChat"`: Agregar a Copilot Chat
- `data-action="closeTab"`: Cerrar tab

### Child Tabs

**Archivo**: `child-tabs.css`

**Dimensiones**:
```css
.tab.child-tab .tab-actions button {
  width: 16px;
  height: 16px;
  font-size: 11px;
  gap: 2px;
}

.tab.child-tab .tab-actions button img {
  width: 12px;
  height: 12px;
}
```

**Hover**:
```css
.tab.child-tab .tab-actions button:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,0.2));
  transform: scale(1.05);  /* Menos zoom que normal tabs */
}
```

**Tipos**:
- `data-action="closeTab"`: Cerrar diff (único botón disponible)

---

## Guía de Modificación

### Cambiar Tamaño de Iconos

**Normal tabs**:
```css
/* En tab-layout.css */
.tab:not(.child-tab) .tab-icon {
  width: 24px;        /* Cambiar aquí */
  min-width: 24px;
  height: 24px;
}

.tab:not(.child-tab) .tab-icon .codicon[class*='codicon-'] {
  font-size: 18px !important;  /* Codicons escalan proporcional */
}
```

**Child tabs**:
```css
/* En child-tabs.css */
.tab.child-tab .tab-icon {
  width: 18px;        /* Cambiar aquí */
  min-width: 18px;
  height: 18px;
}

.tab.child-tab .tab-icon .codicon[class*='codicon-'] {
  font-size: 16px !important;  /* Codicons escalan proporcional */
}
```

### Cambiar Altura de Tabs

**Normal tabs**:
```css
/* En tab-layout.css */
.tab {
  height: 42px;  /* Cambiar aquí */
}

.tab.compact {
  height: 32px;  /* Cambiar aquí */
}
```

**Child tabs**:
```css
/* En child-tabs.css */
.tab.child-tab {
  height: 26px;  /* Cambiar aquí */
}
```

### Cambiar Comportamiento de Hover

**Normal tabs**:
```css
/* En tab-layout.css o tab-states.css */
.tab:not(.child-tab):hover {
  background: var(--vscode-list-hoverBackground);  /* Agregar fondo */
}
```

**Child tabs**:
```css
/* En child-tabs.css */
.tab.child-tab:hover {
  background: rgba(128,128,128,0.15);  /* Más intenso */
}
```

### Agregar Nuevo Tipo de Child Tab

1. **Definir diffType** en TypeScript:
```typescript
// En models/SideTab.ts
type DiffType = 'working-tree' | 'staged' | 'snapshot' | 'nuevo-tipo';
```

2. **Agregar icono** en HTML:
```typescript
// En BaysHtmlBuilder.renderChildTab()
case 'nuevo-tipo':
  iconHtml = '<span class="codicon codicon-mi-icono"></span>';
  break;
```

3. **Agregar estilos** (opcional):
```css
/* En child-tabs.css */
.tab.child-tab[data-difftype="nuevo-tipo"] {
  border-left-color: #custom-color;
}
```

### Variables CSS Clave

```css
/* Colores Git */
--vscode-gitDecoration-modifiedResourceForeground: #e2c08d;
--vscode-gitDecoration-addedResourceForeground: #73c991;
--vscode-gitDecoration-deletedResourceForeground: #c74e39;

/* Backgrounds */
--vscode-list-hoverBackground: rgba(128,128,128,0.12);
--vscode-list-activeSelectionBackground: rgba(90,93,94,0.25);
--vscode-toolbar-hoverBackground: rgba(90,93,94,0.31);

/* Bordes */
--vscode-focusBorder: #007acc;
--vscode-editorGroupHeader-tabsBorder: rgba(128,128,128,0.35);
```

---

## Reglas de Oro

1. **NUNCA** usar `.tab-icon` solo → Especificar `.tab:not(.child-tab) .tab-icon` o `.tab.child-tab .tab-icon`
2. **NUNCA** usar `.tab-actions button` solo → Especificar target específico
3. **SIEMPRE** usar `flex-shrink: 0` en iconos y botones
4. **SIEMPRE** usar `flex: 0 0 auto` en contenedores de iconos (no flex-basis fijo)
5. **SIEMPRE** usar transiciones en hover (120-200ms)
6. **MANTENER** proporciones: normal tabs ≈ 1.4× child tabs (22px vs 14px iconos)
7. **ORDEN DE IMPORTS**: child-tabs.css debe venir DESPUÉS de tab-content.css para override
8. **ICONOS CODICON**: Usar selectores `.tab-icon .codicon` con `!important` para sobrescribir el global `font: 10px`
9. **DOCUMENTAR** en este archivo cualquier cambio arquitectónico

### ⚠️ Problema Conocido: Codicon Font-Size Global

Los iconos codicon tienen un estilo global que establece:
```css
.codicon[class*='codicon-'] {
    font: normal normal normal 10px/1 codicon;
}
```

La propiedad `font` shorthand sobrescribe cualquier `font-size` definido en `.tab-icon`. 

**Solución**: Usar selectores más específicos con `!important`:
```css
.tab.child-tab .tab-icon .codicon[class*='codicon-'] {
  font-size: 13px !important;
}
```

---

## Ejemplo Completo: Agregar Badge de "Nuevo"

```css
/* En child-tabs.css */
.tab.child-tab.new::after {
  content: 'NEW';
  position: absolute;
  top: 2px;
  right: 6px;
  font-size: 8px;
  font-weight: bold;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  padding: 1px 4px;
  border-radius: 2px;
}
```

```typescript
// En BaysHtmlBuilder.renderChildTab()
const newBadge = tab.metadata.isNew ? ' new' : '';
return `<div class="tab child-tab${activeClass}${newBadge}" ...>`;
```

---

**Ver también**:
- [Arquitectura](./02_arquitectura.md) → Componentes de renderizado
- [Implementación](./04_implementacion.md) → BaysHtmlBuilder
- [INDEX](./INDEX.md) → Documentación completa
