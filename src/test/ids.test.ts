import * as assert from 'assert';
import * as vscode from 'vscode';
import { generateId, generateVariantId } from '../services/core/helpers/tabConverter';
import { classifyDiffType, resolveSourceUri, determineParentId } from '../services/core/helpers/tabClassifier';

// La generación de IDs es el contrato más delicado del proyecto: el mismo id
// tiene que poder RECONSTRUIRSE desde la tab nativa (open, close y active-sync
// deben coincidir). Estos tests fijan ese contrato.
suite('generateId', () => {
	const uri = vscode.Uri.file('/proyecto/src/app.ts');

	test('file tabs: uri + viewColumn', () => {
		assert.strictEqual(
			generateId('app.ts', uri, vscode.ViewColumn.One, 'file'),
			`${uri.toString()}-1`,
		);
	});

	test('same file in two groups → two distinct ids', () => {
		const a = generateId('app.ts', uri, vscode.ViewColumn.One, 'file');
		const b = generateId('app.ts', uri, vscode.ViewColumn.Two, 'file');
		assert.notStrictEqual(a, b);
	});

	test('webviews: keyed on the STABLE viewType, not the mutable label', () => {
		const a = generateId('Mi sesión de Claude', undefined, vscode.ViewColumn.One, 'webview', 'mainThreadWebview-claudeVSCodePanel');
		const b = generateId('Otro título distinto', undefined, vscode.ViewColumn.One, 'webview', 'mainThreadWebview-claudeVSCodePanel');
		// Un retitulado en runtime (Claude Code) NO puede cambiar el id.
		assert.strictEqual(a, b);
	});

	test('webviews without viewType fall back to the label, sanitized', () => {
		const id = generateId('Some: Panel!', undefined, vscode.ViewColumn.One, 'webview');
		assert.strictEqual(id, 'webview:some--panel--1');
	});
});

suite('generateVariantId', () => {
	const modified = vscode.Uri.file('/p/src/app.ts');

	test('deterministic: same inputs → same id (reconstructable from the native tab)', () => {
		const original = vscode.Uri.parse('git:/p/src/app.ts?ref=HEAD');
		assert.strictEqual(
			generateVariantId(modified, original, vscode.ViewColumn.One),
			generateVariantId(modified, original, vscode.ViewColumn.One),
		);
	});

	test('two different diffs of the same file do not collide', () => {
		const workingTree = vscode.Uri.parse('git:/p/src/app.ts?ref=~');
		const staged = vscode.Uri.parse('git:/p/src/app.ts?ref=HEAD');
		assert.notStrictEqual(
			generateVariantId(modified, workingTree, vscode.ViewColumn.One),
			generateVariantId(modified, staged, vscode.ViewColumn.One),
		);
	});

	test('missing original URI still produces a diff-prefixed id', () => {
		const id = generateVariantId(modified, undefined, vscode.ViewColumn.Two);
		assert.ok(id.startsWith('diff:'));
		assert.ok(id.endsWith('-2'));
	});
});

suite('classifyDiffType', () => {
	test('working tree', () => {
		assert.strictEqual(classifyDiffType('app.ts (Working Tree)'), 'working-tree');
	});

	test('staged / index', () => {
		assert.strictEqual(classifyDiffType('app.ts (Index)'), 'staged');
	});

	test('Copilot edit pattern +X-Y', () => {
		assert.strictEqual(classifyDiffType('app.ts +12-3'), 'edit');
	});

	test('commit hash in the label', () => {
		assert.strictEqual(classifyDiffType('app.ts (1a2b3c4d)'), 'commit');
	});

	test('timeline snapshot', () => {
		assert.strictEqual(classifyDiffType('app.ts (Local History)'), 'snapshot');
	});

	// Los diffs del chat de Claude Code usan FileSystemProviders temporales
	// (_claude_fs_* / _claude_vscode_fs_*) cuyo path es la ruta real del archivo.
	// Sin esta detección caían en 'unknown' y el parentId apuntaba a una URI de
	// provider → la variante quedaba huérfana (regla: nunca sin parent).
	test('Claude Code chat edit: detected by provider scheme', () => {
		const original = vscode.Uri.file('/p/src/app.ts');
		const modified = vscode.Uri.from({ scheme: '_claude_vscode_fs_right', path: '/p/src/app.ts' });
		assert.strictEqual(classifyDiffType('✻ [Claude Code] app.ts', original, modified), 'edit');
	});

	test('Claude Code chat edit: detected by label even with plain URIs', () => {
		assert.strictEqual(classifyDiffType('✻ [Claude Code] app.ts'), 'edit');
	});
});

suite('resolveSourceUri', () => {
	test('Claude Code provider schemes normalize to the real file URI', () => {
		const provider = vscode.Uri.from({ scheme: '_claude_fs_right', path: '/c:/p/src/app.ts' });
		assert.strictEqual(resolveSourceUri(provider).toString(), vscode.Uri.file('/c:/p/src/app.ts').toString());
	});

	test('parentId of a Claude Code diff matches the real file bay id', () => {
		const original = vscode.Uri.file('/p/src/app.ts');
		const modified = vscode.Uri.from({ scheme: '_claude_vscode_fs_right', path: '/p/src/app.ts' });
		const diffType = classifyDiffType('✻ [Claude Code] app.ts', original, modified);
		assert.strictEqual(
			determineParentId(diffType, modified, vscode.ViewColumn.One, original, modified),
			`${vscode.Uri.file('/p/src/app.ts').toString()}-1`,
		);
	});
});
