import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHoverDelay, parseMotion, HOVER_DELAY_MS } from '../utils/settingsRules';

// Lo que se lee de la configuracion no tiene tipo: un `get` devuelve lo que haya
// escrito en el settings.json. Lo que estos casos fijan es en que DIRECCION
// falla cada regla cuando lo que entra no es utilizable.

test('un retardo valido se respeta', () => {
  assert.equal(parseHoverDelay(300), 300);
  assert.equal(parseHoverDelay(0), 0);
});

test('lo que no es un numero cae al defecto del workbench', () => {
  assert.equal(parseHoverDelay('300'), HOVER_DELAY_MS);
  assert.equal(parseHoverDelay(undefined), HOVER_DELAY_MS);
  assert.equal(parseHoverDelay(null), HOVER_DELAY_MS);
  assert.equal(parseHoverDelay(NaN), HOVER_DELAY_MS);
  assert.equal(parseHoverDelay(Infinity), HOVER_DELAY_MS);
});

test('se acota por los dos extremos: un settings.json roto no es una preferencia', () => {
  // Negativo: un tip que sale con cada pixel que cruza el puntero.
  assert.equal(parseHoverDelay(-1), 0);
  // Absurdo: un tip que no sale nunca.
  assert.equal(parseHoverDelay(999999), 5000);
});

test('un decimal se redondea: es un setTimeout', () => {
  assert.equal(parseHoverDelay(300.6), 301);
});

test('la vista se mueve por defecto', () => {
  assert.equal(parseMotion(undefined, undefined), true);
});

test('el interruptor de la vista la para', () => {
  assert.equal(parseMotion(false, 'auto'), false);
});

test('reduceMotion en `on` la para tambien', () => {
  assert.equal(parseMotion(true, 'on'), false);
});

test('solo un `on` EXPLICITO la para: `auto` se mueve', () => {
  // `auto` es el defecto del workbench, o sea casi todo el mundo. Delegar ahi en
  // el sistema pararia la vista sin que nada en pantalla dijera por que.
  assert.equal(parseMotion(true, 'auto'), true);
  assert.equal(parseMotion(true, 'off'), true);
});

test('un valor ilegible del interruptor deja la vista moviendose', () => {
  // Falla ABIERTO: lo que espera quien nunca toco el ajuste es que se mueva.
  assert.equal(parseMotion('si', undefined), true);
  assert.equal(parseMotion(null, undefined), true);
});
