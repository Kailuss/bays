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
	
	// Replace the #{ROOT_PATH}# placeholder used in source CSS files.
	// In CSS, #{ROOT_PATH}# represents the root folder for webview assets (e.g. fonts, icons),
	// and is typically used in URLs like url("#{ROOT_PATH}#/fonts/...") so the same CSS works
	// regardless of where the compiled file is emitted. At build time our bundled CSS is
	// written to dist/styles/, while shared assets live one level up (e.g. dist/fonts or
	// dist/codicons), so we replace #{ROOT_PATH}# with '..' to generate correct relative URLs.
	bundledCss = bundledCss.replace(/#{ROOT_PATH}#/g, '..');
	
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, bundledCss);
	console.log(`[build] CSS bundled: ${outputPath}`);
}

/**
 * Copia los recursos necesarios para el webview a dist/
 */
function copyWebviewResources() {
	// Combinar y copiar estilos CSS (resolviendo @imports)
	const mainCssPath = path.join(__dirname, 'src', 'styles', 'webview.css');
	const distCssPath = path.join(__dirname, 'dist', 'styles', 'webview.css');
	if (fs.existsSync(mainCssPath)) {
		bundleCss(mainCssPath, distCssPath);
	}

	// Copiar scripts del webview
	const webviewDir = path.join(__dirname, 'src', 'webview');
	const distWebviewDir = path.join(__dirname, 'dist', 'webview');
	if (fs.existsSync(webviewDir)) {
		copyDir(webviewDir, distWebviewDir);
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

async function main() {
	// Copiar recursos del webview antes de compilar
	copyWebviewResources();

	const ctx = await esbuild.context({
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
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
