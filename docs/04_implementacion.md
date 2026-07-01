# 4. Implementación y decisiones técnicas

[📄 Índice](INDEX.md) | [🏁 Introducción](01_introduccion.md) | [🏗️ Arquitectura](02_arquitectura.md) | [🎯 Acciones](03_acciones.md) | [🤖 Agentes](05_agentes.md)

---

## Arquitectura de composición (sin herencia profunda)

```
Bay
  └─ extends BayActions (abstract)
      └─ delega → actions/ (funciones puras)

BayActions recibe activateFn como callback (evita dependencia circular)
```

**Por qué no herencia:** Las acciones son funciones puras testables de forma aislada. Cambiar una acción no afecta a las demás.

## Modularización de servicios (Refactoring Marzo 2026)

`BaySyncService` era monolítico (~900 LOC). Ahora delega en:

| Sub-servicio | Responsabilidad |
|---|---|
| `BayEventService` | Registro de listeners de VS Code |
| `BayHeadService` | Parent placeholders + apertura automática de docs |
| `ActiveStateService` | Sincronización de `isActive` + cleanup de orphans |

**Regla**: `BaySyncService` es un coordinador delgado, no implementa lógica propia.

## Helpers modulares en `models/`

```
models/helpers/
├── tabClassifier.ts     → Clasifica native tabs → BayType
└── tabConverter.ts      → Convierte vscode.Tab → Bay (función pura)

(Internamente en BaySyncService)
```

`convertToBay()` es determinista: mismos inputs → mismo Bay. Excepto git status (async).

## Invariantes críticos

1. `BayMetadata` es **inmutale** tras creación — nunca modificar campos
2. `BayState` es **mutable** — cambios directos + `stateService.notifyChange()`
3. `BayStateService` es **única fuente de verdad** — providers nunca consultan el Tab API
4. **Markdown Preview se filtra** — `viewType === 'markdown.preview'` no crea Bay independiente
5. **Orphans se limpian** en cada evento `closed` — tabs en estado pero no en VS Code se eliminan
6. **IDs son deterministas** — `uri.toString() + '-' + viewColumn`

## Patrones de ID y CSS

```typescript
// IDs contienen caracteres especiales (:, /, %)
// ❌ Incorrecto en webview.js:
document.querySelector(`.bay[data-bayid="${bayId}"]`);

// ✅ Correcto:
document.querySelector(`.bay[data-bayid="${CSS.escape(bayId)}"]`);
```

## Logger

Solo dos métodos permitidos:

```typescript
Logger.error('[NombreModulo] Mensaje:', error);
Logger.warn('[NombreModulo] Advertencia');
// NO usar Logger.info(), Logger.log(), console.log()
```

## Actualización de la vista (dos canales)

```typescript
// Canal completo: reconstruye HTML (estructural)
stateService.notifyChange();      // → onDidChangeState → refresh()

// Canal silencioso: solo CSS (visual leve)
stateService.notifyChangeSilent(); // → onDidChangeStateSilent → refreshSilent()
```

**Usar canal silencioso** para: cambio de tab activa, hover, cursor position.
**Usar canal completo** para: añadir/eliminar/mover bays, pin/unpin, hasVariant.

## Reglas de tamaño de archivos

- **Máximo ~400-500 LOC** por archivo
- Si supera: dividir con separación lógica clara (un módulo = una responsabilidad)
- **Preferir más archivos pequeños** que un monolito

## Proceso de desarrollo

```bash
npm run compile        # verifica tipos + lint + build
npm run watch          # watch mode para desarrollo
# Después de cambios: F5 → recargar Extension Host
```

Verificar siempre:
- [ ] ¿Compila sin errores? (`npm run compile`)
- [ ] ¿Manejé tabs webview (`uri: undefined`)?
- [ ] ¿Usé solo `Logger.error/warn`?
- [ ] ¿Usé `async/await` (sin I/O síncrono)?
