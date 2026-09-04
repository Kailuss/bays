// Lo que esta guía DICE que se comprueba, ejecutado.
//
// Cada regla de aquí estaba escrita en prosa, sin que nada la corriera —
// repartida por cinco capas de documentación que hoy son un solo `CLAUDE.md`, y
// que discrepaban entre ellas. Y todas salían en verde el día que
// se escribió el script: un check escrito después de la deriva es una limpieza,
// uno escrito antes es una frontera.
//
// Lo que NO se comprueba aquí se dice donde toca: esto no afirma que un `dispose`
// suelte todo lo que tiene dentro, ni que la prosa de alrededor de un
// identificador siga siendo verdad. Afirma que se llama, y que el nombre se
// puede ir a buscar.

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC  = path.join(ROOT, 'src');
const L10N = path.join(ROOT, 'l10n');

let failures = 0;

function fail(message) {
	console.error(`[check-layers] ${message}`);
	failures++;
}

function sourceFiles(dir, out = []) {
	if (!fs.existsSync(dir)) { return out; }
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) { sourceFiles(full, out); }
		else if (entry.name.endsWith('.ts')) { out.push(full); }
	}
	return out;
}

const rel = file => path.relative(SRC, file).split(path.sep).join('/');
const read = file => fs.readFileSync(file, 'utf8');

/** Un import de `vscode`, en cualquiera de sus dos formas. */
function importsVscode(source) {
	return /^\s*import\s+(?:\*\s+as\s+\w+|type\s|\{)[^;]*from\s+'vscode';/m.test(source)
		|| /^\s*import\s+'vscode';/m.test(source);
}

//= 1. LA PERTENENCIA DE CADA CARPETA
//
// Una carpeta sin criterio de pertenencia comprobable se llena sola, y el
// criterio no era comprobable mientras nadie lo ejecutara. Las dos direcciones
// importan: un módulo puro que acabe en `platform/` reabre el problema una
// carpeta más allá.

function checkFolders() {
	for (const file of sourceFiles(path.join(SRC, 'utils'))) {
		if (importsVscode(read(file))) {
			fail(`${rel(file)} imports vscode: utils/ is the pure layer, and its whole definition is that nothing in it does`);
		}
	}

	for (const file of sourceFiles(path.join(SRC, 'platform'))) {
		if (!importsVscode(read(file))) {
			fail(`${rel(file)} does not import vscode: platform/ is for the thin adapters over the API, so a pure module belongs in utils/`);
		}
	}

	// El cliente corre en un navegador: `vscode` no existe ahí, y el bundle del
	// webview ni siquiera lo marca como externo.
	for (const file of sourceFiles(path.join(SRC, 'webview'))) {
		if (importsVscode(read(file))) {
			fail(`${rel(file)} imports vscode: the webview client runs in a browser, where that module does not exist`);
		}
	}

	// `shared/` lo compilan los DOS proyectos de TypeScript, así que no puede
	// llevar ni `vscode` ni DOM.
	for (const file of sourceFiles(path.join(SRC, 'shared'))) {
		const source = read(file);
		if (importsVscode(source)) {
			fail(`${rel(file)} imports vscode: shared/ is compiled by BOTH projects, and the client one has no such module`);
		}
		if (/\b(document|window|HTMLElement)\b/.test(source.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''))) {
			fail(`${rel(file)} names the DOM: shared/ is compiled by the host project too, which has no DOM lib`);
		}
	}

	// Una regla pura no puede colgar de la vista: si `utils/` importara de
	// `providers/` o de `webview/`, dejaría de poder correr bajo `node --test`.
	for (const file of sourceFiles(path.join(SRC, 'utils'))) {
		const source = read(file);
		for (const [, target] of source.matchAll(/from\s+'([^']+)'/g)) {
			if (/(^|\/)(providers|webview|services)\//.test(target)) {
				fail(`${rel(file)} imports ${target}: a pure rule cannot hang off the view or a service`);
			}
		}
	}
}

//= 2. LOS IDS DE COMANDO
//
// Son cadenas en los TRES sitios donde viven: lo que `contributes.commands`
// declara, lo que `registerCommand` registra y lo que un menú nombra. Una
// entrada de menú que nombre un comando que nadie registró se queda muerta y
// contesta "command not found", con la extensión compilando y los tests en
// verde. Al revés también es fallo y más callado: un comando registrado que no
// se declara funciona desde el código y no se puede ni asignar a una tecla ni
// encontrar en la paleta.

/** Comandos de OTROS que este código ejecuta, y por tanto no declara. */
const FOREIGN_COMMANDS = new Set([
	'setContext',
	'vscode.open',
	'vscode.diff',
	'vscode.openWith',
	'workbench.action.files.saveAll',
	'workbench.action.closeAllEditors',
	'workbench.action.moveEditorToNewWindow',
	'workbench.files.action.showActiveFileInExplorer',
	'revealFileInOS',
	'revealInExplorer',
	'markdown.showPreview',
	'workbench.action.splitEditorRight',
	'workbench.action.terminal.new',
	'timeline.focus',
	'git.openChange',
	'github.copilot.chat.attachFile',
	'workbench.action.chat.attachFile',
	'workbench.action.chat.open',
]);

function checkCommands() {
	const manifest = JSON.parse(read(path.join(ROOT, 'package.json')));
	const declared = new Set((manifest.contributes?.commands ?? []).map(c => c.command));

	const registered = new Set();
	for (const file of sourceFiles(SRC)) {
		for (const [, id] of read(file).matchAll(/registerCommand\(\s*'([^']+)'/g)) {
			registered.add(id);
		}
	}

	for (const id of declared) {
		if (!registered.has(id)) {
			fail(`the manifest declares "${id}" and nothing calls registerCommand for it: the palette entry answers "command not found"`);
		}
	}
	for (const id of registered) {
		if (!declared.has(id) && !FOREIGN_COMMANDS.has(id)) {
			fail(`"${id}" is registered but the manifest does not declare it: it cannot be bound to a key or found in the palette`);
		}
	}

	// Lo que un menú NOMBRA tiene que estar declarado.
	const menus = manifest.contributes?.menus ?? {};
	for (const [where, entries] of Object.entries(menus)) {
		for (const entry of entries) {
			if (entry.command && !declared.has(entry.command)) {
				fail(`menu "${where}" names "${entry.command}", which the manifest does not declare`);
			}
		}
	}

	// Y un submenú nombrado en un menú tiene que estar declarado también.
	const submenus = new Set((manifest.contributes?.submenus ?? []).map(s => s.id));
	for (const [where, entries] of Object.entries(menus)) {
		for (const entry of entries) {
			if (entry.submenu && !submenus.has(entry.submenu) ) {
				fail(`menu "${where}" names the submenu "${entry.submenu}", which the manifest does not declare`);
			}
		}
	}
	for (const id of submenus) {
		if (!menus[id]) {
			fail(`submenu "${id}" is declared and has no items: it draws an empty flyout`);
		}
	}
}

//= 3. LAS CLAVES DE AJUSTE QUE SE LEEN POR SU NOMBRE
//
// Son cadenas, así que no las tipa nadie por ninguno de los dos lados.
// Renombrar una en el manifiesto y saltarse un `config.get('…')` deja a ese
// lector tomando el defecto para siempre, con `check-types` y los tests en
// verde, porque no hay nada con lo que discrepar.

/** Ajustes AJENOS que este código lee a propósito. */
const FOREIGN_SETTINGS = new Set([
	'workbench.iconTheme',
	'iconTheme',
	'colorTheme',
	'productIconTheme',
	'workbench.productIconTheme',
	// El workbench contesta estas dos, y por eso se LEEN en vez de duplicarse:
	// dos números para una misma espera, o dos interruptores para un mismo
	// movimiento, serían esta vista contradiciendo en voz baja una respuesta que
	// el usuario ya ha dado.
	'delay',
	'reduceMotion',
]);

function checkSettings() {
	const manifest = JSON.parse(read(path.join(ROOT, 'package.json')));
	const props    = manifest.contributes?.configuration?.properties ?? {};
	const declared = new Set(Object.keys(props).map(k => k.replace(/^bays\./, '')));

	for (const file of sourceFiles(SRC)) {
		const source = read(file);
		// Solo las lecturas sobre una configuración de la sección `bays`. Otras
		// secciones (workbench, explorer) las cubre FOREIGN_SETTINGS.
		for (const [, key] of source.matchAll(/\.get(?:<[^>]+>)?\(\s*'([^']+)'/g)) {
			if (declared.has(key) || FOREIGN_SETTINGS.has(key)) { continue; }
			fail(`${rel(file)} reads the setting "${key}", which the manifest does not declare and FOREIGN_SETTINGS does not name`);
		}
	}

	// Y al revés: un ajuste declarado que nadie lee es un interruptor muerto que
	// el usuario puede mover sin que pase nada.
	const sources = sourceFiles(SRC).map(read).join('\n');
	for (const key of declared) {
		if (!sources.includes(`'${key}'`)) {
			fail(`the manifest declares "bays.${key}" and no code reads it: a switch nobody is wired to`);
		}
	}
}

//= 4. LO QUE HAY QUE DESMONTAR, DESMONTADO
//
// Un oyente que nadie soltó sigue disparando contra un objeto del que la ventana
// ya ha terminado, y no hay ni un error ni un píxel equivocado que lo diga.
//
// Lo que se deja vivo A PROPÓSITO se NOMBRA aquí, que es la forma que la regla
// no puede ver: algo cuyo dueño no se desmonta nunca, donde un `dispose` propio
// prometería una limpieza que no hace nadie.

/** Clases que viven lo que dura la ventana, y por qué está bien. */
const LIVES_FOR_THE_WINDOW = new Set([
	// Registra sus listeners en `context.subscriptions` desde `activate()`, así
	// que los suelta VS Code al desactivar la extensión.
	'ThemeService',
	// Idéntico: su único listener entra en context.subscriptions al inicializar.
	'BayIconManager',
]);

function checkDisposal() {
	const owners = new Map(); // clase -> fichero

	for (const file of sourceFiles(SRC)) {
		const source = read(file);
		for (const [, name] of source.matchAll(/export class (\w+)[\s\S]{0,4000}?\n {2}(?:public )?dispose\(\)/g)) {
			owners.set(name, rel(file));
		}
	}

	const everything = sourceFiles(SRC).map(read).join('\n');

	for (const [name, where] of owners) {
		if (LIVES_FOR_THE_WINDOW.has(name)) { continue; }

		// Su `dispose` lo llama alguien: por `context.subscriptions.push(this)`
		// dentro de la propia clase, por `subscriptions.push(x)` fuera, o
		// llamándolo a mano.
		const source = read(path.join(SRC, where.split('/').join(path.sep)));
		const selfOwned = /subscriptions\.push\(\s*this\s*\)/.test(source);
		const lowered   = name[0].toLowerCase() + name.slice(1);
		const handed    = new RegExp(`subscriptions\\.push\\([^)]*\\b${lowered}\\b`).test(everything)
			|| new RegExp(`\\b${lowered}\\.dispose\\(\\)`).test(everything)
			|| new RegExp(`dispose:\\s*\\(\\)\\s*=>\\s*\\w*\\.?${lowered}\\.dispose\\(\\)`).test(everything);

		if (!selfOwned && !handed) {
			fail(`${where}: ${name} has a dispose() nobody calls. Hand it to context.subscriptions, or name it in LIVES_FOR_THE_WINDOW`);
		}
	}

	// Y una excepción que ya no cita nadie es una nota sobre una clase que se
	// fue: solo se lee mientras cada línea de ella está haciendo algo.
	for (const name of LIVES_FOR_THE_WINDOW) {
		if (!everything.includes(`class ${name}`)) {
			fail(`LIVES_FOR_THE_WINDOW names "${name}", which no longer exists`);
		}
	}
}

//= 5. LOS IDENTIFICADORES QUE LA PROSA CITA
//
// `check-docs` fija la mitad de esto y la fija bien: una cita de
// `utils/pathParts.ts` se pudre a gritos el día que el fichero se mueve. Una
// cita de una FUNCIÓN se pudre igual y no la comprobaba nadie, sobre cinco capas
// de documentación de las que dos ya citaban `webview/contextmenu.js` meses
// después de que el cliente pasara a TypeScript.
//
// Solo mira lo que PARECE un identificador (camelCase, PascalCase,
// SCREAMING_CASE) entre comillas invertidas: una palabra en minúsculas es prosa.
// Los bloques de código se saltan, que son comandos y diagramas.

/** Lo que legítimamente no está en `src/`, en dos grupos. */
const NOT_OURS = new Set([
	// De OTRO: las interioridades de VS Code, de otra extensión o de una
	// herramienta del build.
	'onDidChangeTabs', 'onDidChangeTabGroups', 'onDidChangeActiveTextEditor',
	'onDidChangeTextEditorSelection', 'onDidRenameFiles', 'onDidDeleteFiles',
	'onDidChangeWorkspaceFolders', 'onDidChangeConfiguration', 'onStartupFinished',
	'workspaceState', 'packageJSON', 'localResourceRoots',
	'TabInputText', 'TabInputTextDiff', 'TabInputWebview',
	'ExtensionContext', 'WebviewView', 'WebviewViewProvider',
	'showQuickPick', 'showInputBox', 'showTextDocument', 'asWebviewUri',
	'acquireVsCodeApi', 'getState', 'setState', 'postMessage', 'onDidReceiveMessage',
	'innerHTML', 'textContent', 'classList', 'dataset',
	'requestAnimationFrame', 'querySelector', 'addEventListener',
	'clientWidth', 'offsetWidth', 'scrollTop',
	'projectService', 'contributes', 'iconThemes', 'customEditors', 'displayName',
	'fontCharacter', 'iconDefinitions', 'fileExtensions', 'languageIds',
	'onDidChange', 'getAPI', 'preserveFocus', 'viewColumn', 'isDirty',
	'preLaunchTask', 'endsPattern',
	// RETIRADO a propósito, y la prosa lo NOMBRA a propósito: el argumento de lo
	// que hay hoy es la forma a la que sustituyó, o la que nunca existió.
	'PreviewService',
	// De la extension HERMANA, no de esta: el publisher de Atria.
	'Lovervoid',
	// De VS CODE, no nuestro: el error que salta al fabricar una uri falsa.
	'UriError',
	// Los dos que sobrevivieron a una limpieza de la prosa porque la regla vieja
	// exigia que TODO el backtick fuese un identificador. La guia los nombra como
	// el ejemplo de por que la de hoy mira dentro del tramo.
	'RenderBlock', 'revealInExplorerView',
	// Ajustes que la documentacion vieja listaba y que NO existieron nunca. La
	// guia los nombra para que nadie vuelva a documentarlos.
	'tabHeight', 'iconSize', 'enableStateIndicators', 'showStateIcons',
	'canSplit', 'canReveal',
	'IconData', 'FontIconMarker',
]);

/** Los documentos cuyas citas se comprueban. Las notas de trabajo no. */
function docs(dir, out = []) {
	const SKIP = new Set(['node_modules', 'dist', 'out', '.git', '.vscode-test']);
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) { continue; }
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) { docs(full, out); }
		else if (entry.name.endsWith('.md')
			&& !/^plan.*\.md$/i.test(entry.name)
			&& entry.name !== 'CHANGELOG.md') { out.push(full); }
	}
	return out;
}

// Lo que hay DENTRO de un tramo entre comillas invertidas, y no el tramo entero:
// exigir que todo el contenido fuera un identificador dejaba escapar `Foo[]`,
// `bay.metodo()` y `Foo.bar`, que es exactamente como sobrevivieron
// `RenderBlock[]` y `bay.revealInExplorerView()` a una limpieza de la prosa.
const SPAN = /`([^`\n]+)`/g;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Lo que un tramo entre comillas invertidas NO es: una cita de codigo.
 *
 * Son tres formas y cada una tiene su razon. Una RUTA la comprueba `check-docs`,
 * que es quien sabe resolverla; un NOMBRE DE FICHERO se lee como su nombre mas
 * una extension, y ninguna de las dos mitades es un identificador; y un ATAJO DE
 * TECLADO son teclas. Todo lo demas se mira.
 */
const FILE_EXTENSION = /\.(md|json|jsonl|ts|js|mjs|cjs|css|html|svg|ttf|yml|yaml|vsix|txt|code-workspace)$/;

function isCitation(span) {
	return !span.includes('/') && !span.includes('+') && !FILE_EXTENSION.test(span);
}

/**
 * El fichero sin sus comentarios.
 *
 * Se quitan los bloques enteros y toda linea cuyo primer caracter escrito sea
 * `//` o `*`; NUNCA un `//` a media linea, que dentro de una cadena se lleva por
 * delante codigo de verdad (`'https://...'`) y convierte un falso negativo en un
 * build rojo por un nombre que si existe.
 */
function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((line) => !/^\s*(\/\/|\*)/.test(line))
		.join('\n');
}
const LOOKS_LIKE_CODE = /[A-Z_]/;

function checkCitedIdentifiers() {
	// El corpus incluye los scripts del BUILD: la guía los cita por nombre
	// (`CSS_ORDER`, `buildTests`) y esos nombres se pudren igual que los de src/.
	const buildScripts = [
		path.join(ROOT, 'esbuild.js'),
		...fs.readdirSync(path.join(ROOT, 'scripts')).map(n => path.join(ROOT, 'scripts', n)),
	].filter(fs.existsSync);

	// El corpus va SIN COMENTARIOS, y no es higiene: un nombre que solo aparece
	// dentro de un comentario no es un nombre que el codigo tenga, asi que
	// contarlo es dar por vivo justo lo que se acaba de retirar. El caso que lo
	// obliga es este propio fichero, cuyo comentario de arriba CITA dos nombres
	// muertos como ejemplo y por tanto los vacunaba contra su propia regla.
	const everything = [...sourceFiles(SRC), ...buildScripts]
		.map(read)
		.map(stripComments)
		.join('\n');
	const misses = new Map();

	for (const file of docs(ROOT)) {
		// Los bloques de código son comandos y diagramas, no citas.
		const text = read(file).replace(/```[\s\S]*?```/g, '');

		for (const [, span] of text.matchAll(SPAN)) {
			if (!isCitation(span)) { continue; }
			for (const [name] of span.matchAll(IDENTIFIER)) {
				if (!LOOKS_LIKE_CODE.test(name)) { continue; }   // prosa en minúsculas
				if (name.length < 4) { continue; }
				if (NOT_OURS.has(name)) { continue; }
				if (everything.includes(name)) { continue; }

				const where = misses.get(name) ?? new Set();
				where.add(path.relative(ROOT, file).split(path.sep).join('/'));
				misses.set(name, where);
			}
		}
	}

	for (const [name, where] of [...misses].sort()) {
		fail(`\`${name}\` is cited in ${[...where].sort().join(', ')} and exists nowhere in src/`);
	}

	// Una excepción que ya no cita nadie es una nota sobre un nombre que la prosa
	// ha dejado de nombrar.
	//
	// El corpus de ESTA mitad se mide sin la propia lista, y hace falta: NOT_OURS
	// vive en un script del build, que es parte del corpus, así que cada nombre
	// exceptuado se encontraba a sí mismo y esta comprobación no podía fallar
	// nunca. Es el mismo agujero que el de los comentarios, un fichero más allá.
	const prose = docs(ROOT).map(read).join('\n');
	const code = everything.replace(/const NOT_OURS = new Set\(\[[\s\S]*?\]\);/, '');
	for (const name of NOT_OURS) {
		if (!prose.includes(name) && !code.includes(name)) {
			fail(`NOT_OURS names "${name}", which no document cites any more`);
		}
	}
}

//= 6. LA FRONTERA DE CONFIANZA
//
// El conjunto entero no se puede afirmar desde un escaneo —qué ruta llega a qué
// puerta es flujo de datos— pero la forma que el fallo toma de verdad sí es
// exacta: un campo del mensaje convertido en `Uri` donde LLEGA, que es el
// instante en que una cadena arbitraria pasa a ser algo sobre lo que se puede
// actuar, y es un teclazo de distancia en un mapa de handlers escrito en una
// línea cada uno.

function checkTrustBoundary() {
	const provider = path.join(SRC, 'providers', 'BaysWebviewProvider.ts');
	if (!fs.existsSync(provider)) {
		fail('providers/BaysWebviewProvider.ts is gone: the trust boundary check has nothing to stand on');
		return;
	}

	const source = read(provider);
	if (/Uri\.(parse|file)\s*\(\s*msg\./.test(source)) {
		fail('providers/BaysWebviewProvider.ts turns a message field straight into a Uri: an id that arrives from the webview is a string somebody could have made up, and it becomes actionable the moment it is parsed');
	}
}

//= 7. EL SHELL SE ASIGNA UNA VEZ, Y CADA MENSAJE DEL HOST TIENE OYENTE
//
// Reasignar `webview.html` destruye el documento entero y con él el scroll, el
// foco, los grupos plegados, el bundle del cliente, las hojas y el `@font-face`
// del tema. Es el invariante del que cuelga todo el diseño del cliente, y la
// única forma de romperlo es escribir esa asignación en un segundo sitio.
//
// Y en el otro sentido: el cliente no tiene despacho central, son `if` sueltos
// dentro de un `addEventListener('message')`, así que una variante nueva de
// `HostToWebviewMessage` compila sin que la escuche NADIE. El `Record` de
// `WEBVIEW_MESSAGE_LISTENERS` obliga a nombrar su oyente; esto comprueba que ese
// nombre apunta a un fichero que de verdad lo lee.

function checkWebviewContract() {
	let assignments = 0;
	for (const file of sourceFiles(SRC)) {
		const source = read(file);
		for (const line of source.split('\n')) {
			if (/^\s*(\/\/|\*)/.test(line)) { continue; }
			if (/webview\.html\s*=/.test(line)) { assignments++; }
		}
	}
	if (assignments > 1) {
		fail(`webview.html is assigned in ${assignments} places: the shell is assigned ONCE, in resolveWebviewView, and everything else travels by postMessage`);
	}
	if (assignments === 0) {
		fail('nothing assigns webview.html: the panel would never get a document');
	}

	const protocolSource = read(path.join(SRC, 'shared', 'protocol.ts'));
	const record = /WEBVIEW_MESSAGE_LISTENERS[^{]*\{([\s\S]*?)\n\};/.exec(protocolSource);
	if (!record) {
		fail('shared/protocol.ts has no WEBVIEW_MESSAGE_LISTENERS: a host message could compile with no listener');
		return;
	}

	for (const [, type, where] of record[1].matchAll(/(\w+)\s*:\s*'([^']+)'/g)) {
		const listener = path.join(SRC, where.split('/').join(path.sep));
		if (!fs.existsSync(listener)) {
			fail(`WEBVIEW_MESSAGE_LISTENERS points "${type}" at ${where}, which does not exist`);
			continue;
		}
		if (!read(listener).includes(`msg.type === '${type}'`)) {
			fail(`WEBVIEW_MESSAGE_LISTENERS says ${where} listens for "${type}", and it does not`);
		}
	}
}

//= LA PARIDAD DE LOS BUNDLES

// Ninguno de los dos fallos que esto corta es ruidoso: una clave que falta sale
// en INGLES solo en ese idioma —el resto de la vista sigue traducida, asi que
// nadie lo lee como un error— y un `{0}` perdido se lleva el dato que llevaba
// dentro de una frase que se sigue leyendo bien. Los dos ficheros son JSON, asi
// que no los compila nadie.
function checkBundles() {
	const placeholders = (value) =>
		[...String(value).matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');

	const compare = (label, files) => {
		if (files.length < 2) { return; }
		const [base, ...rest] = files;
		const baseKeys = Object.keys(JSON.parse(read(base.path)));
		for (const other of rest) {
			const table = JSON.parse(read(other.path));
			const keys = new Set(Object.keys(table));
			for (const key of baseKeys) {
				if (!keys.has(key)) {
					fail(`${label}: ${other.name} has no "${key}", which ${base.name} declares`);
				}
			}
			for (const key of keys) {
				if (!baseKeys.includes(key)) {
					fail(`${label}: ${other.name} declares "${key}", which ${base.name} does not`);
				}
			}
		}
	};

	const bundles = fs.existsSync(L10N)
		? fs.readdirSync(L10N)
			.filter((name) => /^bundle\.l10n\..+\.json$/.test(name))
			.map((name) => ({ name, path: path.join(L10N, name) }))
		: [];
	// El ingles no lleva bundle —la clave ES la cadena inglesa—, asi que el
	// conjunto contra el que se comparan los demas son las claves del CODIGO.
	if (bundles.length > 0) {
		const wanted = new Set();
		for (const file of sourceFiles(SRC)) {
			if (file.includes(`${path.sep}test${path.sep}`)) { continue; }
			for (const [, key] of read(file).matchAll(/(?:vscode\.l10n\.t|(?<![\w.])t)\(\s*'((?:[^'\\]|\\.)+)'/g)) {
				wanted.add(key.replace(/\\'/g, "'"));
			}
		}
		// Los `title` de los estados se piden por una clave COMPUESTA (`t(title)`),
		// asi que ningun grep los alcanza: se leen de la tabla que los declara.
		for (const [, title] of read(path.join(SRC, 'shared', 'bayState.ts')).matchAll(/title\s*:\s*'([^']+)'/g)) {
			wanted.add(title);
		}
		for (const bundle of bundles) {
			const table = JSON.parse(read(bundle.path));
			for (const key of wanted) {
				if (!(key in table)) {
					fail(`l10n: ${bundle.name} has no "${key}", which the code asks for`);
				}
			}
			for (const key of Object.keys(table)) {
				if (!wanted.has(key)) {
					fail(`l10n: ${bundle.name} declares "${key}", which nothing asks for`);
				}
				if (placeholders(key) !== placeholders(table[key])) {
					fail(`l10n: ${bundle.name} spells "${key}" with different {n} placeholders`);
				}
			}
		}
	}

	const nls = fs.readdirSync(ROOT)
		.filter((name) => /^package\.nls(\..+)?\.json$/.test(name))
		.sort((a, b) => a.length - b.length)
		.map((name) => ({ name, path: path.join(ROOT, name) }));
	compare('package.nls', nls);
	if (nls.length > 1) {
		const base = JSON.parse(read(nls[0].path));
		for (const other of nls.slice(1)) {
			const table = JSON.parse(read(other.path));
			for (const key of Object.keys(table)) {
				if (key in base && placeholders(base[key]) !== placeholders(table[key])) {
					fail(`package.nls: ${other.name} spells "${key}" with different {n} placeholders`);
				}
			}
		}
	}

	// Y la otra mitad: una clave que el manifiesto NOMBRA y el bundle ingles no
	// lleva sale en pantalla como el propio `%clave%`.
	const declared = new Set(Object.keys(JSON.parse(read(path.join(ROOT, 'package.nls.json')))));
	for (const [, key] of read(path.join(ROOT, 'package.json')).matchAll(/"%([^%"]+)%"/g)) {
		if (!declared.has(key)) {
			fail(`package.json names %${key}%, which package.nls.json does not declare`);
		}
	}
	for (const key of declared) {
		if (!read(path.join(ROOT, 'package.json')).includes(`"%${key}%"`)) {
			fail(`package.nls.json declares "${key}", which package.json does not name`);
		}
	}
}

checkFolders();
checkCommands();
checkSettings();
checkDisposal();
checkCitedIdentifiers();
checkTrustBoundary();
checkWebviewContract();
checkBundles();

if (failures > 0) {
	console.error(`[check-layers] ${failures} problem(s)`);
	process.exit(1);
}
console.log('[check-layers] folders, command ids, settings keys, disposal, cited identifiers, the trust boundary, the webview contract and the l10n bundles all hold');
