const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

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

/**
 * Combina todos los archivos CSS en uno solo, resolviendo los @import
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
			console.warn(`[build] Warning: CSS import not found: ${fullPath}`);
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
	console.log(`[build] CSS bundled: ${outputPath}`);
}

/**
 * Copia los recursos estáticos del webview a dist/ (CSS y codicons).
 * El JS del cliente ya NO se copia: es TypeScript bundleado por esbuild
 * (src/webview/main.ts → dist/webview/main.js, ver webviewCtx en main()).
 */
function copyWebviewResources() {
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
	}

	console.log('[build] Webview resources copied to dist/');
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
