import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension activation', () => {
	test('the extension is present and activates', async () => {
		const ext = vscode.extensions.getExtension('Kailuss.bays');
		assert.ok(ext, 'extension Kailuss.bays not found in the test host');
		await ext.activate();
		assert.strictEqual(ext.isActive, true);
	});

	test('contributed commands are registered after activation', async () => {
		const all = await vscode.commands.getCommands(true);
		for (const cmd of ['bays.openBay', 'bays.closeBay', 'bays.refresh', 'bays.pinBay', 'bays.closeToRight']) {
			assert.ok(all.includes(cmd), `command ${cmd} is not registered`);
		}
	});
});
