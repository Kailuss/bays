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

/* Bay Base Layout */
.bay {
  display: flex;
  align-items: center;
  height: 39px;
  padding: 0 8px 0 4px;
  border-left: 4px solid transparent;
  border-bottom: 1px solid rgba(128,128,128,0.35);
  cursor: pointer;
  position: relative;
}

.bay.compact {
  height: 29px;
}

/* Bay Icon Wrapper */
.bay-icon-wrapper {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: 8px;
}

.bay-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  display: block;
}

/* Variant Icons (smaller) */
.variant .bay-icon-wrapper {
  width: 14px;
  height: 14px;
}

.variant .bay-icon {
  width: 14px;
  height: 14px;
}

.codicon {
  width: 16px;
  height: 16px;
}

/* Bay Text Layout */
.bay-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  line-height: 1.3;
  overflow: hidden;
}

.bay-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
}

/* Bay State Indicator */
.bay-state {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  font-size: 14px;
}

.bay:hover .bay-state {
  display: none;
}

.bay-state.clean {
  visibility: hidden;
}

/* Action Buttons */
.bay-actions {
  flex: 0 0 auto;
  display: none;
  align-items: center;
  gap: 3px;
}

.bay:hover .bay-actions {
  display: flex;
}

.bay-actions button {
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  line-height: 1;
  transition: background 150ms ease;
}

/* Group Headers */
.group-header {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.6;
  border-bottom: 1px solid rgba(128,128,128,0.25);
}

/* Body Base */
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
