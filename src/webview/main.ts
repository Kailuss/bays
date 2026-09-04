// Entry point del cliente del webview.
// esbuild lo bundlea (IIFE) a dist/webview/main.js — un único <script> en el
// HTML del webview. El grafo de imports sustituye al antiguo orden de
// <script> tags y a los globals compartidos entre ficheros.

import { vscode } from './vscodeApi';
import type { ReadyMessage } from '../shared/protocol';
import { initInteractions } from './interactions';
import { initPathTruncation } from './pathTruncation';
import { initTooltips } from './tooltip';
import { initScrollbar } from './scrollbar';

// PRIMERA sentencia, antes de montar nada: un mensaje enviado a un webview que
// todavía no ha registrado su listener se PIERDE, así que el host no pinta hasta
// oír esto. No se pierde nada por adelantarlo: un mensaje se entrega como tarea
// NUEVA, y todo lo que va detrás registra su listener dentro de esta misma.
vscode.postMessage({ type: 'ready' } satisfies ReadyMessage);

initInteractions();
initPathTruncation();
initTooltips();
initScrollbar();

// Drag & drop ya NO se arma aquí: con el shell congelado el ajuste puede moverse
// sin que el documento se reconstruya, así que lo arma `interactions.ts` la
// primera vez que un `render` llega con el ajuste encendido.
