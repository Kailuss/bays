import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPathParts, PATH_SEPARATOR } from '../utils/pathParts';

// El caso que rompia el truncado: sin carpeta de workspace, `asRelativePath`
// devuelve el fsPath crudo, que en Windows va con '\'. Partir solo por '/'
// dejaba un unico trozo que el pop() se comia entero, y la fila de ruta
// desaparecia de TODAS las bays.

const posix = { relativePath: 'src/services/app.ts', fsPath: '/proyecto/src/services/app.ts' };
const WIN_PATH = ['C:', 'proyecto', 'src', 'app.ts'].join('\\');
const win   = { relativePath: WIN_PATH, fsPath: WIN_PATH };

test('parte por / y quita el nombre del fichero por defecto', () => {
  assert.deepEqual(splitPathParts(posix).parts, ['src', 'services']);
});

test('parte tambien por barra invertida (ruta cruda de Windows)', () => {
  assert.deepEqual(splitPathParts(win).parts, ['C:', 'proyecto', 'src']);
});

test('includeFileName deja el nombre como ultima parte', () => {
  const { parts } = splitPathParts(posix, { includeFileName: true });
  assert.equal(parts[parts.length - 1], 'app.ts');
});

test('formatted une las partes con el separador', () => {
  const { formatted, parts } = splitPathParts(posix);
  assert.equal(formatted, parts.join(PATH_SEPARATOR));
});

test('un fichero en la raiz no deja fila de ruta', () => {
  assert.deepEqual(
    splitPathParts({ relativePath: 'app.ts', fsPath: '/p/app.ts' }),
    { formatted: '', parts: [] },
  );
});

test('los trozos vacios se filtran (barras dobles, barra final)', () => {
  assert.deepEqual(
    splitPathParts({ relativePath: 'src//deep//app.ts', fsPath: '' }).parts,
    ['src', 'deep'],
  );
});

test('useFullPath devuelve el fsPath crudo como una sola parte', () => {
  assert.deepEqual(splitPathParts(posix, { useFullPath: true }).parts, [posix.fsPath]);
});

test('useFullPath gana sobre useWorkspaceRelative', () => {
  const { formatted } = splitPathParts(posix, { useFullPath: true, useWorkspaceRelative: true });
  assert.equal(formatted, posix.fsPath);
});

test('sin relativo: solo el directorio padre', () => {
  const { parts } = splitPathParts(posix, { useWorkspaceRelative: false });
  assert.deepEqual(parts, ['services']);
});

test('un separador propio se respeta', () => {
  assert.equal(splitPathParts(posix, { separator: ' / ' }).formatted, 'src / services');
});
