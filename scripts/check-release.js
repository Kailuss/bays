// Asserts that the manifest and the changelog agree about what is being cut.
//
// The rule is in CLAUDE.md, under "Antes de empaquetar": a package meant to be
// published carries a version that has never been published and a changelog
// entry that names it. The two halves fail at opposite ends and neither one is
// loud where it happens.
//
// The VERSION is refused by `vsce publish` and by nothing else. `vsce package`
// builds the same version as many times as it is asked, so a green `.vsix` says
// nothing, and the refusal lands at the very last step with the packaging and
// the whole quality gate already paid for.
//
// The CHANGELOG is refused by nobody. The marketplace renders it in its own tab,
// so a release with no entry publishes perfectly and arrives as a version whose
// page cannot say what changed. That is the half worth a check.
//
// And a changelog is the one file here that nothing compiles and nothing reads
// back: the 0.17.0 heading was written twice by two edits that were each correct
// on their own, and nothing said so.

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let failures = 0;

function fail(message) {
	console.error(`[check-release] ${message}`);
	failures++;
}

const manifest  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');

/**
 * Every `## [x.y.z] - date` heading, in the order they appear. The bracket is
 * the Keep a Changelog form the file declares in its own header, so a heading
 * without it is not a release entry and is not counted.
 */
const headings = [...changelog.matchAll(/^## \[([^\]]+)\](?:\s*-\s*(\S+))?/gm)]
	.map(m => ({ version: m[1], date: m[2], at: m.index }));

/** The current version has an entry, and it is the one on top. */
function checkEntry() {
	const version = manifest.version;
	const found   = headings.find(h => h.version === version);

	if (!found) {
		fail(`package.json is at ${version} and CHANGELOG.md has no "## [${version}]" heading`);
		return;
	}
	if (headings[0].version !== version) {
		fail(`CHANGELOG.md opens with ${headings[0].version}, not the version being cut (${version})`);
	}
	if (!found.date) {
		fail(`the ${version} heading carries no date`);
	} else if (!/^\d{4}-\d{2}-\d{2}$/.test(found.date)) {
		fail(`the ${version} heading is dated "${found.date}", not YYYY-MM-DD`);
	}

	// An entry that names the version and says nothing is the same silence with
	// a heading over it.
	const next = headings.find(h => h.at > found.at);
	const body = changelog.slice(found.at, next ? next.at : changelog.length);
	if (!/^- /m.test(body)) {
		fail(`the ${version} entry has no bullets: a heading is not a release note`);
	}
}

/** No version is written twice. Two entries for one release is one of them lost. */
function checkUnique() {
	const seen = new Set();
	for (const { version } of headings) {
		if (seen.has(version)) { fail(`CHANGELOG.md has more than one "## [${version}]" heading`); }
		seen.add(version);
	}
}

/** Versions descend. A release filed under an older one is a release nobody reads. */
function checkOrder() {
	const rank = v => v.split('.').map(n => parseInt(n, 10));
	const after = (a, b) => {
		const [x, y] = [rank(a), rank(b)];
		for (let i = 0; i < 3; i++) {
			if ((x[i] || 0) !== (y[i] || 0)) { return (x[i] || 0) > (y[i] || 0); }
		}
		return false;
	};
	for (let i = 1; i < headings.length; i++) {
		const prev = headings[i - 1].version;
		const here = headings[i].version;
		if (!after(prev, here)) {
			fail(`CHANGELOG.md lists ${here} under ${prev}: entries run newest first`);
		}
	}
}

if (headings.length === 0) {
	fail('CHANGELOG.md has no "## [x.y.z]" headings at all');
} else {
	checkEntry();
	checkUnique();
	checkOrder();
}

if (failures > 0) {
	console.error(`[check-release] ${failures} problem(s) between package.json and CHANGELOG.md`);
	process.exit(1);
}
console.log(`[check-release] ${manifest.version} is on top of CHANGELOG.md, dated, written and unique`);
