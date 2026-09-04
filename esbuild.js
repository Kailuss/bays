const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production  = process.argv.includes('--production');
const watch       = process.argv.includes('--watch');
const testsOnly   = process.argv.includes('--tests');

//= LAS GUARDAS
//
// La puerta de calidad no comprueba lo que PRODUCE, así que los fallos que
// importan son los que salen en verde. Todo lo de esta sección corta uno de
// ellos, y todos estaban en verde el día que se escribieron: un check escrito
// después de la deriva es una limpieza, uno escrito antes es una frontera.

/**
 * Las parejas de hojas que dependen del ORDEN de carga, y por qué.
 *
 * Movidas, la cascada las resuelve al revés y el panel sigue teniendo aspecto de
 * panel: se apagan unos colores, se pierde el tamaño de un icono. Nada lo
 * reporta en ejecución. Una hoja que no comparte selector con nadie es libre de
 * moverse y por eso NO está aquí.
 */
const CSS_ORDER = [
  ['base.css', 'group-header.css', 'the reset has to land before anything that styles a box'],
  ['bay-layout.css', 'bay-content.css', 'content refines the boxes layout declares (.bay-text, .bay-name)'],
  ['bay-content.css', 'variants.css', 'a variant row overrides the icon and text sizing of a normal one'],
  ['bay-content.css', 'bay-file-states.css', 'the git/diagnostic colours tie with .bay-name and must win'],
  ['bay-layout.css', 'bay-states.css', 'active/drop states override the base row box'],
  ['base.css', 'scrollbar.css', 'the overlay bar reads the gap and width tokens base.css declares'],
];

/** La primera hoja: es el reset, y un reset detrás de una regla la deshace. */
const CSS_FIRST = 'base.css';

/**
 * Copia recursivamente un directorio
 */
function copyDir(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDir(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

/** Todos los ficheros con una extensión bajo un directorio, recursivamente. */
function sourceFiles(dir, ext, out = []) {
	if (!fs.existsSync(dir)) { return out; }
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) { sourceFiles(full, ext, out); }
		else if (entry.name.endsWith(ext)) { out.push(full); }
	}
	return out;
}

/**
 * Combina todos los archivos CSS en uno solo, resolviendo los @import.
 *
 * Un `@import` que no resuelve AVISABA y seguía: el `.vsix` salía en verde y al
 * panel le faltaban reglas. Ahora corta. Por `process.exitCode` y no por
 * `throw`, porque esto corre dentro del `onEnd` del build del host, una línea
 * antes del `[watch] build finished` que `.vscode/tasks.json` declara como su
 * `endsPattern`: reventar ahí deja el `preLaunchTask` de F5 esperando para
 * siempre.
 */
function bundleCss(mainCssPath, outputPath) {
	const cssDir = path.dirname(mainCssPath);
	let mainContent = fs.readFileSync(mainCssPath, 'utf8');

	// Resolver @import statements
	const importRegex = /@import\s+['"](.+?)['"]\s*;/g;
	let match;
	let bundledCss = '';

	while ((match = importRegex.exec(mainContent)) !== null) {
		const importPath = match[1];
		const fullPath = path.join(cssDir, importPath);

		if (fs.existsSync(fullPath)) {
			const importedContent = fs.readFileSync(fullPath, 'utf8');
			bundledCss += `/* === ${importPath} === */\n${importedContent}\n\n`;
		} else {
			console.error(`[build] CSS import does not resolve: ${importPath} (from ${path.relative(__dirname, mainCssPath)})`);
			process.exitCode = 1;
		}
	}

	// Preservar las reglas propias del archivo principal (todo lo que no sea un
	// @import). Antes se descartaban salvo cuando no había ningún @import, así que
	// reglas de nivel superior como .seti-icon nunca llegaban al bundle.
	const mainOwnCss = mainContent.replace(importRegex, '').trim();
	if (mainOwnCss) {
		bundledCss += `/* === webview.css (own rules) === */\n${mainOwnCss}\n`;
	}
	if (!bundledCss) {
		bundledCss = mainContent;
	}

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, bundledCss);

	// Cota inferior al tamaño: es lo único que mira dist/, y un bundle que se
	// queda en nada es exactamente lo que un build en verde no puede producir.
	if (bundledCss.length < 2000) {
		console.error(`[build] The CSS bundle came out at ${bundledCss.length} bytes: something did not get in`);
		process.exitCode = 1;
	}

	console.log(`[build] CSS bundled: ${outputPath}`);
}

/**
 * El orden de los `@import`, y que ninguna hoja se quede fuera.
 */
function checkCssOrder() {
	const entryPath = path.join(__dirname, 'src', 'styles', 'webview.css');
	if (!fs.existsSync(entryPath)) {
		console.error('[build] src/styles/webview.css is missing: the panel would load no stylesheet at all');
		process.exitCode = 1;
		return;
	}

	const source = fs.readFileSync(entryPath, 'utf8');
	const order = [...source.matchAll(/@import\s+['"]\.\/(.+?)['"]\s*;/g)].map(m => m[1]);
	if (order.length === 0) {
		console.error('[build] No @import resolved in src/styles/webview.css');
		process.exitCode = 1;
		return;
	}

	for (const [before, after, why] of CSS_ORDER) {
		const a = order.indexOf(before);
		const b = order.indexOf(after);
		if (a < 0 || b < 0) {
			console.error(`[build] CSS order check names a sheet that is not imported: ${a < 0 ? before : after}`);
			process.exitCode = 1;
			continue;
		}
		if (a > b) {
			console.error(`[build] ${before} must be imported before ${after}: ${why}`);
			process.exitCode = 1;
		}
	}

	if (order[0] !== CSS_FIRST) {
		console.error(`[build] ${CSS_FIRST} must be the first @import, not ${order[0]}`);
		process.exitCode = 1;
	}

	checkCssCoverage(order);
}

/**
 * Toda hoja de src/styles/ la importa webview.css.
 *
 * La tercera forma de perder CSS en silencio, y la única que quedaba fuera: las
 * dos de arriba cortan un entry point que falta y un `@import` que no resuelve,
 * pero una hoja que EXISTE y que no importa nadie se cae del bundle con el build
 * en verde. Sus reglas sencillamente no llegan al panel, que se ve como lo que
 * la cascada deje y no como un error.
 */
function checkCssCoverage(order) {
	const dir = path.join(__dirname, 'src', 'styles');
	const imported = new Set(order.map(rel => rel.split('/').join(path.sep)));

	for (const file of sourceFiles(dir, '.css')) {
		const rel = path.relative(dir, file);
		if (rel === 'webview.css') { continue; }
		if (!imported.has(rel)) {
			console.error(`[build] src/styles/${rel.split(path.sep).join('/')} is imported by nobody: its rules never reach the panel`);
			process.exitCode = 1;
		}
	}
}

/**
 * Todo nombre de codicon que la extensión dibuja existe en el `codicon.css` que
 * se copia al lado, y la VISTA no deletrea ninguno fuera de `shared/icons.ts`.
 *
 * Un nombre de codicon es una cadena y `codicon.css` no lleva regla para uno que
 * no conoce: mal escrito no pinta NADA, con `check-types`, el lint y el build en
 * verde. Los nombres llegan por cuatro caminos y los cuatro se comprueban:
 *
 *  - `shared/icons.ts`, la tabla por rol de lo que la vista dibuja;
 *  - las TABLAS de datos (`constants/diffTypes.ts`, `constants/fileQuickActions/`,
 *    `utils/builtinIcons.ts`), que son datos y no vista, así que sus nombres se
 *    validan aunque no pasen por el diccionario;
 *  - los `$(nombre)` del manifiesto, que los dibuja el propio workbench;
 *  - y cualquier `codicon-<nombre>` literal que quede suelto.
 *
 * La segunda mitad es la que vale tanto como la primera: un glifo escrito dentro
 * de un renderer se ha escapado de la tabla, y con ella del escaneo por rol.
 */
function checkIcons() {
	const cssPath = path.join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css');
	if (!fs.existsSync(cssPath)) {
		console.error('[build] @vscode/codicons is not installed: the icon names cannot be checked');
		process.exitCode = 1;
		return;
	}

	const declared = new Set(
		[...fs.readFileSync(cssPath, 'utf8').matchAll(/\.codicon-([a-z0-9-]+):before/g)].map(m => m[1]),
	);

	/** name -> where it was found. */
	const used = new Map();
	const note = (name, where) => {
		if (!used.has(name)) { used.set(name, where); }
	};

	// 1) El diccionario por rol.
	const iconsPath = path.join(__dirname, 'src', 'shared', 'icons.ts');
	const iconsSource = fs.readFileSync(iconsPath, 'utf8');
	for (const [, name] of iconsSource.matchAll(/:\s*'([a-z0-9-]+)'/g)) {
		note(name, 'shared/icons.ts');
	}

	// 2) Las tablas de datos y todo literal suelto.
	const VIEW_DIRS = ['providers', 'webview'];
	for (const file of [...sourceFiles(path.join(__dirname, 'src'), '.ts'), ...sourceFiles(path.join(__dirname, 'src'), '.css')]) {
		const rel = path.relative(path.join(__dirname, 'src'), file).split(path.sep).join('/');
		if (rel === 'shared/icons.ts') { continue; }
		// src/test/ es el único sitio donde una cadena con forma de codicon es un
		// DATO y no un glifo que se dibuje: un fixture nombra `good` y `bad-id`
		// para comprobar que la regla descarta lo que no encaja. Es el mismo
		// argumento por el que `check-docs` se salta ese directorio.
		if (rel.startsWith('test/')) { continue; }

		const source = fs.readFileSync(file, 'utf8');
		// Las líneas de comentario se saltan: esta guía y varios ficheros nombran
		// glifos en prosa.
		const code = source.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

		for (const [, name] of code.matchAll(/codicon-([a-z0-9-]+)/g)) {
			note(name, rel);
			// La otra mitad: la VISTA pide sus glifos al diccionario. Una tabla de
			// datos puede llevarlos escritos; un renderer no.
			if (VIEW_DIRS.some(d => rel.startsWith(`${d}/`))) {
				console.error(`[build] ${rel} spells the codicon "${name}" outside shared/icons.ts`);
				process.exitCode = 1;
			}
		}
		// El `icon:` de una tabla de datos.
		for (const [, name] of code.matchAll(/\bicon\s*:\s*'([a-z0-9-]+)'/g)) {
			note(name, rel);
		}
	}

	// 3) Los `$(nombre)` del manifiesto.
	const manifest = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8');
	for (const [, name] of manifest.matchAll(/\$\(([a-z0-9-]+)\)/g)) {
		note(name, 'package.json');
	}

	for (const [name, where] of used) {
		if (!declared.has(name)) {
			console.error(`[build] codicon "${name}" (in ${where}) is not declared in codicon.css: it draws nothing`);
			process.exitCode = 1;
		}
	}

	console.log(`[build] Icons: ${used.size} codicon name(s) checked against codicon.css`);
}

/**
 * Copia los recursos estáticos del webview a dist/ (CSS y codicons).
 * El JS del cliente ya NO se copia: es TypeScript bundleado por esbuild
 * (src/webview/main.ts → dist/webview/main.js, ver webviewCtx en main()).
 */
function copyWebviewResources() {
	checkCssOrder();

	// Combinar y copiar estilos CSS (resolviendo @imports)
	const mainCssPath = path.join(__dirname, 'src', 'styles', 'webview.css');
	const distCssPath = path.join(__dirname, 'dist', 'styles', 'webview.css');
	if (fs.existsSync(mainCssPath)) {
		bundleCss(mainCssPath, distCssPath);
	}

	// Copiar codicons (necesarios para iconos en el webview)
	const codiconsDir = path.join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist');
	const distCodiconsDir = path.join(__dirname, 'dist', 'codicons');
	if (fs.existsSync(codiconsDir)) {
		copyDir(codiconsDir, distCodiconsDir);
	} else {
		console.error('[build] @vscode/codicons/dist is missing: the panel would draw no codicon at all');
		process.exitCode = 1;
	}

	console.log('[build] Webview resources copied to dist/');
}

/**
 * Bundlea la suite PURA a out/test/.
 *
 * `node --test` recibe un glob, y un glob que no casa con nada sale con 0: que
 * la suite desaparezca y que la suite pase son el mismo código de salida. El
 * borrado va PRIMERO, por encima de toda salida temprana: con los bundles del
 * build anterior en disco, esa pasada en verde reporta sus casos viejos contra
 * código que ya no existe.
 *
 * Reventar es seguro AQUÍ y en ningún otro sitio de este fichero: `buildTests`
 * solo corre bajo `--tests`, directo desde `main()`, cuyo `.catch` sale con
 * código 1. El camino del CSS corre dentro de un `onEnd` de watch y no puede.
 */
async function buildTests() {
	fs.rmSync(path.join(__dirname, 'out', 'test'), { recursive: true, force: true });

	const testDir = path.join(__dirname, 'src', 'test');
	if (!fs.existsSync(testDir)) {
		throw new Error('[build] No src/test directory: a green test step with nothing to run is worse than a red one');
	}

	const dirents = fs.readdirSync(testDir, { withFileTypes: true });

	// El escaneo no es recursivo y package.json corre un glob plano
	// out/test/*.test.js, así que un test movido a un subdirectorio no llega a ser
	// entry point y no se corre nunca, sin error por ninguno de los dos lados.
	const nested = dirents.filter(e => e.isDirectory()).map(e => e.name);
	if (nested.length > 0) {
		throw new Error(`[build] src/test must stay flat, found subdirector${nested.length > 1 ? 'ies' : 'y'}: ${nested.join(', ')}`);
	}

	const entryPoints = dirents
		.filter(e => e.name.endsWith('.test.ts'))
		.map(e => path.join('src', 'test', e.name));

	if (entryPoints.length === 0) {
		throw new Error('[build] No *.test.ts files found in src/test');
	}

	await esbuild.build({
		entryPoints,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'node20',
		sourcemap: true,
		outdir: 'out/test',
		// `vscode` está aquí como red y no como uso: la suite pura no lo importa,
		// y un import que se colara tiene que fallar al CARGAR el test y no
		// romper el bundle con un mensaje sobre un módulo de Node.
		external: ['vscode', 'node:test', 'node:assert'],
		logLevel: 'warning',
	});
	console.log(`[build] Tests bundled: ${entryPoints.length} file(s) → out/test/`);
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			// Re-bundle CSS and copy webview assets on every rebuild
			copyWebviewResources();
			console.log('[watch] build finished');
		});
	},
};

/**
 * Problem matcher del bundle del webview: solo reporta errores (los assets
 * los copia ya el matcher del host).
 * @type {import('esbuild').Plugin}
 */
const webviewProblemMatcherPlugin = {
	name: 'webview-problem-matcher',

	setup(build) {
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			if (result.errors.length === 0) {
				console.log('[build] Webview bundle: dist/webview/main.js');
			}
		});
	},
};

async function main() {
	if (testsOnly) {
		await buildTests();
		return;
	}

	// Las guardas que no dependen de nada que se construya van primero: fallan
	// antes de gastar un build entero.
	checkIcons();

	// Limpiar restos de builds anteriores del webview (los antiguos *.js
	// copiados verbatim quedarían empaquetados si no se borran).
	fs.rmSync(path.join(__dirname, 'dist', 'webview'), { recursive: true, force: true });

	// Copiar recursos del webview antes de compilar
	copyWebviewResources();

	// Extension host (Node, CJS)
	const hostCtx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});

	// Cliente del webview (navegador, IIFE). Un único bundle: el grafo de
	// imports de main.ts define el orden, sin depender de <script> tags.
	const webviewCtx = await esbuild.context({
		entryPoints: [
			'src/webview/main.ts'
		],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		target: 'es2022',
		outfile: 'dist/webview/main.js',
		logLevel: 'silent',
		plugins: [
			webviewProblemMatcherPlugin,
		],
	});

	if (watch) {
		await hostCtx.watch();
		await webviewCtx.watch();
	} else {
		await hostCtx.rebuild();
		await webviewCtx.rebuild();
		await hostCtx.dispose();
		await webviewCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
