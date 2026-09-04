// Asserts that every `src/`-relative path cited in the documentation and in the
// code comments still names a file that exists, that every image a markdown
// points at is there, and that what the marketplace renders carries no dashes
// and no typographic quotes.
//
// The architecture prose is prose: nothing compiles it, so a path that goes
// stale keeps reading as true and actively misdirects. When this check was first
// written the guide still cited `src/webview/contextmenu.js` and
// `src/webview/webview.js`, months after the client became TypeScript. A rename
// that updates every import and leaves the guide behind passes `compile`.
//
// Only DIRECTORY-PREFIXED references are checked (`utils/pathFormatters.ts`,
// `src/webview/main.ts`, `scripts/check-layers.js`). A bare filename is
// deliberately out of scope: it survives a move, so it cannot rot.
//
// Scope is `src/` and `scripts/` alone: `dist/` and `out/` are build outputs
// that need not exist.

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Top-level directories under src/ that a citation may start with. */
const SRC_DIRS = [
	'commands', 'constants', 'models', 'platform', 'providers',
	'services', 'shared', 'styles', 'test', 'utils', 'webview',
];

/**
 * The BUILD's own scripts are cited by path too and rot the same way, so they
 * are in scope. `esbuild.js` at the root stays out for the reason a bare
 * filename does: it has no directory to go stale with.
 */
// `dist/` and `out/` are build OUTPUT: `dist/webview/main.js` is cited all over
// the guide and need not exist on a clean checkout, so a citation carrying one
// of those prefixes is not ours to resolve. The trailing boundary is what stops
// `tsconfig.json` from being read as a citation of `tsconfig.js`.
const CITATION = new RegExp(
	String.raw`(?<!dist\/)(?<!out\/)\b(?:src\/)?(?:extension\.ts|scripts\/[A-Za-z0-9_.-]*\.js|(?:${SRC_DIRS.join('|')})\/[A-Za-z0-9_.\/-]*\.(?:ts|css|js|mjs))(?![A-Za-z0-9])`,
	'g',
);

/** A citation with a glob or a `<placeholder>` names a set, not a file. */
function isTemplate(ref) {
	return /[*<>{}]/.test(ref);
}

/**
 * Every markdown of the repository EXCEPT the work notes.
 *
 * Discovered instead of listed, which is the whole reason this scales: a
 * hand-written list leaves the next document out, silently.
 *
 * `plan*.md` is skipped by the same pattern that keeps it out of the `.vsix`:
 * work notes are a snapshot of a moment and are allowed to name what that moment
 * had. `CHANGELOG.md` is skipped for the same reason — a released entry
 * describes the code as it was.
 */
function docFiles(dir, out = []) {
	const SKIP = new Set(['node_modules', 'dist', 'out', '.git', '.vscode-test']);
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) { continue; }
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			docFiles(full, out);
		} else if (entry.name.endsWith('.md')
			&& !/^plan.*\.md$/i.test(entry.name)
			&& entry.name !== 'CHANGELOG.md') {
			out.push(full);
		}
	}
	return out;
}

/**
 * src/test/ is skipped: it is the one place where a path-shaped string is DATA
 * and not a citation, and no rename should ever be blocked by a fixture.
 */
function sourceFiles(dir, out = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== 'test') { sourceFiles(full, out); }
		} else if (/\.(ts|css)$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Every image a doc points at has to exist. The marketplace renders README.md as
 * the extension's page, so a path that names nothing does not fail here or at
 * package time: it fails on the published page, as a broken image on the first
 * thing anyone sees.
 *
 * HTML comments are stripped first — an image slot still to be captured lives
 * commented out and breaks nothing. Remote URLs are somebody else's to keep
 * alive.
 */
const IMAGE = /!\[[^\]]*\]\(([^)]+)\)/g;

function checkImages(scanned) {
	const misses = new Map();
	let checked = 0;

	for (const file of scanned) {
		if (!file.endsWith('.md')) { continue; }
		const text = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

		for (const [, ref] of text.matchAll(IMAGE)) {
			if (/^(https?:)?\/\//.test(ref)) { continue; }
			checked++;
			const target = path.join(ROOT, ref.split('#')[0].split('?')[0]);
			if (!fs.existsSync(target)) {
				const where = misses.get(ref) ?? new Set();
				where.add(path.relative(ROOT, file).replace(/\\/g, '/'));
				misses.set(ref, where);
			}
		}
	}

	return { misses, checked };
}

//= THE PUNCTUATION OF WHAT SHIPS

/**
 * No dashes and no typographic quotes in what the marketplace renders.
 *
 * They read as machine text, which is exactly what a marketplace page cannot
 * look like.
 *
 * What this does NOT decide is the replacement. Each dash is swapped for what it
 * was really doing: a colon where what follows explains what came before,
 * parentheses around an aside, a comma for a short one, a full stop where there
 * were two ideas. That is a judgement per sentence, and a blind sweep to hyphens
 * leaves the prose worse than it found it — which is why this cuts instead of
 * fixing.
 */
const SHIPPED = ['README.md', 'CHANGELOG.md'];

/**
 * Chinese and Japanese keep their own punctuation: there `“”` are the native
 * quotes and `——` the standard dash, so replacing them with ASCII does not
 * depersonalize the translation, it writes it wrong.
 *
 * What IS corrected there is a LOOSE dash in the English manner (a single one,
 * or a spaced `——`), which is a calque of the source and not the typography of
 * the language.
 */
const CJK = /\.(?:ja|zh-cn)\.json$/;

/** The `…` of a UI label and the arrows stay: see the guide's punctuation rule. */
const TYPOGRAPHIC = /[–‘’“”]/g;

function offenders(line, cjk) {
	const out = [];
	for (const m of line.matchAll(TYPOGRAPHIC)) {
		if (cjk && (m[0] === '“' || m[0] === '”')) { continue; }
		out.push(m[0]);
	}
	for (const m of line.matchAll(/—+/g)) {
		const spaced = line[m.index - 1] === ' ' || line[m.index + m[0].length] === ' ';
		if (cjk && m[0] === '——' && !spaced) { continue; }
		out.push(m[0]);
	}
	return out;
}

function checkPunctuation() {
	const l10n  = path.join(ROOT, 'l10n');
	const files = [
		...SHIPPED,
		...fs.readdirSync(ROOT).filter(name => /^package\.nls(\.[\w-]+)?\.json$/.test(name)),
		...(fs.existsSync(l10n) ? fs.readdirSync(l10n).filter(n => n.endsWith('.json')).map(n => `l10n/${n}`) : []),
	];

	const bad = [];
	for (const rel of files) {
		const full = path.join(ROOT, rel);
		if (!fs.existsSync(full)) { continue; }
		const cjk = CJK.test(rel);
		fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
			for (const char of offenders(line, cjk)) {
				bad.push(`  ${rel}:${i + 1}  ${char}`);
			}
		});
	}

	if (bad.length > 0) {
		console.error(`[check-docs] ${bad.length} dash(es) or typographic quote(s) in what ships:\n`);
		console.error(bad.join('\n'));
		console.error('\nReplace each with what it was doing: a colon, parentheses, a comma, a full stop.');
		process.exit(1);
	}

	return files.length;
}

function check() {
	const scanned = [
		...docFiles(ROOT),
		...sourceFiles(path.join(ROOT, 'src')),
	];

	const misses = new Map(); // ref -> Set of files citing it
	let checked = 0;

	for (const file of scanned) {
		const text = fs.readFileSync(file, 'utf8');
		for (const [ref] of text.matchAll(CITATION)) {
			if (isTemplate(ref)) { continue; }
			checked++;

			// A citation is written as it is READ (`utils/pathFormatters.ts`, with
			// the `src/` that every one of them hangs off left out) so the root is
			// where it is put back. The build's own scripts are the exception and
			// carry their real directory, which is the one they live in.
			const target = ref.startsWith('src/') || ref.startsWith('scripts/')
				? path.join(ROOT, ref)
				: path.join(ROOT, 'src', ref);

			if (!fs.existsSync(target)) {
				const where = misses.get(ref) ?? new Set();
				where.add(path.relative(ROOT, file).replace(/\\/g, '/'));
				misses.set(ref, where);
			}
		}
	}

	const images = checkImages(scanned);
	for (const [ref, where] of images.misses) { misses.set(ref, where); }

	if (misses.size > 0) {
		console.error(`[check-docs] ${misses.size} path(s) cited but not found:\n`);
		for (const [ref, where] of [...misses].sort()) {
			console.error(`  ${ref}`);
			console.error(`      cited in: ${[...where].sort().join(', ')}`);
		}
		console.error('\nUpdate the citation, or restore the file.');
		process.exit(1);
	}

	const shipped = checkPunctuation();

	console.log(
		`[check-docs] ${checked} path citation(s) and ${images.checked} image(s) `
		+ `across ${scanned.length} file(s): all resolve; `
		+ `${shipped} shipped file(s) carry no dash and no typographic quote`,
	);
}

check();
