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
   * La Content Security Policy del webview.
   *
   * `base-uri` y `form-action` se declaran a mano porque NO heredan de
   * `default-src`: sin ellas quedan sin restringir, y lo que la CSP protege aquí
   * es un documento en el que se interpolan valores de un tema de iconos ajeno.
   *
   * `style-src` admite `unsafe-inline` porque el `@font-face` de los temas
   * basados en fuente se incrusta como un `<style>` (la fuente vive fuera de
   * `localResourceRoots`, así que no hay url desde la que pedirla) y porque cada
   * icono de fuente lleva su color en un atributo `style`. Lo que impide que eso
   * sea una puerta es que los valores pasan por `utils/iconHtml.ts` y
   * `utils/themeFonts.ts` antes de llegar aquí.
   */
  buildCSP(webview: vscode.Webview, nonce: string): string {
    return `
  default-src 'none';
  base-uri 'none';
  form-action 'none';
  style-src ${webview.cspSource} 'unsafe-inline';
  font-src ${webview.cspSource} data:;
  img-src ${webview.cspSource} data:;
  script-src 'nonce-${nonce}';
`.trim();
  }
}
