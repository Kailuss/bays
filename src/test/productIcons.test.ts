import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productIconRules, PRODUCT_FONT_PREFIX } from '../utils/productIcons';
import type { FontDecl } from '../utils/themeFonts';

// El id de un codicon va a un SELECTOR de clase y el codepoint a un `content`.
// Los dos salen del JSON de un pack de TERCEROS: una definicion que no encaje se
// DESCARTA y nunca se adivina, porque lo que cuesta un icono descartado es el
// codicon que la extension trae.

const font = (id: string): FontDecl =>
  ({ id, src: 'a.woff', format: 'woff', weight: 'normal', style: 'normal' });

const FONTS = [font('seti')];

// Un tema escribe el codepoint como "\E001" en su JSON, que al parsearse queda
// como una barra y el hexadecimal. Se compone aqui para que ninguna capa de
// escapado intermedia pueda comerse la barra sin que el test lo note.
const B = String.fromCharCode(92);
const cp = (hex: string) => B + hex;

test('una definicion valida da su regla', () => {
  const css = productIconRules({ 'chevron-down': { fontCharacter: cp('E001') } }, FONTS);
  assert.equal(css, `.codicon-chevron-down::before{content:"${cp('E001')}";font-family:"${PRODUCT_FONT_PREFIX}seti"}`);
});

test('un id que no es un id de codicon se descarta', () => {
  assert.equal(productIconRules({ 'a}b{': { fontCharacter: cp('E001') } }, FONTS), '');
  assert.equal(productIconRules({ 'Mayus': { fontCharacter: cp('E001') } }, FONTS), '');
});

test('un codepoint que no es un escape CSS se descarta', () => {
  assert.equal(productIconRules({ x: { fontCharacter: 'E001' } }, FONTS), '');
  assert.equal(productIconRules({ x: { fontCharacter: cp('E001') + '";}body{display:none' } }, FONTS), '');
  assert.equal(productIconRules({ x: { fontCharacter: 3 } }, FONTS), '');
});

test('un fontId desconocido cae en la PRIMERA fuente en vez de descartar el icono', () => {
  // El codepoint sigue siendo de este tema, y un pack que tecleo mal un id es
  // mas probable que tenga una sola fuente a que quisiera decir otra.
  const css = productIconRules({ x: { fontCharacter: cp('E1'), fontId: 'noexiste' } }, FONTS);
  assert.match(css, new RegExp(`${PRODUCT_FONT_PREFIX}seti`));
});

test('un fontId conocido se respeta', () => {
  const css = productIconRules({ x: { fontCharacter: cp('E1'), fontId: 'otra' } }, [font('seti'), font('otra')]);
  assert.match(css, new RegExp(`${PRODUCT_FONT_PREFIX}otra`));
});

test('el id de la fuente se sanea al componer la familia', () => {
  const css = productIconRules({ x: { fontCharacter: cp('E1') } }, [font('se ti"x')]);
  assert.match(css, new RegExp(`${PRODUCT_FONT_PREFIX}setix`));
  assert.ok(!css.includes('se ti'));
});

test('sin fuentes no hay reglas: una regla sin @font-face pinta una caja vacia', () => {
  assert.equal(productIconRules({ x: { fontCharacter: cp('E1') } }, []), '');
});

test('lo que no es un mapa de definiciones no da nada', () => {
  assert.equal(productIconRules(undefined, FONTS), '');
  assert.equal(productIconRules([1, 2], FONTS), '');
  assert.equal(productIconRules('x', FONTS), '');
});

test('las definiciones validas sobreviven a las descartadas', () => {
  const css = productIconRules({
    good: { fontCharacter: cp('E1') },
    'BAD ID': { fontCharacter: cp('E2') },
    alsogood: { fontCharacter: cp('E3') },
  }, FONTS);
  assert.equal(css.split('\n').length, 2);
  assert.match(css, /codicon-good::before/);
  assert.match(css, /codicon-alsogood::before/);
});
