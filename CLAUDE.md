# CLAUDE.md

Guía para trabajar en este repositorio.

**Idioma**: todo lo que se publica está **en inglés** — los comentarios del
código, los nombres de los tests, el README y el CHANGELOG. Mantén esa
convención al tocar `src/`. Este fichero es la excepción y va en español: es la
guía interna, no viaja en el `.vsix` (lo excluye `.vscodeignore`) y no la lee
nadie de fuera. Es la misma regla que sigue Atria, la extensión hermana.

**Y es el ÚNICO documento interno.** Fueron cinco capas —este fichero, un
`ARCHITECTURE.md`, un agente de Copilot en `.github/agents/`, un `AGENT.md` por
carpeta de `src/` y una guía didáctica en `docs/`— con 7598 líneas entre todas.
Lo que las tumbó no es el tamaño sino que **el mismo hecho estaba escrito en
cinco sitios**: el día que el shell dejó de reasignarse se corrigieron dos, y las
otras tres siguieron diciendo que `refresh()` escribe `webview.html`. Ninguno de
los dos checks podía verlo — comprueban que una RUTA exista y que un
IDENTIFICADOR exista, no que la frase de alrededor siga siendo verdad.

Lo que se conservó de aquellas capas es lo que ninguna otra cosa dice: los
invariantes, los casos que se aprendieron a base de romperse y lo que cuesta cada
decisión. Lo que se tiró son unas 2000 líneas de «REAL OBSERVED EXAMPLES»
—trazas en YAML narrando paso a paso lo que el código hace— y unas 600 de
catálogos de cadenas de log. Las dos cosas se pudren en silencio y las dos se
leen mejor en el código.

## Qué es

Extensión de VS Code (`Kailuss.bays`, pide VS Code ≥ 1.85). Sustituye la barra
horizontal de pestañas por una **lista vertical de «bays»** —los editores
abiertos— dibujada dentro de un `WebviewView` en la barra lateral, con grupos,
variantes y estado de git. Se activa en `onStartupFinished`.

**El término del dominio es «bay» y no «tab».** Una pestaña nativa de VS Code es
una `vscode.Tab`; una bay es lo que esta extensión sabe de ella.

## Comandos

```bash
npm install
npm run watch         # esbuild --watch + tsc --noEmit --watch (los dos proyectos); F5 → Extension Development Host
npm run compile       # la puerta de calidad: check-types + lint + test + check-docs + check-layers + build de desarrollo
npm run package       # lo mismo más check-release, y un build de producción (minificado, sin sourcemaps)
npm run check-types   # tsc --noEmit sobre LOS DOS tsconfig
npm run lint          # eslint src
npm test              # bundlea src/test/*.test.ts → out/test/ y lo corre con node --test
npm run check-docs    # las rutas que cita la prosa existen, y lo publicado no lleva rayas
npm run check-layers  # las capas, los ids de comando, los ajustes, lo que se desmonta, la frontera de confianza, el contrato del webview y los bundles de l10n
npm run check-release # la versión del manifiesto tiene entrada propia, fechada y única, en el changelog
npm run vsix          # vsce package, con el canal derivado de la versión
npm run release       # lo mismo, publicando
npm run test:integration  # bundlea src/test-integration/ y lo corre DENTRO de un VS Code real
```

`npm run compile` es la puerta de calidad y es lo que corre el CI
(`.github/workflows/ci.yml`, Node 22 y 24 × Linux y Windows). **El lint sale
LIMPIO: 0 errores y 0 warnings, y ésa es la línea.** Un warning nuevo no se
asume: se arregla o se justifica aquí — un warning permanente acaba en warning
que nadie lee.

**Lo que lee JSON ajeno pide `unknown` y no `any`**, y la diferencia es justo la
que importa: `unknown` no se puede leer sin comprobarlo antes, así que obliga a
que la comprobación exista, mientras que `any` deja que falte y compile. Los
temas de iconos, los temas de producto y la API de git entran por ahí, y los tres
tienen su narrador mínimo al lado (`asRecord`, `asString`).

**Hace falta Node 22.22.2+ o 24.15+**: `npm test` le pasa un glob a `node --test`,
y las versiones anteriores no lo expanden. `engines.node` copia el rango que
imponen `eslint` y sus vecinas, porque con un `>=22` a secas `npm install` avisa
de EBADENGINE por dependencias que el propio `package.json` da por satisfechas.

### Dos suites de tests, y el corte es el asunto

- **`src/test/` es PURA**: no importa `vscode`, esbuild la bundlea y `node --test`
  la corre en unos 150 ms, así que corre mientras trabajas. Son 103 casos sobre
  los módulos de `src/utils/` y `src/shared/`.
- **`src/test-integration/` es lo que solo se puede afirmar DENTRO de un VS Code
  real** —las clases `TabInput*`, la activación, los comandos registrados— y paga
  una descarga y un extension host, así que es un paso propio. Son 9 casos.

**Si sacas lógica no trivial de un módulo que importa `vscode`, muévela a
`src/utils/` como función pura y dale tests.** Es el patrón que ya siguen
`idRules.ts`, `pathParts.ts`, `diffRules.ts` y `stateIndicator.ts`: **la REGLA
recibe lo que la plataforma resolvió** —una uri como cadena, un esquema, una ruta
relativa— en vez de importarlo, y el adaptador que la alimenta vive en
`platform/` o al lado de quien la llama. `bayStateCode` es el ejemplo entero:
recibe una forma estrecha de tres campos (`BayStateFacts`) que una `Bay`
satisface tal cual, así que la precedencia se fija con tests que corren sin
extension host.

## Lo que el build se niega a dejar pasar

La puerta de calidad no comprueba lo que PRODUCE, así que los fallos que importan
son los que salen en **verde**. Los corta `esbuild.js`:

- **El entry point de CSS ausente, un `@import` que no resuelve, y una hoja de
  `src/styles/` que no importa nadie.** La tercera es la que no cubría nada: una
  hoja que EXISTE y que nadie importa se cae del bundle con el build en verde, y
  sus reglas sencillamente no llegan al panel — que se ve como lo que la cascada
  deje y no como un error. Las tres van por `process.exitCode` y no por `throw`,
  porque corren dentro del `onEnd` del watch, una línea antes del
  `[watch] build finished` que `.vscode/tasks.json` declara como su
  `endsPattern`: reventar ahí deja el `preLaunchTask` de F5 esperando para
  siempre.
- **El ORDEN de los `@import`.** Varias hojas dependen de la cascada y ninguna lo
  dice en tiempo de ejecución: `bay-content.css` tiene que cargar antes que
  `variants.css`, que le sobreescribe el tamaño del icono y del texto, y
  `bay-file-states.css` detrás de las dos, porque sus colores de nombre empatan
  con ellas. Las parejas que cargan peso están en `CSS_ORDER`; una hoja que no
  comparte selector con nadie es libre de moverse.
- **Un nombre de codicon que `codicon.css` no declara, y un glifo escrito fuera
  de `shared/icons.ts`.** Un nombre de codicon es una cadena y no hay regla para
  uno que la fuente no conoce: mal escrito no dibuja NADA, con el `check-types`,
  el lint y el build en verde. La segunda mitad vale tanto como la primera: un
  glifo escrito dentro de un módulo se ha escapado de la tabla, y con ella del
  escaneo por rol.
- **Un escaneo de tests vacío, o un subdirectorio dentro de `src/test/`.** A
  `node --test` se le entrega un glob plano, así que un test anidado no llega a
  ser entry point y no corre nunca, sin error por ninguno de los dos lados. Los
  dos son un `throw`, seguro **solo ahí**: `buildTests` cuelga de `main()`, cuyo
  `.catch` sale con código 1. El borrado de `out/test/` va delante de todo
  return: con los bundles del build anterior en disco, esa pasada verde reporta
  sus casos viejos contra código que ya no existe.

Y tres scripts en `scripts/`, colgados de `compile` y de `package`:

- **`check-docs`** afirma que toda ruta relativa a `src/` que la documentación y
  los comentarios citan sigue nombrando un fichero que existe, que toda imagen a
  la que apunta un markdown está, y que lo que el marketplace renderiza no lleva
  rayas ni comillas tipográficas. Cuando se escribió, la prosa todavía citaba los
  módulos del cliente por sus nombres `.js` de antes, meses después de que el
  cliente pasara a TypeScript.
- **`check-layers`** corre las reglas de más abajo: pertenencia de carpeta, ids
  de comando declarados contra registrados contra nombrados en un menú, las
  claves de ajuste que se leen por su nombre, lo que hay que desmontar, los
  identificadores que esta guía cita, la frontera de confianza, el contrato del
  webview y la paridad de los bundles de traducción.
- **`check-release`** afirma que la versión del manifiesto tiene su propia
  entrada en el changelog, fechada, escrita y única, y la primera. La versión la
  rechaza `vsce publish` y nadie más; el changelog no lo rechaza NADIE, así que
  una release sin entrada se publica perfectamente y aterriza como una versión de
  la que su página no sabe decir qué cambió. Ésa es la mitad que vale un check, y
  es como salieron 0.3.5, 0.3.6 y 0.3.7 sin documentar.

**Y `vsce` no se teclea a mano.** `npm run vsix` y `npm run release`
(`scripts/release.js`) derivan el canal de la versión: un minor IMPAR sale por el
canal pre-release y uno par es estable. El marketplace no deduce ninguno de los
dos, y olvidarlo en un impar publica esa versión como la última ESTABLE para todo
el mundo, actualizando sola. Una versión no se despublica, así que la única
salida es publicar otra encima. Se dice en voz alta, con el número del que se
derivó, antes de correr nada — y pasarlo a mano se RECHAZA, que es exactamente el
acordarse que esto existe para quitar.

## Las capas, y cómo se comprueba cada una

| carpeta | qué contiene | cómo se comprueba |
|---|---|---|
| `src/utils/` | reglas **puras**, cada una con sus tests | ningún fichero importa `vscode` |
| `src/platform/` | adaptadores finos sobre la API de VS Code | todos importan `vscode` |
| `src/shared/` | lo que compilan **los dos** proyectos de TypeScript | ni `vscode` ni DOM |
| `src/webview/` | el cliente, que corre en un navegador | no importa `vscode` |

La regla no es cosmética: **una carpeta sin criterio de pertenencia comprobable
se llena sola.** Y las dos direcciones importan, porque el hueco se abre por
cualquiera de las dos — un módulo puro que acabe en `platform/` reabre el
problema una carpeta más allá.

Lo que la regla **no** dice es que todo lo puro viva en `utils/`: va en una sola
dirección. Cuando una regla pura tiene un único subsistema por consumidor, vive
con él.

## Doble bundle, dos proyectos TypeScript

`esbuild.js` produce dos artefactos con configuraciones incompatibles entre sí:

| | entry | salida | formato | tsconfig | lib |
|---|---|---|---|---|---|
| Host | `src/extension.ts` | `dist/extension.js` | CJS / node | `tsconfig.json` | sin DOM |
| Cliente | `src/webview/main.ts` | `dist/webview/main.js` | IIFE / browser | `src/webview/tsconfig.json` | + **DOM** |

El tsconfig del cliente vive **dentro** de `src/webview/` para que el
`projectService` de typescript-eslint lo encuentre subiendo directorios; el
tsconfig raíz excluye esa carpeta. `npm run check-types` corre los DOS
precisamente para que esto no se cuele.

El grafo de imports de `main.ts` define el orden de init; no hay globales
compartidas entre ficheros, y `vscodeApi.ts` es dueño de la única llamada a
`acquireVsCodeApi()`.

**El arrastre se arma PEREZOSAMENTE**, la primera vez que llega un `render` con
el ajuste puesto: con el shell congelado el ajuste se puede mover sin que el
documento se reconstruya, así que leerlo una vez del `<body>` al arrancar dejó de
bastar.

Consecuencia práctica: editar `src/webview/*.ts` o `src/styles/*.css` solo hace
efecto tras un rebuild, y **después de tocar el SHELL** (`BaysHtmlBuilder.buildShell`)
hace falta una **recarga entera (Ctrl+R)** en el host de desarrollo: el shell se
asigna una vez por webview, así que nada por debajo de una recarga lo sustituye.

## El bucle de actualización

Es la parte que cruza muchos ficheros. Del lado del host:

1. **`extension.ts`** cablea todo: construye los servicios (`BayStateService`
   primero, luego `GroupCustomizationService`, `BaySyncService`,
   `BayDragDropService`, `FileActionRegistry`, `BayIconManager`, `ThemeService`,
   `ProductIconService`, `CopilotService`, `GroupActions`, `BaysWebviewProvider`,
   y más tarde `ClaudeConversationService`), arranca `iconManager.initialize()`
   **sin bloquear** (`void …`; su `onDidInitialize` posterior dispara
   `provider.refreshTheme()`, que repinta Y reenvía la fuente del tema), registra
   el provider y llama a `syncService.activate()`.
2. **`BaySyncService`** es el orquestador fino que mantiene el estado interno de
   acuerdo con VS Code. Delega en:
   - **`BayEventService`** — registra los oyentes de VS Code (`onDidChangeTabs`,
     `onDidChangeTabGroups`, `onDidChangeActiveTextEditor`,
     `onDidChangeTextEditorSelection`, renombrados y borrados de fichero).
   - **`ActiveStateService`** — recalcula `isActive` a partir de las pestañas
     nativas.
   - **`BayHeadService`** — se asegura de que exista la bay padre antes de añadir
     una variante.
   - **`BayHierarchyService`** — la contabilidad padre/variante
     (`variantCount`/`hasVariant`) y la sincronización del cursor.
   - **`GitSyncService`**.
3. **`BayStateService`** es la fuente de verdad en memoria (`Map<id, Bay>` más
   los grupos). Sus mutaciones disparan **cuatro** eventos distintos:

   | evento | lo dispara | qué acaba haciendo |
   |---|---|---|
   | `onDidChangeState` | `notifyChange()` y los mutadores directos | `provider.refresh()`: un cambio ESTRUCTURAL, así que se recompone la lista entera y se reconcilia. **Nunca una reconstrucción del documento.** |
   | `onDidChangeStateSilent` | `notifyActiveChange()` | `refreshSilent()` manda `updateActiveBay` |
   | `onDidChangeBayState` | `updateBayStateWithAnimation()` | manda `bayStateChanged` para UNA bay |
   | `onDidChangeBayLabel` | `notifyBayLabelChange()` | manda `updateBayLabel` para UNA bay |

4. **`BaysWebviewProvider.refresh()`** (30 ms de debounce) llama a
   **`BaysHtmlBuilder.buildSections()`** y manda un `render` con el resultado. Lo
   que viaja son **DATOS** (`GroupSection[]`, `BayView`, `VariantView`) y el
   markup lo construye el **CLIENTE** en `webview/rows.ts`. Los iconos son la
   única excepción y viajan como HTML, deduplicados por clave en
   `html/IconKeyRegistry`: un marcador de tema es un `data:` URI de kilobytes, así
   que diez pestañas `.ts` mandarían diez copias del mismo SVG.
5. **El cliente** (`webview/interactions.ts`, bundleado en
   `dist/webview/main.js`) atiende los clics y el menú contextual y contesta con
   `postMessage`.

### El contrato vive en `src/shared/protocol.ts`

La definición única de todos los mensajes de los dos sentidos, más el modelo del
menú y el modelo de la vista (`BayView`, `VariantView`, `GroupSection`). Lo
importan el host **y** el cliente, y lo compilan **los dos** tsconfig, así que
tiene que seguir libre de `vscode` y de DOM.

- **Del cliente al host van 12 mensajes**, y el host los despacha por un mapped
  type (`MessageHandlers`, uno por cada `WebviewToHostMessage['type']`): añadir
  una variante **rompe la compilación** hasta que exista su handler.
- **Del host al cliente van 8**, y ahí el compilador no puede ayudar: el cliente
  no tiene despacho central sino oyentes que filtran por tipo, así que una
  variante añadida a `HostToWebviewMessage` **compila sin que la escuche nadie**
  y la feature no hace nada, en silencio. Lo cierra
  **`WEBVIEW_MESSAGE_LISTENERS`**, un `Record` sobre esa unión que obliga a
  nombrar el oyente en el mismo fichero donde se añade la variante — y
  `check-layers` comprueba que ese oyente de verdad filtre por ese tipo.
- Lo que el compilador **sigue sin poder** comprobar: los atributos
  `data-bay-id` que escribe `rows.ts` tienen que casar con las lecturas de
  `dataset.bayId` de `interactions.ts` y `dragdrop.ts`.

**Un mensaje nuevo empieza aquí.** Un desajuste es hoy un error de compilación y
no una actualización que se pierde en silencio.

### Las actualizaciones parciales

Los cambios de activo, de sucio y de git/diagnósticos se parchean por su propio
`postMessage` en vez de dar la vuelta por la lista:

- **activo** → `notifyActiveChange()` → `updateActiveBay` (conmuta `.active`).
- **estado de una bay** → `updateBayStateWithAnimation()` → `bayStateChanged`
  (sustituye el nodo `.bay-state`).
- **etiqueta de una bay** → `notifyBayLabelChange()` → `updateBayLabel` (lo usa
  el enriquecedor de títulos de Claude Code).
- **iconos diferidos** → tras el primer pintado, `patchIcons()` manda
  `updateIcons` para sustituir los `.bay-icon` de reserva. Los iconos se pintan
  de caché de forma síncrona; los fallos se resuelven en paralelo.
- **reordenar arrastrando** → el webview mueve el DOM él mismo y el host reordena
  su modelo en silencio, sin reconstruir nada.

**Todos los manejadores de eventos de VS Code que mutan estado** —el `syncAll`
inicial, `handleTabChanges`, los cambios de grupo, los renombrados y borrados,
los resyncs— **corren por una sola cola de promesas** (`BaySyncService.enqueue()`).
Nunca mutes el estado de sincronización fuera de ella.

## El invariante: `webview.html` se asigna UNA vez

El shell (`BaysHtmlBuilder.buildShell`) se asigna en `resolveWebviewView` y nunca
más. Todo lo demás viaja por `postMessage`. **Lo comprueba `check-layers`**, que
cuenta las asignaciones en todo `src/` y corta con dos o con cero.

Reasignarlo es lo que la extensión hacía en cada cambio estructural —una pestaña
abierta, cerrada, anclada— y **destruye el documento entero**: el scroll, el foco
del teclado, los grupos plegados, el bundle del cliente, las hojas de estilo, la
fuente de codicons y la fuente del tema empotrada en base64, todo pagado otra
vez. Cada una de esas pérdidas costaba después su propia restauración, y cada una
de esas restauraciones existía únicamente por culpa de la reasignación.

Lo que lo sustituye es una **reconciliación por clave** (`webview/render.ts`): se
computa una firma por bloque —una por cabecera de grupo y una por `.bay-block`—
y un bloque cuya firma no ha cambiado **no se toca**. Ese «no se toca» es la
ganancia entera: conserva su foco, su clase de plegado y cualquier animación en
curso. La decisión de qué se conserva, qué se sustituye y qué se inserta vive
aparte y con tests (`utils/renderPlan.ts`), porque es donde están los casos
límite y ninguno se ve cuando sale mal.

Tres cosas cuelgan de esto y no son opcionales:

- **El primer pintado cuelga del `ready` del cliente**, que es su primera
  sentencia. Un mensaje mandado a un webview que todavía no ha registrado su
  oyente se PIERDE, así que el host no puede pintar en el momento en que asigna
  el shell.
- **El `@font-face` del tema viaja por mensaje** a un `<style id="themeFont">`
  que el shell manda VACÍO. Leer la fuente de un tema es I/O de disco, y ponerla
  en el `<head>` dejaría el panel en blanco hasta que estuviera. Un cambio de
  tema de iconos tiene que reenviarla (`refreshTheme`), o los glifos del tema
  nuevo se pintan con la fuente del anterior.
- **No se reconcilia nada a mitad de un arrastre** (`dragInFlight`): sustituiría
  justo los nodos contra los que el gesto está midiendo. Lo que llegue se pinta
  al soltar.

Lo que queda del modelo viejo es `getState()`, y sigue haciendo falta: el
documento ya no se recarga ante un cambio, pero sí cuando el webview nace otra
vez (al mover el panel, o al volver de estar oculto sin contexto retenido).

## El modelo Bay

Una **bay** es una pestaña de VS Code. `bay.metadata` es **inmutable** —se
computa al crearla y no se toca más— y `bay.state` es **mutable** durante su
vida. Muta `bay.state.*`, nunca `bay.metadata.*`. Los métodos de `Bay` delegan en
funciones puras de `models/actions/*`, que reciben `(metadata, state)`.

**`activateFn` se INYECTA** en esas acciones para evitar una dependencia
circular: anclar y desanclar necesitan activar primero.

### Los cuatro tipos, y el que no existe

```ts
type BayType = 'file' | 'webview' | 'custom' | 'notebook';
```

- `TabInputText` → `file`
- `TabInputWebview` → `webview` — **`uri === undefined`**
- `TabInputCustom` → `custom`
- `TabInputNotebook` → `notebook`
- `TabInputTextDiff` → **`file`**, no un tipo aparte

**No hay un `bayType: 'diff'`, y eso es la decisión.** Un diff es una bay
ordinaria de tipo `file` a la que se le reconoce por tener `metadata.sourceBayId`
puesto, con `metadata.diffType` diciendo de qué clase de diff se trata
(`working-tree`, `staged`, `snapshot`, `commit`, `edit`, `merge-conflict`,
`incoming`, `current`, `incoming-current`, `preview`, `unknown`).

### Las variantes

Una **variante** es una bay con `sourceBayId` apuntando a su padre. Se dibuja
sangrada debajo de él, y el padre lleva la cuenta en `state.hasVariant` y
`state.variantCount`. Los diffs, las instantáneas, los cambios preparados y **la
vista previa de un markdown** son todos variantes.

Una variante **hereda el `viewMode` de su fuente** al engancharse
(`BayHierarchyService`).

### Los ids

| qué | id |
|---|---|
| con uri (file, custom, notebook) | `${uri}-${viewColumn}` |
| webview | `${bayType}:${key}-${viewColumn}`, con `key = (viewType \|\| label)` saneado |
| variante | `diff:${modifiedUri}::${originalUri}-${viewColumn}` |

**El de un webview se ancla al `viewType` y no a la etiqueta**, y es a propósito:
la etiqueta se reescribe en caliente (Claude Code enseña el nombre de la sesión
actual), así que anclado a ella cada renombrado huerfanaría la bay.

**Son deterministas y NO hay caché.** El mismo input da el mismo id siempre, así
que no hay nada que guardar y nada que invalidar. `generateVariantId` empotra el
`modifiedUri.toString()` ENTERO —con la query que VS Code le cuelgue, un ref de
git incluido— y funciona porque `vscode.Tab.input` no muta mientras la pestaña
vive: la ruta de apertura y las de cierre y sincronización derivan el mismo id.
No se intenta colapsar «el mismo diff lógico» entre dos pestañas distintas: cada
una tiene el suyo.

**El mismo fichero abierto en dos grupos son dos bays**, con estado independiente
(`isDirty`, `isPinned`, `cursorLine`). Git y los diagnósticos son **por URI y no
por grupo**, así que `updateTabDiagnostics` usa `findBaysByUri` (plural) a
propósito: refresca la copia de todos los grupos y no solo la primera.

### Las capabilities son CINCO campos

```ts
type BayCapabilities = {
  canClose, canPin, canRevealInExplorer, canTogglePreview, canHaveChildren
};
```

Y nada más. **No hay `canSplit` ni `canReveal`**: lo demás se computa bajo
demanda en `models/actions/*` a partir de si hay `metadata.uri`, en vez de
guardarse como una bandera que habría que mantener al día.

De ahí salen dos reglas que no son evidentes: `canPin` **no** mira la uri —un
webview se puede anclar— sino que es `!isPinned && !sourceBayId`, así que **una
variante no se ancla nunca**; y `canRevealInExplorer` es falso para lo que no
tiene fichero en disco (un `untitled:`, un remoto).

### El estado de una fila, y su precedencia

Lo que viaja al cliente es un **código** (`BayStateCode`) y no markup. La
precedencia la decide `utils/stateIndicator.ts` y es lo único de esto que se
puede romper sin que se vea nada hasta que un fichero con un error deja de
decirlo:

```
error > aviso > estado de git > sin guardar > limpia
```

Cómo se DIBUJA cada código —el glifo, el título y la clase que tiñe el nombre—
vive en `shared/bayState.ts`, en una sola tabla, porque tres respuestas sobre un
mismo hecho se separan si viven aparte. `nameClass` no es siempre el código:
`untracked` tiñe el nombre como añadido y `dirty` como modificado, porque lo que
el nombre dice es de qué COLOR está el fichero y no cuál de las nueve preguntas
lo puso ahí.

## Lo que cada carpeta puede tocar

| carpeta | tiene que | NO puede |
|---|---|---|
| `models/` | definir el modelo y las acciones puras | sincronizar con la Tab API, dibujar, resolver iconos, hablar con git |
| `services/core/` | convertir pestañas en bays y mantenerlas de acuerdo con VS Code | generar markup, ejecutar comandos de usuario, tocar iconos o APIs externas |
| `services/ui/` | iconos, temas y la lógica del arrastre | conocer la Tab API o hablar con git |
| `services/integration/` | git, Copilot y los transcripts de Claude | mutar el estado de las bays |
| `providers/` | componer los DATOS de la vista y despachar los mensajes | mutar el modelo |
| `commands/` | resolver el id y **delegar** | llevar lógica dentro |
| `webview/` | construir el DOM y contestar al puntero | saber nada de `vscode` |

**Un comando recibe un id de bay como CADENA**, nunca una instancia, y el patrón
es siempre el mismo: `resolve(arg: unknown)` valida que sea una cadena, pregunta
por `getBayById`, y el comando **solo delega**. Los comandos se invocan desde el
webview (que solo puede mandar cadenas) y programáticamente (que puede mandar
cualquier cosa), así que la validación no es higiene.

## Los casos que se aprendieron a base de romperse

Ésta es la parte que no se deduce leyendo el código, porque es lo que el código
está esquivando.

### Un webview no tiene uri, y nunca se le inventa una

`uri === undefined` para Settings, Extensions, Claude Code y cualquier webview.
**Fabricar una URI falsa (`untitled:`, `bays://`) provoca `[UriError]`**: toda
acción de fichero comprueba `if (bay.metadata.uri)` antes de nada.

Un webview **se activa por índice** (`workbench.action.openEditorAtIndex` tras
enfocar su grupo), con un repliegue a un comando concreto por etiqueta
(`BayHelpers.WEBVIEW_COMMANDS`: Settings, Keyboard Shortcuts, Welcome, Release
Notes, Interactive Playground).

### Activar una pestaña de preview puede fallar la primera vez

Una pestaña en preview (en cursiva) puede convertirse en permanente justo entre
que se encuentra y que se activa. De ahí el reintento
(`ACTIVATION_RETRY_DELAY` 50 ms, `ACTIVATION_MAX_RETRIES` 3) y, como último
recurso, `vscode.open`.

El caso contrario —que VS Code convierta una preview en permanente— se detecta en
el bucle `changed` y **se trata en silencio a propósito**: actualiza la bandera
en el sitio, no marca cambio estructural y no manda ningún `postMessage`, porque
`isPreview` no se dibuja en ninguna parte y el id no se deriva de ella.

### Los huérfanos se limpian en línea, al cerrar

No hay barrido ni pasada periódica: el bucle `closed` de
`BayEventService.handleTabChanges()` quita la bay que casa (`removeBay`) cuando
el cierre no fue intencionado. Es la única vía.

### Una pestaña se puede cerrar a mitad de una acción

`findNativeTab` puede devolver `undefined` en cualquier momento. Los comandos lo
tratan como lo que es —una carrera normal— y refrescan en vez de reportar un
error.

### La vista previa de un markdown es una VARIANTE

**No hay `PreviewService` ni un conmutador fuente↔preview.** La previa es una bay
variante de verdad (`diffType: 'preview'`, con `sourceBayId` apuntando al `.md`),
dibujada como una fila sangrada bajo su padre igual que un diff.

Quien la crea es el botón de acción de fichero (`FileActionRegistry`), que
ejecuta `markdown.showPreview`; VS Code abre una pestaña webview de verdad y la
conversión normal la recoge en la siguiente sincronización.

- **Quién es el padre se resuelve por el NOMBRE**: `findPreviewSource` casa la
  etiqueta de la previa («Preview readme.md», «Vista previa readme.md») contra
  las pestañas de texto abiertas comprobando que acabe en `' ' + fileName` —
  prefiriendo una coincidencia en su propio grupo y aceptando una única
  coincidencia inequívoca en cualquier otro. Sin coincidencia se queda sin
  `sourceBayId` y se dibuja como huérfana, **nunca se descarta**.
- **El botón desaparece cuando ya hay previa** (`quickActionFor`): crear una
  segunda sería redundante. No hay botón de vuelta — la previa es una fila con su
  propia X.
- **Y está exenta del borrado en cascada**: cerrar el `.md` fuente **no** cierra
  la previa en VS Code, así que su bay se deja a propósito en el estado, dibujada
  como huérfana, en vez de retirarla con su padre.

### Una variante puede aparecer antes que su padre

Abrir un diff con el fichero base cerrado. `BayHeadService.ensureParentExists`
abre el fichero de verdad (`openTextDocument` + `showTextDocument` con
`preserveFocus`), y `onDidChangeTabs` dispara **síncronamente durante ese await**,
así que el padre ya está en el estado cuando se comprueba.

**No hay ningún placeholder de «cargando»**: `state.isLoading` existe en el tipo
pero sale siempre en `false`. Si la apertura falla —un remoto, un permiso, un
fichero borrado— la variante se añade igual y se dibuja como una fila huérfana.

### Claude Code y la pelea por la etiqueta

VS Code solo expone la etiqueta TRUNCADA de una pestaña de Claude
(`aiTitle.slice(0,24) + "…"`). `ClaudeConversationService` lee el título entero
de los transcripts JSONL de Claude
(`~/.claude/projects/<slug>/<sessionId>.jsonl`), prefiriendo un `custom-title` no
vacío sobre el `ai-title`, casando por `startsWith` sobre el prefijo sin los `…`
y **descartando cualquier empate** — una coincidencia ambigua es ninguna. Cachea
por mtime y un `fs.watch` con debounce la vuelve a correr.

**Y la rama genérica de «cambió la etiqueta de un webview» EXCLUYE estas
pestañas.** Sin esa exclusión, el camino genérico sobreescribiría el título
completo con la truncación de 24 caracteres en el siguiente evento de pestaña:
las dos fuentes se pelearían indefinidamente.

### Git

- **Todo es opcional y todo falla en silencio.** La extensión de git puede no
  estar; se devuelve `null` y no se reporta nada.
- **El arranque es una carrera**, y por eso la inicialización es perezosa con
  varios intentos (0 ms, 500 ms, 2000 ms).
- **Un conflicto gana a todo**: con un merge conflict se ignora el estado del
  árbol y del índice.
- **El árbol de trabajo gana al índice** cuando los dos dicen algo.
- **Las rutas se normalizan siempre**: minúsculas en Windows, sensible a
  mayúsculas en Unix.
- **Un oyente por repositorio**, seguido en un `Set` para no duplicarlo.
- El mapeo de los códigos de la API de git a los seis valores de `GitStatus`
  (`modified`, `added`, `deleted`, `untracked`, `ignored`, `conflict`) es
  exhaustivo.

### Copilot

`isAvailable()` antes de ofrecer nada: la extensión puede no estar instalada, y
un item de menú que no hace nada se lee como una vista rota. Una bay sin uri no
se puede adjuntar.

### Iconos

- **El orden de resolución es nombre > extensión > languageId.**
- **Siempre hay repliegue**: sin icono en el tema, un codicon genérico.
- **VS Code ya cachea los iconos**; no se añade otra capa de caché.
- Un tema **basado en fuente** (Seti) se sirve por un marcador
  `font-icon:CHAR:COLOR` en vez de por un data URI.
- Un SVG con **ruta relativa** se resuelve contra el directorio del tema.
- Un **cambio de tema** reconstruye el mapa, con su propio debounce
  (`ICON_THEME_CHANGE_DEBOUNCE`, 100 ms).
- Los iconos de las pestañas de otras extensiones resuelven al **logo real de la
  extensión dueña** (`platform/webviewExtensionIcons.ts`): casa el `viewType` o
  la etiqueta contra las instaladas —los `customEditors` declarados de forma
  exacta, los paneles webview por heurística de tokens del nombre, las páginas
  `Extension: <nombre>` por `displayName`— y empotra su `packageJSON.icon` como
  data URI por el camino diferido. Sin coincidencia, los codicons de
  `utils/builtinIcons.ts`.

### El arrastre

- **Una bay anclada NO se mueve nunca.**
- **Una variante no se arrastra sola**: está atada a su padre.
- **Lo no anclado no puede caer sobre la sección de lo anclado**, para que la
  separación siga significando algo.
- **Se valida ANTES de ejecutar**, no después.
- **El webview es dueño del movimiento del DOM al soltar**; el host reordena su
  modelo en silencio y **no vuelve a dibujar** para reflejar un arrastre que
  salió bien.

### Los grupos

- **La personalización se guarda por `viewColumn` y no por un id de grupo**,
  porque VS Code no expone ninguno estable: un renombrado, un color o un candado
  se pegan a una POSICIÓN de columna y sobreviven a los resyncs.
- **`apply()` sobreescribe los tres campos siempre y no los funde**, para que una
  `viewColumn` reciclada no herede el color ni el candado del grupo anterior.
- **Un grupo bloqueado no ofrece NINGÚN item de cierre** en el menú contextual
  —ni Close, ni Close Others, ni Close to the Right, ni Close Group—: si el menú
  los siguiera listando, el candado solo escondería el botón sin proteger nada.
- **La cabecera solo viaja con más de un grupo poblado**: con uno solo no hay
  nada de lo que distinguirlo.

### El menú contextual es una réplica hecha a mano

Un `QuickPick` de VS Code sale centrado y arriba, no bajo el cursor, así que para
un menú de clic derecho rompe la expectativa entera. La solución es que el host
construya el **modelo** (`MenuItem[]`, serializable: ni funciones ni instancias,
porque cruza `postMessage`) y el cliente lo **dibuje** él
(`webview/contextmenu.ts`), replicando el menú nativo de monaco: un solo menú
vivo a la vez, submenús anidados con hover de 250 ms, colocación consciente del
viewport, navegación por teclado con typeahead, la regla del «líder de grupo»
—solo el primer item tras un separador dibuja su icono, para que el resto alinee—
y cierre al hacer clic fuera o al hacer scroll.

Con `items.length === 0` no se manda nada.

## Lo que cuesta cada cosa

- **`refresh()` lleva 30 ms de debounce** (`TIMINGS.WEBVIEW_REFRESH_DEBOUNCE`) y
  no hace falta añadir ningún `setTimeout` encima. Solo la última invocación de
  una ráfaga ejecuta.
- **Los ids no se cachean** porque no vale la pena: son una concatenación de
  cadenas sobre campos que ya están a mano, así que no hay nada que invalidar.
- **`replaceBays()` carga en lote**: suprime los eventos de cada `addBay` y
  dispara uno solo al final. `resyncAll()` además conserva el orden manual de
  cada grupo a través de la reconstrucción, fotografiándolo por URI antes y
  reordenando después.
- **La jerarquía se recalcula entera solo tras una sincronización completa**;
  enganchar y desenganchar una variante es O(1) y solo corre cuando una variante
  se abre o se cierra de verdad.
- **El cursor se sincroniza solo con `bays.syncCursorPosition` puesto** (apagado
  por defecto), y la bandera se cachea y solo se relee al cambiar la
  configuración, para que el camino caliente siga barato. Mueve
  `cursorLine`/`cursorColumn` en la familia entera y empuja el cursor de los
  editores hermanos abiertos, y **no dispara ningún evento**: es contabilidad de
  trastienda, nada del renderizador la lee.
- **Git y los diagnósticos se leen de forma perezosa**, cuando una pestaña cambia
  de estado o llega un evento de diagnósticos o de renombrado. No hay sondeo.
- **Los iconos se pintan de caché de forma síncrona** y los fallos se difieren a
  un `updateIcons` posterior al primer pintado.

## Localización

Toda cadena visible está escrita **en inglés en el código** y es su propia clave
de traducción — que es como funciona `vscode.l10n`. Cuatro piezas:

- **Host**: `vscode.l10n.t('…', args)` directamente. Los bundles no ingleses viven
  en `l10n/bundle.l10n.<locale>.json` (lo declara el campo `l10n` de
  `package.json`); el inglés no necesita bundle.
- **`package.json`**: los `contributes` (comandos, ajustes, capabilities, la
  vista y su contenedor) usan `%clave%` resueltas contra `package.nls.json` y sus
  hermanos `package.nls.<locale>.json`. `displayName` y la `category` de los
  comandos se quedan literales: el título del marketplace es un nombre propio, y
  la categoría es la palabra con la que la paleta agrupa estos comandos.
- **Cliente**: el webview no alcanza `vscode.l10n`, así que el shell inyecta el
  bundle cargado como `window.__l10n` ANTES de `main.js` y `webview/l10n.ts`
  expone el mismo `t()` sobre él. Síncrono a propósito: las etiquetas viven en
  tablas de nivel de módulo que se leen al importar, y una consulta por mensaje
  correría contra todas; el idioma solo cambia con una recarga de ventana, que
  reconstruye el shell, así que la instantánea no caduca. El JSON inyectado
  escapa `<` para que una traducción no pueda cerrar el `<script>`.
- **`shared/l10n.ts`** lleva el formato de placeholders `{0}` y su interpolador,
  que es el mismo formato de `vscode.l10n.t`. Compartirlo es lo que permite que
  las dos mitades escriban un mensaje igual.

Los `title` de `shared/bayState.ts` se quedan en INGLÉS ahí y se traducen donde
se dibujan (`webview/rows.ts`): esa tabla la compilan los dos proyectos, el
traductor del cliente no existe en el host, y esas cadenas SON las claves con las
que el bundle busca.

**Añadir un idioma son dos ficheros** y ninguna línea de código:
`l10n/bundle.l10n.<locale>.json` (las claves son las cadenas inglesas) y
`package.nls.<locale>.json` (las claves las de `package.nls.json`). Nada más —
las dos paridades de `check-layers` y el barrido de puntuación de `check-docs`
escanean el directorio en vez de llevar una lista escrita, y `.vscodeignore` es
una lista de exclusiones, así que el fichero nuevo se comprueba y viaja solo.

**`check-layers` fija tres mitades de esto**: cada `l10n/bundle.l10n.*.json`
lleva exactamente las claves que el código pide (los sitios donde se llama a
`t(` más los títulos de estado, que se alcanzan por una clave compuesta que
ningún grep encuentra); cada `package.nls*.json` lleva el mismo conjunto; y cada
`%clave%` que el manifiesto nombra está declarada, en las dos direcciones.
Ninguno de los dos fallos es ruidoso — una clave que falta sale en inglés solo en
ese idioma, y un `{0}` perdido se lleva el dato que llevaba dentro de una frase
que se sigue leyendo bien.

Hoy hay inglés, español y catalán. El japonés y el chino no se escribieron a
propósito: una traducción que no se puede verificar es peor que la ausencia, y
las dos tienen tipografía propia —en chino las comillas nativas son `""` y el
guion largo es `——`— que hay que escribir sabiendo.

## Los ajustes, los comandos y las claves de contexto

**Siete ajustes**, y ninguno más (los `bays.tabHeight`, `bays.iconSize`,
`bays.enableStateIndicators` y `bays.showStateIcons` de la documentación vieja no
existieron nunca):

| clave | por defecto | qué hace |
|---|---|---|
| `bays.showFilePath` | `true` | la ruta relativa junto al nombre |
| `bays.compactMode` | `false` | nombre y ruta en una línea, fila de 28 px |
| `bays.enableHoverActions` | `true` | los botones que salen al pasar el puntero |
| `bays.enableDragDrop` | `true` | reordenar arrastrando |
| `bays.syncCursorPosition` | `false` | sincronizar el cursor entre una bay y sus variantes |
| `bays.animations` | `true` | el interruptor maestro de todo lo que la vista mueve |
| `bays.followProductIconTheme` | `true` | seguir el pack de iconos de producto del entorno |

**Los dos que la vista CONMUTA se guardan por proyecto** y no en el settings.json
del usuario (`services/ui/ViewPrefs.ts`, en `workspaceState`): `compactMode` y
`showFilePath`. Un ajuste no puede ser las dos cosas a la vez — sin valor de
carpeta ni de workspace, `config.update` aterriza en el fichero del usuario, así
que encender el modo compacto en una ventana lo encendía en todas. El ajuste
sigue vivo como lo que gobierna mientras no haya nada guardado, y **manda el
ÚLTIMO que escribe**: editarlo en la UI de ajustes tira el valor guardado para
esa clave.

`check-layers` comprueba que toda clave leída por su nombre sea una que el
manifiesto declara, una de la capa por proyecto o un ajeno nombrado a mano.

**Treinta comandos**, todos con la categoría `Bays`. Los que actúan sobre una bay
reciben su id como cadena y están escondidos de la paleta. `check-layers`
comprueba las tres mitades: declarado en `contributes.commands`, registrado con
`registerCommand`, y nombrado por un menú — al revés también es fallo, y más
callado: un comando registrado que no se declara funciona desde el código y no se
puede ni asignar a una tecla ni encontrar en la paleta.

**Dos claves de contexto**, y solo dos, usadas en los `when` del manifiesto:

- `view == bays`
- `bays.hasUnsavedBays` — alguna pestaña nativa sin guardar; abre el *Save All*
  de la barra de la vista, y se recalcula en `onDidChangeTabs`. Es la única que
  esta extensión escribe (`extension.ts`, con `setContext`).

**Que Copilot esté o no está NO es una clave de contexto**: se pregunta en
tiempo de ejecución con `isAvailable()` allí donde se va a ofrecer algo. Una
clave costaría mantenerla al día con una extensión que se puede instalar y
desinstalar mientras la ventana vive.

## La frontera de confianza

Todo id que llega del webview es una cadena que alguien PUDO fabricar. Lo que la
convierte en algo sobre lo que se actúa es `getBayById`, que solo encuentra lo
que el host ya conoce, y las acciones que comprueban `metadata.uri` antes de
tocar el disco.

**Lo que `check-layers` fija es la forma que el fallo toma de verdad**: un campo
del mensaje convertido en `Uri` allí donde LLEGA, que es el instante en que una
cadena arbitraria pasa a ser algo sobre lo que se puede actuar, y es un teclazo
de distancia en un mapa de handlers escrito a una línea por entrada.

## Convenciones

- El término del dominio es **«bay»**, no «tab».
- **Logging**: `Logger.log` / `Logger.warn` / `Logger.error` y nada más (nunca
  `console.log`), con el mensaje prefijado por `[Módulo]`. Sale por el canal
  **`Bays`**.
- **La E/S de ficheros es asíncrona siempre** (`vscode.workspace.fs` o
  `fs/promises`); nunca síncrona.
- **En el cliente, `CSS.escape()` sobre todo id de bay que vaya a un selector**:
  llevan `://`, `%` y demás.
- **Los ficheros se quedan por debajo de las 400-500 líneas**, y no se parten por
  partir: solo cuando hay una separación lógica de verdad.
- **Como mucho una capa de abstracción.** Antes de añadir una, la pregunta es si
  resuelve un problema real y si se va a usar en tres sitios.
- Los comentarios explican el **porqué** —la regla y el fallo que evita— y lo
  hacen en presente. No narran la historia del repositorio: un lector nuevo no
  puede comprobar lo que el código dejó de hacer.

## Qué hay en el repositorio además del código

| | |
|---|---|
| `README.md` | la página del marketplace: en inglés, para quien evalúa la extensión |
| `CHANGELOG.md` | lo renderiza el marketplace en su pestaña; formato Keep a Changelog |
| `CLAUDE.md` | esto: la guía interna, en español, excluida del `.vsix` |
| `l10n/`, `package.nls*.json` | las traducciones (ver *Localización*) |
| `.github/workflows/ci.yml` | `npm ci && npm run compile` en Node 22 y 24 × Linux y Windows |
| `scripts/check-docs.js` | las rutas que cita la prosa existen, las imágenes están, y lo publicado no lleva rayas ni comillas tipográficas |
| `scripts/check-layers.js` | las capas, los ids de comando, las claves de ajuste, lo que hay que desmontar, los identificadores citados, la frontera de confianza, el contrato del webview y la paridad de los bundles |
| `scripts/check-release.js` | la versión del manifiesto tiene entrada propia, fechada, escrita y única, y la primera |
| `scripts/release.js` | compone el comando de `vsce` con el canal derivado de la paridad del minor |

`.vscodeignore` decide qué viaja en el `.vsix`. Es una lista de **exclusiones**,
así que **una carpeta nueva viaja salvo que se añada ahí**. Las notas de trabajo
se excluyen **por patrón y no por su nombre** (`plan*.md`): escrito uno a uno, el
fichero que se queda fuera es siempre el SIGUIENTE, y el fallo no es ruidoso ni
en un sitio ni en el otro.

## La extensión hermana

**Atria** (`Lovervoid.atria`) es del mismo autor y es un navegador de columnas
para el explorador de ficheros. Bays le tomó prestado casi todo lo que tiene de
disciplina: los `scripts/check-*.js`, las guardas del build, el shell congelado
con reconciliación por clave, la capa pura con su suite de tests, el
endurecimiento de lo que un tema ajeno interpola y el reparto de la
localización.

**Once módulos resuelven hoy el mismo problema en los dos repositorios**, y son
COPIAS a propósito:

`webview/contextmenu.ts` · `webview/tooltip.ts` · `webview/scrollbar.ts` ·
`webview/pathTruncation.ts` · `platform/languageRegistry.ts` ·
`utils/iconHtml.ts` · `utils/themeFonts.ts` · `utils/productIcons.ts` ·
`utils/iconMarkers.ts` · `platform/logger.ts` · `shared/l10n.ts`

**No van a compartirse en un paquete, y eso está decidido.** Un paquete npm
convierte cada arreglo en dos releases y obliga a que la copia pequeña cargue
con las features de la grande — el menú contextual de Atria tiene submenús
encadenados, rejilla de paleta, menú sticky y separador discontinuo porque su
vista los necesita, y el de Bays no. Lo que hay que saber en su lugar:

- **Arreglar un fallo en una copia NO lo arregla en la otra.** Cuando toques uno
  de esos once, mira si el gemelo tiene el mismo fallo. Nada lo comprueba y nada
  lo va a comprobar.
- **Ya han empezado a divergir**, en la misma versión en que se copiaron: tres de
  ellos (`languageRegistry`, `themeFonts`, `productIcons`) son más largos aquí
  que allí. Es el precio aceptado a sabiendas.

### Lo que NO hay que traerse de Atria

Importante decirlo, porque la tentación de hermanar es copiarlo todo:

- **La capa git propia** (unas 2000 líneas con su cola, sus techos y su escalada
  a SIGKILL). Existe porque Atria pregunta por `check-ignore` sobre miles de
  rutas en el camino de cada listado. Bays le pregunta a git el estado de un
  puñado de ficheros abiertos, y para eso el estado vivo de la extensión de git
  es gratis y suficiente. **`GitSyncService` está bien como está.**
- **La paleta de ocho tonos por proyecto.** Bays ya tiene colores de grupo sobre
  `--vscode-charts-*`, que es la familia correcta para lo que hace: distinguir
  grupos dentro de una ventana, no identificar proyectos entre ventanas.
- **La ventana propia, el modo en espera y el cliente doble.** Resuelven un
  problema que Bays no tiene.
- **El acento de la ventana.** Escribe en un fichero del usuario; Atria lo marca
  como experimental y apagado por algo.
- **La tira de la barra de estado.** Nace de que Atria enseña varios
  repositorios a la vez y su panel puede estar cerrado. La lista de Bays es la
  de la ventana en la que ya estás.

## Pendiente conocido

- **El `viewMode` de una bay no lo lee nadie.** `BayState.viewMode`
  (`'source' | 'preview' | 'split'`) sigue en el tipo y una variante lo hereda de
  su fuente, pero `activate()` no se ramifica por él y ningún action dinámico lee
  el `context.viewMode` que `resolve()` recibe. La previa de un markdown es una
  fila propia que se activa sola.
- **`state.isLoading` sale siempre en `false`.** Está en el tipo y no lo escribe
  nadie: cuando falla la apertura del padre de una variante, la variante se
  dibuja como huérfana en vez de como pendiente.
- **La comprobación de identificadores citados tiene un agujero conocido**: exige
  que TODO el contenido del backtick sea un identificador, así que `` `Foo[]` ``,
  `` `bay.metodo()` `` y `` `Foo.bar` `` se le escapan. Es como sobrevivieron
  `RenderBlock[]` y `bay.revealInExplorerView()` a la limpieza de la prosa.
