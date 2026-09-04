import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bayStateCode } from '../utils/stateIndicator';
import { BAY_STATES } from '../shared/bayState';

// La PRECEDENCIA es lo que se fija aqui: error > aviso > estado git > sin
// guardar > limpia. Es lo unico de este modulo que se puede romper sin que
// cambie nada visible hasta que un fichero con un error deje de decirlo.

test('un error gana a cualquier estado de git', () => {
  assert.equal(bayStateCode({ diagnosticSeverity: 0, gitStatus: 'modified', isDirty: true }), 'error');
});

test('un aviso gana a git y a sin guardar', () => {
  assert.equal(bayStateCode({ diagnosticSeverity: 1, gitStatus: 'added', isDirty: true }), 'warning');
});

test('git gana a sin guardar', () => {
  assert.equal(bayStateCode({ gitStatus: 'modified', isDirty: true }), 'modified');
});

test('sin guardar sin contexto git es dirty', () => {
  assert.equal(bayStateCode({ isDirty: true }), 'dirty');
});

test('una fila limpia no tiene codigo', () => {
  assert.equal(bayStateCode({}), undefined);
});

test('un diagnostico de severidad menor no marca nada', () => {
  // 2 = Information, 3 = Hint: no pintan estado.
  assert.equal(bayStateCode({ diagnosticSeverity: 2 }), undefined);
});

test('los seis estados de git tienen su codigo', () => {
  for (const status of ['modified', 'added', 'deleted', 'untracked', 'ignored', 'conflict'] as const) {
    assert.equal(bayStateCode({ gitStatus: status }), status);
  }
});

// La tabla de presentacion vive aparte de la precedencia, y los dos tienen que
// cubrir el mismo conjunto: un codigo sin entrada se dibujaria sin glifo.
test('todo codigo que la regla puede devolver tiene como dibujarse', () => {
  const codes = [
    bayStateCode({ diagnosticSeverity: 0 }), bayStateCode({ diagnosticSeverity: 1 }),
    bayStateCode({ gitStatus: 'modified' }), bayStateCode({ gitStatus: 'added' }),
    bayStateCode({ gitStatus: 'deleted' }), bayStateCode({ gitStatus: 'untracked' }),
    bayStateCode({ gitStatus: 'ignored' }), bayStateCode({ gitStatus: 'conflict' }),
    bayStateCode({ isDirty: true }),
  ];
  for (const code of codes) {
    assert.ok(code && BAY_STATES[code], `sin entrada para ${code}`);
  }
  assert.equal(Object.keys(BAY_STATES).length, codes.length);
});

test('untracked se dibuja como anadido pero se NOMBRA distinto', () => {
  assert.equal(BAY_STATES.untracked.icon, BAY_STATES.added.icon);
  assert.notEqual(BAY_STATES.untracked.nameClass, BAY_STATES.added.nameClass);
});

test('dirty tine el nombre como modificado', () => {
  assert.equal(BAY_STATES.dirty.nameClass, 'modified');
});
