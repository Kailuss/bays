/**
 * Constructor de estilos CSS para el webview: CSS crítico inline y CSP.
 *
 * El resto de estilos vive en los archivos estáticos de src/styles/. El
 * @font-face de los temas de iconos basados en fuente lo genera BayIconManager
 * (necesita leer el fichero de fuente del tema) y lo inserta BaysHtmlBuilder.
 */

import * as vscode from 'vscode';

export class StylesBuilder {

  /**
   * Genera la Content Security Policy para el webview.
   */
  buildCSP(webview: vscode.Webview, nonce: string): string {
    return `
  default-src 'none';
  style-src ${webview.cspSource} 'unsafe-inline';
  font-src ${webview.cspSource} data:;
  img-src ${webview.cspSource} data:;
  script-src 'nonce-${nonce}';
`.trim();
  }
}
