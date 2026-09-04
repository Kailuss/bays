import { defineConfig } from '@vscode/test-cli';

// La suite de INTEGRACIÓN: lo que solo se puede afirmar dentro de un VS Code de
// verdad (las clases de `TabInput*`, la activación de la extensión). Lo que es
// una regla pura vive en `src/test/` y lo corre `node --test` en milisegundos,
// sin descargar ni lanzar nada.
export default defineConfig({
	files: 'out/test-integration/**/*.test.js',
});
