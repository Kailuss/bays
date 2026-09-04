import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRender, itemsToPaint, EMPTY_KEY } from '../utils/renderPlan';

// La distincion que importa es `keep` contra `replace`. Un bloque que se DEJA en
// paz conserva su foco, su clase de plegado y cualquier animacion en curso, y
// esa es toda la ganancia de reconciliar en vez de reconstruir: un plan que
// devolviera `replace` de mas seguiria pintando bien y perderia justo eso, sin
// que nada lo reportara.

const painted = (entries: [string, string][]) => new Map(entries);
const item = (key: string, signature: string) => ({ key, signature });

test('nada pintado: todo se inserta', () => {
  const plan = planRender(painted([]), [item('a', 'A')]);
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.actions, [{ key: 'a', op: 'insert' }]);
});

test('la misma firma NO se toca', () => {
  const plan = planRender(painted([['a', 'A']]), [item('a', 'A')]);
  assert.deepEqual(plan.actions, [{ key: 'a', op: 'keep' }]);
});

test('la misma clave con otra firma se sustituye', () => {
  const plan = planRender(painted([['a', 'A']]), [item('a', 'B')]);
  assert.deepEqual(plan.actions, [{ key: 'a', op: 'replace' }]);
});

test('lo que la lista nueva no lleva se quita', () => {
  const plan = planRender(painted([['a', 'A'], ['b', 'B']]), [item('a', 'A')]);
  assert.deepEqual(plan.remove, ['b']);
});

test('reordenar no sustituye nada: las claves son las mismas', () => {
  const now = painted([['a', 'A'], ['b', 'B']]);
  const plan = planRender(now, [item('b', 'B'), item('a', 'A')]);
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.actions.map(x => x.op), ['keep', 'keep']);
  // El ORDEN del plan es el de la lista nueva: es lo que el paseo por el DOM usa
  // para colocar, y sin el una reordenacion no se veria.
  assert.deepEqual(plan.actions.map(x => x.key), ['b', 'a']);
});

test('un reporte de git que no mueve nada no toca el DOM', () => {
  const now = painted([['group:1', 'G'], ['bay:x', 'X'], ['bay:y', 'Y']]);
  const plan = planRender(now, [item('group:1', 'G'), item('bay:x', 'X'), item('bay:y', 'Y')]);
  assert.deepEqual(plan.remove, []);
  assert.ok(plan.actions.every(a => a.op === 'keep'));
});

test('cerrar una bay deja intactas a sus vecinas', () => {
  const now = painted([['bay:x', 'X'], ['bay:y', 'Y'], ['bay:z', 'Z']]);
  const plan = planRender(now, [item('bay:x', 'X'), item('bay:z', 'Z')]);
  assert.deepEqual(plan.remove, ['bay:y']);
  assert.ok(plan.actions.every(a => a.op === 'keep'));
});

test('una lista vacia se pinta con el bloque de vacio, que tiene clave propia', () => {
  assert.deepEqual(itemsToPaint([]), [{ key: EMPTY_KEY, signature: EMPTY_KEY }]);
});

test('y ese bloque SALE por el mismo camino cuando vuelve a haber filas', () => {
  const now = painted([[EMPTY_KEY, EMPTY_KEY]]);
  const plan = planRender(now, itemsToPaint([item('bay:x', 'X')]));
  assert.deepEqual(plan.remove, [EMPTY_KEY]);
  assert.deepEqual(plan.actions, [{ key: 'bay:x', op: 'insert' }]);
});

test('con filas, itemsToPaint no anade nada', () => {
  const list = [item('bay:x', 'X')];
  assert.deepEqual(itemsToPaint(list), list);
});
