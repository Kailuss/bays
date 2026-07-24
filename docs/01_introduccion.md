# 1. Introducción

[📄 Índice](INDEX.md) | [🛠 Arquitectura](02_arquitectura.md) | [🎯 Acciones](03_acciones.md) | [📦 Implementación](04_implementacion.md) | [🤖 Agentes](05_agentes.md) | [🎨 Estilos](06_estilos.md)

---

## ¿Qué es Bays?

Extensión de VS Code que sustituye la barra horizontal de pestañas por una **lista vertical de "bays"** en la barra lateral: agrupa, ordena y decora los editores abiertos con integración Git, Copilot y Claude Code. La UI es un `WebviewView` (HTML/CSS puro) para control total de layout y hover. Se activa en `onStartupFinished`.

El término de dominio es **"Bay"**, no "Tab".

## Requisitos

- VS Code 1.85.0+
- Node 18+ / npm para compilación

## Arranque rápido

```bash
npm install
npm run compile   # build de verificación
npm run watch     # watch mode (desarrollo)
# F5 en VS Code → lanza el Extension Development Host
```

La vista aparece en la Activity Bar bajo el nombre **Bays**.

## Estructura del código

```
src/
├── extension.ts        # Punto de entrada: construye servicios y registra el provider
├── models/             # Bay (modelo), BayActions, BayGroup, BayHelpers, DocumentModel + actions/ puras
├── providers/          # BaysWebviewProvider, BaysHtmlBuilder, BayContextMenu, GroupActions,
│                       #   renderers/ (BayRow, GroupHeader, VariantRow) y html/ (Icon, Styles)
├── services/
│   ├── core/           # BaySyncService, BayStateService, BayHierarchyService, DocumentManager,
│   │                   #   bay/ (BayEventService, BayHeadService, ActiveStateService), helpers/ (tabConverter, tabClassifier)
│   ├── ui/             # BayIconManager, ThemeService, BayDragDropService, GroupCustomizationService
│   ├── integration/    # GitSyncService, CopilotService, ClaudeConversationService
│   └── registry/       # FileActionRegistry
├── commands/           # bayCommands, groupCommands, copilotCommands
├── constants/          # commands, diffTypes, fileQuickActions/, styles, timings
├── webview/            # JS cliente: webview.js, dragdrop.js, contextmenu.js, pathTruncation.js
├── styles/             # CSS modular de la vista (incluye context-menu.css)
└── utils/              # logger, builtinIcons, webviewExtensionIcons, iconMarkers, languageRegistry, pathFormatters, stateIndicator
```

## Solución de problemas frecuentes

| Síntoma | Causa | Solución |
|---------|-------|----------|
| Lista vacía | Build desactualizado | `npm run compile`, recargar ventana de desarrollo |
| `[UriError]` en consola | URI falsa en bay webview | Asegurar `uri: undefined` en `BayMetadata` |
| Iconos faltantes | Tema no cargado | Revisar logs de `BayIconManager.buildIconMap()` |
| Activación lenta (>5s) | I/O síncrono | Verificar que se usa `fs/promises` |
| Cambios no reflejados | `dist/` desactualizado | Matar watch, `npm run compile`, relanzar |
