// Entry point del cliente del webview.
// esbuild lo bundlea (IIFE) a dist/webview/main.js — un único <script> en el
// HTML del webview. El grafo de imports sustituye al antiguo orden de
// <script> tags y a los globals compartidos entre ficheros.

import { initInteractions } from './interactions';
import { initPathTruncation } from './pathTruncation';
import { initDragDrop } from './dragdrop';

initInteractions();
initPathTruncation();

// El host publica la config en el body: drag & drop solo si está habilitado.
if (document.body.dataset.enableDragdrop === 'true') {
  initDragDrop();
}
