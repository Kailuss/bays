import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFontDecls, fontFaceBlock, fontMimeType } from '../utils/themeFonts';

// `format`, `weight` y `style` acaban dentro de un bloque <style> del <head>.
// Un valor que lleve `</style>` cierra el elemento y lo que venga detras se
// parsea como markup.

const decl = (font: unknown) => parseFontDecls([font])[0];

test('una fuente bien declarada sobrevive entera', () => {
  const f = decl({ id: 'seti', src: [{ path: './seti.woff', format: 'woff' }], weight: 'normal', style: 'normal' });
  assert.deepEqual(f, { id: 'seti', src: './seti.woff', format: 'woff', weight: 'normal', style: 'normal' });
});

test('un formato que no esta en la lista blanca cae a woff', () => {
  assert.equal(decl({ id: 'x', src: [{ path: 'a.woff', format: 'woff");}</style><b' }] }).format, 'woff');
});

test('un peso que no es un peso cae a normal', () => {
  assert.equal(decl({ id: 'x', src: [{ path: 'a.woff' }], weight: '900;}</style>' }).weight, 'normal');
  assert.equal(decl({ id: 'x', src: [{ path: 'a.woff' }], weight: '700' }).weight, '700');
});

test('un estilo que no es un estilo cae a normal', () => {
  assert.equal(decl({ id: 'x', src: [{ path: 'a.woff' }], style: 'italic;' }).style, 'normal');
  assert.equal(decl({ id: 'x', src: [{ path: 'a.woff' }], style: 'italic' }).style, 'italic');
});

test('una fuente sin src utilizable se DESCARTA, no se queda con la ruta vacia', () => {
  assert.deepEqual(parseFontDecls([{ id: 'x' }, { id: 'y', src: [] }, { id: 'z', src: [{}] }]), []);
});

test('se toma el primer src que declara una ruta', () => {
  const f = decl({ id: 'x', src: [{ format: 'woff2' }, { path: 'b.woff', format: 'woff' }] });
  assert.equal(f.src, 'b.woff');
});

test('lo que no es un array de fuentes no es ninguna fuente', () => {
  assert.deepEqual(parseFontDecls(undefined), []);
  assert.deepEqual(parseFontDecls({}), []);
  assert.deepEqual(parseFontDecls('seti'), []);
});

test('una entrada que no es un objeto se salta', () => {
  assert.deepEqual(parseFontDecls([null, 'x', 3]), []);
});

test('fontMimeType por extension, con woff de reserva', () => {
  assert.equal(fontMimeType('/a/b.woff2'), 'font/woff2');
  assert.equal(fontMimeType('/a/b.TTF'), 'font/ttf');
  assert.equal(fontMimeType('/a/sin-extension'), 'font/woff');
});

test('el bloque @font-face lleva lo que la fuente declara', () => {
  const f = decl({ id: 'seti', src: [{ path: 'a.woff', format: 'woff2' }], weight: 'bold', style: 'italic' });
  const css = fontFaceBlock('bays-icon-seti', 'data:font/woff2;base64,AA', f);
  assert.match(css, /font-family:"bays-icon-seti"/);
  assert.match(css, /format\("woff2"\)/);
  assert.match(css, /font-weight:bold/);
  assert.match(css, /font-style:italic/);
});
