# 1. Introducción

[📄 Índice](INDEX.md) | [🛠 Arquitectura](02_arquitectura.md) | [🎯 Acciones](03_acciones.md) | [📦 Implementación](04_implementacion.md) | [🤖 Agentes](05_agentes.md) | [🎨 Estilos](06_estilos.md)

---

## ¿Qué es Bays?

Extensión de VS Code con **vista lateral de pestañas** mejorada: agrupa, ordena y decora tabs con integración Git y Copilot. La UI es un `WebviewViewProvider` (HTML/CSS puro) para control total de layout y hover.

## Requisitos

- VS Code 1.85.0+
- Node 16+ para compilación

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
├── extension.ts        # Punto de entrada: activa servicios y registra el provider
├── models/             # Bay (modelo), BayActions, helpers, actions puras
├── providers/          # BaysWebviewProvider: HTML/CSS + mensajería
├── services/
│   ├── core/           # BaySyncService (sync), BayStateService (store)
│   ├── ui/             # BayIconManager, ThemeService, BayDragDropService
│   └── integration/    # GitSyncService, CopilotService
├── commands/           # Registro de comandos VS Code
├── constants/          # FileActions, iconos, estilos, timings
├── webview/            # JS cliente: dragdrop.js, webview.js, pathTruncation.js
├── styles/             # CSS modular de la vista
└── utils/              # Logger, fileFormatters, stateIndicator
```

## Solución de problemas frecuentes

| Síntoma | Causa | Solución |
|---------|-------|----------|
| Lista vacía | Build desactualizado | `npm run compile`, recargar ventana de desarrollo |
| `[UriError]` en consola | URI falsa en bay webview | Asegurar `uri: undefined` en `BayMetadata` |
| Iconos faltantes | Tema no cargado | Revisar logs de `BayIconManager.buildIconMap()` |
| Activación lenta (>5s) | I/O síncrono | Verificar que se usa `fs/promises` |
| Cambios no reflejados | `dist/` desactualizado | Matar watch, `npm run compile`, relanzar |
