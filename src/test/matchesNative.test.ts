import * as assert from 'assert';
import * as vscode from 'vscode';
import { BayHelpers } from '../models/BayHelpers';
import type { BayMetadata } from '../models/Bay';

// matchesNative es el emparejador bay ↔ tab nativa: decide si una fila del
// panel puede activarse/cerrarse. Aquí se fijan sus tres invariantes sutiles:
// viewType estable para webviews, modified+original para diffs, y el bloqueo
// variante→tab-de-texto-del-parent.

function makeMeta(partial: Partial<BayMetadata>): BayMetadata {
	return {
		id: 'test-id',
		bayType: 'file',
		fileExtension: '',
		label: '',
		...partial,
	} as BayMetadata;
}

function makeTab(input: unknown, label = ''): vscode.Tab {
	return { input, label } as vscode.Tab;
}

suite('BayHelpers.matchesNative', () => {
	const fileUri = vscode.Uri.file('/p/src/app.ts');

	test('text tab matches by URI', () => {
		const tab = makeTab(new vscode.TabInputText(fileUri));
		assert.strictEqual(BayHelpers.matchesNative(tab, makeMeta({ uri: fileUri })), true);
	});

	test('text tab does not match a different URI', () => {
		const tab = makeTab(new vscode.TabInputText(fileUri));
		const other = vscode.Uri.file('/p/src/other.ts');
		assert.strictEqual(BayHelpers.matchesNative(tab, makeMeta({ uri: other })), false);
	});

	test('webview: matches on the STABLE viewType even if the label changed', () => {
		const tab = makeTab(new vscode.TabInputWebview('mainThreadWebview-claudeVSCodePanel'), 'nuevo título runtime');
		const meta = makeMeta({
			bayType: 'webview',
			viewType: 'mainThreadWebview-claudeVSCodePanel',
			label: 'título antiguo',
		});
		assert.strictEqual(BayHelpers.matchesNative(tab, meta), true);
	});

	test('webview without viewType falls back to label equality', () => {
		const tab = makeTab(new vscode.TabInputWebview('some-view'), 'Mi Panel');
		assert.strictEqual(BayHelpers.matchesNative(tab, makeMeta({ bayType: 'webview', label: 'Mi Panel' })), true);
		assert.strictEqual(BayHelpers.matchesNative(tab, makeMeta({ bayType: 'webview', label: 'Otro' })), false);
	});

	test('diff tab: needs modified AND original URIs to agree', () => {
		const original = vscode.Uri.parse('git:/p/src/app.ts?ref=HEAD');
		const tab = makeTab(new vscode.TabInputTextDiff(original, fileUri));

		const matching = makeMeta({ sourceBayId: 'parent', uri: fileUri, originalUri: original });
		assert.strictEqual(BayHelpers.matchesNative(tab, matching), true);

		// Otro diff del MISMO archivo (distinta original) no debe resolverse aquí.
		const otherOriginal = vscode.Uri.parse('git:/p/src/app.ts?ref=~');
		const otherDiff = makeMeta({ sourceBayId: 'parent', uri: fileUri, originalUri: otherOriginal });
		assert.strictEqual(BayHelpers.matchesNative(tab, otherDiff), false);
	});

	test('a variant must NOT resolve to its parent plain-text tab', () => {
		const tab = makeTab(new vscode.TabInputText(fileUri));
		const variant = makeMeta({ sourceBayId: 'parent', uri: fileUri });
		assert.strictEqual(BayHelpers.matchesNative(tab, variant), false);
	});

	test('exception: chat snapshot variants DO match their own text tab', () => {
		const snapUri = vscode.Uri.parse('chat-editing-snapshot-text-model:/p/src/app.ts');
		const tab = makeTab(new vscode.TabInputText(snapUri));
		const variant = makeMeta({ sourceBayId: 'parent', uri: snapUri });
		assert.strictEqual(BayHelpers.matchesNative(tab, variant), true);
	});
});
