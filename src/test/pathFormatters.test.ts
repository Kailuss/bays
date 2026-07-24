import * as assert from 'assert';
import * as vscode from 'vscode';
import { formatFilePathWithParts } from '../utils/pathFormatters';

// El test host corre sin carpeta de workspace, así que asRelativePath devuelve
// el fsPath crudo (con '\' en Windows). Justo el caso que rompía el truncado:
// las partes deben salir bien partiendo por AMBOS separadores.
suite('formatFilePathWithParts', () => {
	test('no uri → empty result', () => {
		assert.deepStrictEqual(formatFilePathWithParts(undefined), { formatted: '', parts: [] });
	});

	test('splits on both / and \\ and drops the file name by default', () => {
		const uri = vscode.Uri.file('/proyecto/src/services/app.ts');
		const { parts } = formatFilePathWithParts(uri);
		// Sin workspace, la primera parte puede ser la raíz ('c:' en Windows);
		// lo invariante es que los directorios están y el nombre de archivo no.
		assert.ok(parts.includes('src'), `missing 'src' in ${JSON.stringify(parts)}`);
		assert.ok(parts.includes('services'), `missing 'services' in ${JSON.stringify(parts)}`);
		assert.ok(!parts.includes('app.ts'), 'file name must be dropped by default');
	});

	test('includeFileName keeps the file name as the last part', () => {
		const uri = vscode.Uri.file('/proyecto/src/app.ts');
		const { parts } = formatFilePathWithParts(uri, { includeFileName: true });
		assert.strictEqual(parts[parts.length - 1], 'app.ts');
	});

	test('formatted joins the parts with the bullet separator', () => {
		const uri = vscode.Uri.file('/proyecto/src/services/app.ts');
		const { formatted, parts } = formatFilePathWithParts(uri);
		assert.strictEqual(formatted, parts.join(' • '));
	});

	test('useFullPath returns the raw fsPath as a single part', () => {
		const uri = vscode.Uri.file('/proyecto/src/app.ts');
		const { parts } = formatFilePathWithParts(uri, { useFullPath: true });
		assert.deepStrictEqual(parts, [uri.fsPath]);
	});
});
