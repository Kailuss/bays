/**
 * Constructor de estilos CSS para el webview.
 * Genera CSS crítico inline y gestiona la carga de fuentes.
 *
 * Solo genera los estilos que requieren la URI del webview (fuente seti),
 * el resto de los estilos vive en los archivos CSS estáticos en src/styles/.
 */

import * as vscode from 'vscode';

export class StylesBuilder {

  /**
   * Genera CSS crítico inline para prevenir FOUC (Flash of Unstyled Content).
   * Incluye estilos mínimos para iconos, layout y action buttons que se aplican inmediatamente.
   */
  buildCriticalCSS(): string {
    return `
/* Critical CSS to prevent FOUC */

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
