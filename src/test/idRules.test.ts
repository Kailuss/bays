import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileBayId, webviewBayId, variantBayId } from '../utils/idRules';

// El id de una bay es el contrato más delicado del proyecto: el mismo id tiene
// que poder RECONSTRUIRSE desde la tab nativa, o abrir, cerrar y sincronizar el
// activo dejan de encontrarse. Estos casos fijan ese contrato.

test('fileBayId: la uri y la columna', () => {
  assert.equal(fileBayId('file:///p/src/app.ts', 1), 'file:///p/src/app.ts-1');
});

test('fileBayId: el mismo fichero en dos grupos son dos bays', () => {
  assert.notEqual(fileBayId('file:///p/a.ts', 1), fileBayId('file:///p/a.ts', 2));
});

test('webviewBayId: se compone del viewType, no del label mutable', () => {
  const a = webviewBayId('Mi sesion de Claude', 1, 'webview', 'mainThreadWebview-claudeVSCodePanel');
  const b = webviewBayId('Otro titulo distinto', 1, 'webview', 'mainThreadWebview-claudeVSCodePanel');
  // Un retitulado en runtime (Claude Code) NO puede cambiar el id.
  assert.equal(a, b);
});

test('webviewBayId: sin viewType cae al label, saneado', () => {
  assert.equal(webviewBayId('Some: Panel!', 1, 'webview'), 'webview:some--panel--1');
});

test('webviewBayId: el tipo de bay entra en el id', () => {
  assert.notEqual(
    webviewBayId('X', 1, 'webview', 'v'),
    webviewBayId('X', 1, 'custom', 'v'),
  );
});

test('variantBayId: determinista', () => {
  assert.equal(
    variantBayId('file:///p/a.ts', 'git:/p/a.ts?ref=HEAD', 1),
    variantBayId('file:///p/a.ts', 'git:/p/a.ts?ref=HEAD', 1),
  );
});

test('variantBayId: dos diffs del mismo fichero no colisionan', () => {
  assert.notEqual(
    variantBayId('file:///p/a.ts', 'git:/p/a.ts?ref=~', 1),
    variantBayId('file:///p/a.ts', 'git:/p/a.ts?ref=HEAD', 1),
  );
});

test('variantBayId: sin original sigue llevando el prefijo y la columna', () => {
  const id = variantBayId('file:///p/a.ts', undefined, 2);
  assert.ok(id.startsWith('diff:'));
  assert.ok(id.endsWith('-2'));
});

test('un id de variante nunca puede coincidir con uno de fichero', () => {
  assert.notEqual(variantBayId('file:///p/a.ts', undefined, 1), fileBayId('file:///p/a.ts', 1));
});
