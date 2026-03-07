# 1. Introducción

**Enlaces rápidos**
[📄 Índice general](INDEX.md) | [🛠️ Arquitectura](02_arquitectura.md) | [🎯 Acciones](03_acciones.md) | [📦 Implementación](04_implementacion.md) | [🤖 Agentes Copilot](05_agentes.md)

---

## ¿Qué es Bays?
Bays es una extensión de Visual Studio Code que ofrece una vista lateral personalizada de las pestañas abiertas, con mejoras en control, acciones y servicios integrados (Git, Copilot, etc.). Está pensada para desarrolladores que abren muchos archivos y necesitan manejar pestañas de manera más eficiente.

### Requisitos
- VS Code 1.85.0 o posterior (configurado en `package.json`).
- Node 16+ para compilación de la extensión.

### Instalación y arranque rápido
```bash
npm install
npm run compile   # build único
npm run watch     # recompila en segundo plano durante el desarrollo
# En VS Code: F5 para lanzar el host de desarrollo

```bash
# ejemplo: compilar y lanzar en un paso
npm run watch & code --extensionDevelopmentPath=. --disable-extensions
```
```

Una vez en el host de desarrollo, la vista se activa en la barra lateral bajo el nombre **Bays**.

### Estructura de la documentación
Cada documento explica un aspecto clave:

1. **Introducción** (este archivo): resumen, requisito y guía rápida.
2. **Arquitectura**: modelos, servicios y decisiones de diseño.
3. **Acciones**: sistema de FileActions, enfoque `setFocus` y mejoras avanzadas.
4. **Implementación**: cómo se ha modularizado el código y qué cambios se hicieron.
5. **Agentes Copilot**: cómo un agente o sub‑agente puede entender el proyecto para automatización o contribución.

> **Nota para Copilot/AI**: esta documentación está organizada para facilitar la navegación mediante enlaces; los encabezados y ejemplos son claros y se pueden indexar para que un agente aprenda la estructura del proyecto.
