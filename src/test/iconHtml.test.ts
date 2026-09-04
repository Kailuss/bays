import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconMarkerToHtml, codiconHtml, FALLBACK_FILE_SVG } from '../utils/iconHtml';
import { buildFontIconMarker, DEFAULT_FILE_ICON } from '../utils/iconMarkers';

// Este HTML acaba en un innerHTML del cliente y los valores que interpola salen
// del JSON de un tema de TERCEROS. La CSP bloquea el script, no la deformacion
// de la pagina: lo que impide que un tema roto inyecte un atributo es que cada
// valor se compara con su lista blanca y cae al repliegue cuando no encaja.

// El tema escribe el codepoint como "\E001" en su JSON, que al parsearse queda
// como `\E001`. La barra la quita `parseFontIconMarker`, no este lado.
const CODEPOINT = String.fromCharCode(92) + 'E001';
const SETI = buildFontIconMarker(CODEPOINT, '#cccccc', 'seti', '150%');

test('un marcador de fuente valido sale con su familia, color y tamano', () => {
  const html = iconMarkerToHtml(SETI);
  assert.match(html, /font-family: 'bays-icon-seti'/);
  assert.match(html, /color: #cccccc/);
  assert.match(html, /font-size: 150%/);
  assert.match(html, /&#xE001;/);
});

test('un color que no es un color no llega al atributo style', () => {
  const html = iconMarkerToHtml(buildFontIconMarker(CODEPOINT, 'red;}</style><x', 'seti', ''));
  assert.ok(!html.includes('</style>'));
  assert.match(html, /color: #cccccc/);
});

test('un tamano que no es un tamano se descarta entero', () => {
  const html = iconMarkerToHtml(buildFontIconMarker(CODEPOINT, '#fff', 'seti', '99px" onload="x'));
  assert.ok(!html.includes('onload'));
  assert.ok(!html.includes('font-size'));
});

test('un codepoint que no es hexadecimal cae al SVG generico', () => {
  assert.equal(iconMarkerToHtml(buildFontIconMarker('zz;<img', '#fff', 'seti', '')), FALLBACK_FILE_SVG);
});

test('sin fontId no hay @font-face al que apuntar: cae al SVG generico', () => {
  assert.equal(iconMarkerToHtml(buildFontIconMarker(CODEPOINT, '#fff', '', '')), FALLBACK_FILE_SVG);
});

test('el fontId se sanea al componer la familia', () => {
  const html = iconMarkerToHtml(buildFontIconMarker(CODEPOINT, '#fff', 'se ti\'x', ''));
  assert.match(html, /font-family: 'bays-icon-setix'/);
});

test('una data URI de imagen en base64 sale como img', () => {
  const uri = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
  assert.equal(iconMarkerToHtml(uri), `<img src="${uri}" alt="" />`);
});

test('una data URI que no es una imagen en base64 no se dibuja', () => {
  assert.equal(iconMarkerToHtml('data:text/html;base64,PHNjcmlwdD4='), FALLBACK_FILE_SVG);
  assert.equal(iconMarkerToHtml('data:image/svg+xml,<svg onload=x>'), FALLBACK_FILE_SVG);
});

test('el marcador por defecto es el SVG generico', () => {
  assert.equal(iconMarkerToHtml(DEFAULT_FILE_ICON), FALLBACK_FILE_SVG);
});

test('cualquier otra cosa cae al SVG generico en vez de dibujarse', () => {
  assert.equal(iconMarkerToHtml('javascript:alert(1)'), FALLBACK_FILE_SVG);
  assert.equal(iconMarkerToHtml(''), FALLBACK_FILE_SVG);
});

test('codiconHtml solo escribe un color que lo sea', () => {
  assert.equal(codiconHtml('error', '#fff'), '<span class="codicon codicon-error" style="color: #fff;"></span>');
  assert.equal(codiconHtml('error', 'x;}</style>'), '<span class="codicon codicon-error"></span>');
  assert.equal(codiconHtml('error'), '<span class="codicon codicon-error"></span>');
});
