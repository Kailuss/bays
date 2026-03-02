/**
 * Constructor de estilos CSS para el webview.
 * Genera CSS crítico inline y gestiona la carga de fuentes.
 *
 * Solo genera los estilos que requieren la URI del webview (fuente seti),
 * el resto de los estilos vive en los archivos CSS estáticos en src/styles/.
 */

import * as vscode from 'vscode';
import { SETI_ICON_SIZE } from './types';

export class StylesBuilder {
  // Note: Seti font removed - VS Code provides file icons through its API

  /**
   * Genera CSS crítico inline para prevenir FOUC (Flash of Unstyled Content).
   * Incluye estilos mínimos para iconos y layout básico que se aplican inmediatamente.
   */
  buildCriticalCSS(): string {
    return `
/* Critical CSS to prevent FOUC */
.bay-icon-wrapper {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.bay-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  display: block;
}
.variant .bay-icon-wrapper {
  width: 14px;
  height: 14px;
}
.variant .bay-icon {
  width: 14px;
  height: 14px;
}
.codicon {
  width: auto;
  height: auto;
}
body {
  margin: 0;
  padding: 0;
  overflow-x: hidden;
  opacity: 0;
  transition: opacity 1250ms ease-in-out;
  transition-delay: 1500ms;
}
body.loaded {
  opacity: 1;
}
`.trim();
  }

  /**
   * Genera la Content Security Policy para el webview.
   */
  buildCSP(webview: vscode.Webview, nonce: string): string {
    return `
  default-src 'none';
  style-src ${webview.cspSource} 'unsafe-inline';
  font-src ${webview.cspSource};
  img-src ${webview.cspSource} data:;
  script-src 'nonce-${nonce}';
`.trim();
  }
}
