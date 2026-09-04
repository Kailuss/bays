import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeAge } from '../utils/relativeAge';

const NOW = 1_700_000_000_000;
const ago = (ms: number) => relativeAge(NOW - ms, NOW);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR   = 60 * MINUTE;
const DAY    = 24 * HOUR;

test('menos de un minuto es "just now"', () => {
  assert.equal(ago(0), 'just now');
  assert.equal(ago(59 * SECOND), 'just now');
});

test('cada escalon va al SUELO', () => {
  assert.equal(ago(MINUTE), '1m ago');
  assert.equal(ago(119 * SECOND), '1m ago');
  assert.equal(ago(90 * MINUTE), '1h ago');
  assert.equal(ago(47 * HOUR), '1d ago');
});

test('los tres saltos caen donde toca', () => {
  assert.equal(ago(60 * SECOND), '1m ago');
  assert.equal(ago(60 * MINUTE), '1h ago');
  assert.equal(ago(24 * HOUR), '1d ago');
});

test('un sello en el FUTURO no da una distancia negativa', () => {
  assert.equal(relativeAge(NOW + 5 * MINUTE, NOW), 'just now');
});

test('dias grandes siguen contandose en dias', () => {
  assert.equal(ago(400 * DAY), '400d ago');
});
