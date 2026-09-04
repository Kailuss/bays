// @ts-check
'use strict';

/**
 * The one `vsce` flag that nothing else checks, DERIVED instead of remembered.
 *
 * The CHANNEL is the expensive mistake in this project. An odd minor ships
 * pre-release and an even one ships stable, the marketplace deduces neither, and
 * the only thing that says which is `--pre-release`. Forgotten on an odd minor,
 * that version goes out as the latest STABLE build to everybody and updates on
 * its own — and a version cannot be unpublished, so the only way out is
 * publishing another on top of it. Silent, in the very last step, and the one
 * mistake here with no way back.
 *
 * Bays declares `repository`, so `--allow-missing-repository` is deliberately
 * NOT passed: the field is there, the links `vsce` derives from it resolve, and
 * a flag that silences a question nobody is being asked is a flag that hides the
 * day the field goes away.
 *
 * What this does NOT do, because it cannot: tell whether this version has
 * already been published. That answer lives on the marketplace and `vsce
 * publish` is what refuses it. `check-release` hangs off `vscode:prepublish` and
 * covers the other half: that the version in the manifest has an entry of its
 * own in the changelog, dated and written.
 */

const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MODES = ['package', 'publish'];

const mode = process.argv[2];
if (!MODES.includes(mode)) {
  fail(`usage: node scripts/release.js <${MODES.join('|')}>`);
}

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const version = String(manifest.version ?? '');

// Strict, because everything below is read off it: a version this cannot parse
// is one whose channel would be guessed.
const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!parts) {
  fail(`the manifest's version is not x.y.z: ${version || '(missing)'}`);
}

const minor = Number(parts[2]);
const preRelease = minor % 2 === 1;
const channel = preRelease ? 'PRE-RELEASE' : 'STABLE';

// Anything else is handed to `vsce` untouched: an `--out`, a `--packagePath`.
// The DERIVED one is refused rather than passed on — typing it back is exactly
// the remembering this exists to remove, and typed wrong it is the one mistake
// here that cannot be taken back.
const extra = process.argv.slice(3);
if (extra.includes('--pre-release')) {
  fail('--pre-release is derived from the version and must not be passed');
}

const args = [mode, ...(preRelease ? ['--pre-release'] : []), ...extra];

// Said out loud before anything runs, and naming the fact it was derived FROM:
// the one number that decides the channel is the minor, and a line that prints
// both can be read as wrong before the run rather than after it.
console.log(`[release] ${version}: minor ${minor} is ${preRelease ? 'odd' : 'even'}, so ${channel}`);
console.log(`[release] vsce ${args.join(' ')}`);

// `vsce` is not a dependency of this project and does not need to be: it runs
// from wherever it is installed. Through a shell on Windows because what is on
// PATH there is `vsce.cmd`, and no argument composed above carries a space.
const run = spawnSync('vsce', args, { stdio: 'inherit', shell: process.platform === 'win32' });

if (run.error && /** @type {NodeJS.ErrnoException} */ (run.error).code === 'ENOENT') {
  fail('vsce was not found on PATH: install it with `npm i -g @vscode/vsce`');
}
if (run.error) { fail(String(run.error.message)); }

process.exit(run.status ?? 1);

/** @param {string} message */
function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}
