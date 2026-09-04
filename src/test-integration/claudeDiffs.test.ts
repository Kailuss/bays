import * as assert from 'assert';
import * as vscode from 'vscode';
import { classifyDiffType, resolveSourceUri, determineParentId } from '../services/core/helpers/tabClassifier';

// Claude Code's chat diffs are served from temporary FileSystemProviders
// (`_claude_fs_*` / `_claude_vscode_fs_*`) whose path IS the real file path.
// Without this detection they fell into 'unknown' and the parent id pointed at
// a provider URI, so the variant was left orphaned -- and the rule is that a
// variant never lives without its parent.
//
// What is left here is only what needs a real `vscode.Uri`: normalizing the
// provider scheme back to the file, and the parent id that follows from it. The
// classification itself is a pure rule and is pinned in
// `src/test/diffRules.test.ts`, which runs in milliseconds.

suite('resolveSourceUri', () => {
	test('Claude Code provider schemes normalize to the real file URI', () => {
		const provider = vscode.Uri.from({ scheme: '_claude_fs_right', path: '/c:/p/src/app.ts' });
		assert.strictEqual(resolveSourceUri(provider).toString(), vscode.Uri.file('/c:/p/src/app.ts').toString());
	});

	test('the parent id of a Claude Code diff matches the real file bay id', () => {
		const original = vscode.Uri.file('/p/src/app.ts');
		const modified = vscode.Uri.from({ scheme: '_claude_vscode_fs_right', path: '/p/src/app.ts' });
		const diffType = classifyDiffType('✻ [Claude Code] app.ts', original, modified);
		assert.strictEqual(
			determineParentId(diffType, modified, vscode.ViewColumn.One, original, modified),
			`${vscode.Uri.file('/p/src/app.ts').toString()}-1`,
		);
	});
});
