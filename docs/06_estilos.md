# 6. Guía de Estilos

[📄 Índice](INDEX.md) | [🏁 Introducción](01_introduccion.md) | [🏗️ Arquitectura](02_arquitectura.md) | [🤖 Agentes](05_agentes.md)

---

## Archivos CSS

```
src/styles/
├── webview.css           # Punto de entrada + imports
├── base.css              # Reset, variables CSS, estilos globales
├── group-header.css      # Cabeceras de grupos de tabs
├── bay-layout.css        # Layout de BAYS NORMALES (altura, padding, flex)
├── bay-content.css       # Texto: label, path, truncation
├── bay-states.css        # Estados interactivos (active, hover, drag)
├── bay-animations.css    # Transiciones y animaciones
├── bay-file-states.css   # Estados de archivo (git, dirty, diagnostics)
├── bay-actions.css       # Botones de acción de BAYS NORMALES
├── variants.css          # Todo lo de VARIANTS (layout + iconos + acciones)
├── context-menu.css      # Menú contextual propio (réplica del nativo)
└── utilities.css         # Clases utilitarias
```

### Separación crítica

**Normal bays** y **variants** tienen sistemas de estilos **completamente separados**.

- Bays normales: `bay-layout.css` + `bay-actions.css`
- Variants: todo en `variants.css`

**NO usar selectores genéricos que afecten ambos**. Especificar siempre:
- `.bay:not(.variant)` para bays normales
- `.bay.variant` para variants

---

## Estructura HTML

### Bay normal

```html
<div class="bay-block">
  <div class="bay [active] [pinned] [dirty] [compact]"
       data-bay-id="..."
       data-pinned="true|false"
       data-groupid="1">
    <span class="bay-icon">
      <img src="...base64..." />   <!-- o codicon -->
    </span>
    <div class="bay-text">
      <div class="bay-name">index.ts</div>
      <div class="bay-path">src/services/</div>
    </div>
    <span class="bay-state">M</span>   <!-- git / dirty badge -->
    <span class="bay-actions">
      <button data-action="pinBay">...</button>
      <button data-action="closeBay">×</button>
    </span>
  </div>

  <!-- Variants (si las hay) -->
  <div class="bay variant [active] diff-working-tree" data-bay-id="...">
    ...
  </div>
</div>
```

### Variant (child bay / diff)

```html
<div class="bay variant [active] [diff-working-tree|diff-staged|diff-snapshot|diff-commit|diff-edit|diff-conflict]"
     data-bay-id="...">
  <span class="bay-icon"><i class="codicon codicon-diff"></i></span>
  <div class="bay-text">
    <div class="bay-name">Working Tree</div>
  </div>
  <span class="bay-actions">
    <button data-action="closeBay">×</button>
  </span>
</div>
```

---

## Comparativa Normal vs Variant

| Propiedad | Bay normal | Variant |
|-----------|------------|---------|
| **Altura** | 39px (28px compact) | 22px |
| **CSS class** | `.bay` | `.bay.variant` |
| **Padding** | `0 8px` | `padding-left: 36px` |
| **Icono (codicon)** | 16px | 12px |
| **Icono (img)** | 18×18px | 14×14px |
| **Fondo** | `transparent` | `#0003` |
| **Fondo active** | `vscode-list-activeSelectionBackground` | igual + `border-left: 4px` |
| **Contenedor** | `.bay-block` (wrapper) | dentro del mismo `.bay-block` |

---

## Variables CSS importantes

```css
/* Definidas en :root (base.css) */
--vscode-bay-inactiveBackground
--vscode-bay-inactiveForeground
--vscode-bay-activeBackground
--vscode-bay-activeForeground

/* Heredadas de VS Code */
--vscode-list-activeSelectionBackground
--vscode-focusBorder
--vscode-editorGroupHeader-tabsBorder
```

---

## Clases de estado

```css
.bay.active          /* tab actualmente visible */
.bay.dirty           /* cambios sin guardar (isDirty) */
.bay.pinned          /* tab fijada */
.bay.compact         /* modo compacto (29px altura) */
.bay.preview         /* tab en modo preview (itálica) */
.bay.dragging        /* durante drag & drop */
.bay.drag-over       /* destino de drop */

/* Variante con borde de color según diffType */
.bay.variant.diff-working-tree
.bay.variant.diff-staged
.bay.variant.diff-snapshot
.bay.variant.diff-commit
.bay.variant.diff-edit
.bay.variant.diff-conflict
```

---

## Cabeceras de grupo (`group-header.css`)

`GroupHeaderRenderer` emite `<div class="group-header" data-groupid data-color data-locked>` con un botón de colapso (`data-action="toggleGroup"`) y botones de rename/color/lock. El color del grupo se lee de `data-color` (blue/green/yellow/orange/red/purple) y mapea a tokens `--vscode-charts-*`, por lo que sigue el tema. Un grupo con `data-locked="true"` muestra el candado de forma persistente y oculta los cierres.

---

## Añadir nuevos estilos: guía rápida

1. **¿Afecta solo a bays normales?** → `bay-layout.css` o `bay-actions.css`
2. **¿Afecta solo a variants?** → `variants.css`
3. **¿Es un estado interactivo?** → `bay-states.css`
4. **¿Es un estado de archivo?** → `bay-file-states.css`
5. **¿Es animación/transición?** → `bay-animations.css`

**Siempre prefixar con `.bay` o `.bay.variant`** — no selectores globales.
