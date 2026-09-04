import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asRecord, asString, iconIdEntries, iconDefinition, iconDefinitionIds } from '../utils/iconTheme';

// El JSON de un tema de iconos es de una extension de terceros: no hay tipo que
// lo describa. Lo que estos narradores compran es que un valor de otra forma se
// DESCARTE en vez de castearse: `value as string` metia `[object Object]` en el
// mapa de iconos, y eso no falla de forma ruidosa — ese tipo de fichero
// sencillamente no encuentra su icono nunca.

test('asRecord solo deja pasar un objeto plano', () => {
  assert.deepEqual(asRecord({ a: 1 }), { a: 1 });
  assert.equal(asRecord(null), null);
  assert.equal(asRecord([1, 2]), null);
  assert.equal(asRecord('x'), null);
});

test('asString solo deja pasar una cadena', () => {
  assert.equal(asString('x'), 'x');
  assert.equal(asString(3), undefined);
  assert.equal(asString(null), undefined);
});

test('iconIdEntries baja la clave y descarta lo que no sea una cadena', () => {
  assert.deepEqual(
    iconIdEntries({ 'App.TS': '_ts', 'malo': { x: 1 }, 'otro': 3, 'bien': '_js' }),
    [['app.ts', '_ts'], ['bien', '_js']],
  );
});

test('iconIdEntries contesta vacio a lo que no es un mapa', () => {
  assert.deepEqual(iconIdEntries(undefined), []);
  assert.deepEqual(iconIdEntries([1, 2]), []);
});

test('iconDefinition devuelve solo los campos que el renderer usa, como cadenas', () => {
  const defs = { _ts: { iconPath: './ts.svg', fontCharacter: 3, extra: 'ignorado' } };
  assert.deepEqual(iconDefinition(defs, '_ts'), {
    iconPath: './ts.svg', path: undefined, fontCharacter: undefined,
    fontColor: undefined, fontId: undefined, fontSize: undefined,
  });
});

test('iconDefinition contesta null a lo que no esta o no es un objeto', () => {
  assert.equal(iconDefinition({ a: 'x' }, 'a'), null);
  assert.equal(iconDefinition({}, 'a'), null);
  assert.equal(iconDefinition(null, 'a'), null);
});

test('iconDefinitionIds lista las claves declaradas', () => {
  assert.deepEqual(iconDefinitionIds({ _file: {}, _folder: {} }), ['_file', '_folder']);
  assert.deepEqual(iconDefinitionIds('x'), []);
});
