import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiff } from '../utils/diffRules';

// Un monton de casos con ORDEN entre ellos: lo escrito en el label gana a lo
// deducido del esquema, y el patron de una edicion gana a un hash que case por
// casualidad. Ese orden es lo que se rompe sin que nadie lo note.

test('working tree por el label', () => {
  assert.equal(classifyDiff('app.ts (Working Tree)'), 'working-tree');
});

test('staged / index', () => {
  assert.equal(classifyDiff('app.ts (Index)'), 'staged');
  assert.equal(classifyDiff('app.ts (Staged)'), 'staged');
});

test('patron de edicion +X-Y', () => {
  assert.equal(classifyDiff('app.ts +12-3'), 'edit');
});

test('el patron de edicion gana a un hash que casa por casualidad', () => {
  // "abcdef1" casaria como commit; el +X-Y se pregunta antes.
  assert.equal(classifyDiff('abcdef1 +1-1'), 'edit');
});

test('hash de commit en el label', () => {
  assert.equal(classifyDiff('app.ts (1a2b3c4d)'), 'commit');
});

test('historia local', () => {
  assert.equal(classifyDiff('app.ts (Local History)'), 'snapshot');
  assert.equal(classifyDiff('app.ts (Timeline)'), 'snapshot');
});

test('una fecha o una hora en el label son un snapshot', () => {
  assert.equal(classifyDiff('app.ts 2026-01-30'), 'snapshot');
  assert.equal(classifyDiff('app.ts 14:05'), 'snapshot');
});

test('git con ref en la query es un commit', () => {
  assert.equal(
    classifyDiff('app.ts', { scheme: 'git', query: 'ref=HEAD', path: '/p/app.ts' }),
    'commit',
  );
});

test('timeline por el esquema es un snapshot', () => {
  assert.equal(
    classifyDiff('app.ts', { scheme: 'timeline', path: '/p/app.ts' }),
    'snapshot',
  );
});

test('dos snapshots de chat sin la palabra snapshot son una edicion', () => {
  const s = { scheme: 'chat-editing-snapshot-text-model', path: '/p/app.ts' };
  assert.equal(classifyDiff('app.ts', s, s), 'edit');
});

test('conflicto de merge', () => {
  assert.equal(classifyDiff('app.ts (Merge Conflict)'), 'merge-conflict');
});

test('incoming y current', () => {
  assert.equal(classifyDiff('Incoming changes'), 'incoming');
  assert.equal(classifyDiff('Current changes'), 'current');
  assert.equal(classifyDiff('Incoming and Current'), 'incoming-current');
});

test('lo que no case con nada es unknown', () => {
  assert.equal(classifyDiff('algo que no dice nada'), 'unknown');
});
