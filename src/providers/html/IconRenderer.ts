/**
 * Renderizador de iconos para tabs del webview.
 * Soporta iconos basados en fuente (Seti), base64, codicons y SVG.
 */

import * as vscode from 'vscode';
import { TabIconManager } from '../../services/ui/BayIconManager';
import { SideTab } from '../../models/Bay';
import { resolveBuiltInCodicon } from '../../utils/builtinIcons';
import { Logger } from '../../utils/logger';
import {
  IconData,
  // VSCODE_FILE_EXTENSIONS,  // Comentado: ya no se usan iconos especiales de VS Code
  // VSCODE_FILE_PATTERNS,    // Comentado: ya no se usan iconos especiales de VS Code
} from './types';

export class IconRenderer {
  constructor(
    private readonly iconManager: TabIconManager,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /**
   * Genera el HTML del icono para una tab.
   */
  async render(tab: SideTab): Promise<string> {
    const { bayType: tabType, viewType, label, uri, fileExtension: fileType } = tab.metadata;

    // Webviews use codicons with standard color
    if (tabType === 'webview') {
      return this.renderCodicon(resolveBuiltInCodicon(label, viewType), '#d4d7d6');
    }

    const fileName = this.resolveFileName(tab);
    if (!fileName) {
      return this.renderFallback(fileType);
    }

    // Archivos de VS Code: comentado, ahora usan iconos del tema activo
    // if (this.isVSCodeFile(fileName)) {
    //   return this.renderCodicon('vscode', '#2196f3');
    // }

    // Intentar resolver icono del tema
    const iconData = await this.resolveIconData(fileName);
    if (iconData) {
      return this.renderIconData(iconData);
    }

    return this.renderFallback(fileType);
  }

  /**
   * Resuelve el nombre del archivo desde la tab.
   */
  private resolveFileName(tab: SideTab): string | null {
    const { bayType: tabType, uri, label, parentId } = tab.metadata;

    // Variants have parentId set
    if (parentId && uri) {
      return uri.path.split('/').pop() || label;
    }

    return label || null;
  }

  /**
   * Verifica si el archivo es relacionado con VS Code.
   * Comentado: ahora todos los archivos usan iconos del tema activo
   */
  /*
  private isVSCodeFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();

    // Verificar extensiones exactas
    for (const ext of VSCODE_FILE_EXTENSIONS) {
      if (lower.endsWith(ext) || lower === ext) {
        return true;
      }
    }

    // Verificar patrones
    for (const pattern of VSCODE_FILE_PATTERNS) {
      if (lower.includes(pattern)) {
        return true;
      }
    }

    return false;
  }
  */

  /**
   * Resuelve los datos del icono desde el IconManager.
   */
  private async resolveIconData(fileName: string): Promise<IconData | null> {
    try {
      // Primero intentar caché
      const cached = this.iconManager.getCachedIcon(fileName);
      if (cached) {
        return this.parseIconString(cached);
      }

      // Luego resolver desde el tema
      const iconData = await this.iconManager.getFileIconAsBase64(fileName, this.context);
      if (iconData) {
        return this.parseIconString(iconData);
      }
    } catch (error) {
      Logger.error(`[Bays] Icon resolution failed for ${fileName}`, error);
    }

    return null;
  }

  /**
   * Parsea el string de icono a IconData.
   */
  private parseIconString(data: string): IconData {
    // Marcador de icono basado en fuente: "font-icon:\E05F:#cccccc"
    if (data.startsWith('font-icon:')) {
      const parts = data.split(':');
      const charStr = parts[1] || '';
      const color = parts[2] || '#cccccc';
      const hexCode = charStr.replace(/\\/g, '');

      return { type: 'font', hexCode, color };
    }

    // Base64 data URI
    if (data.startsWith('data:')) {
      return { type: 'base64', data };
    }

    // Fallback: tratar como base64
    return { type: 'base64', data };
  }

  /**
   * Renderiza IconData a HTML.
   */
  private renderIconData(icon: IconData): string {
    switch (icon.type) {
      case 'font':
        return `<span class="seti-icon" style="color: ${icon.color}">&#x${icon.hexCode};</span>`;

      case 'base64':
        return `<img src="${icon.data}" alt="" />`;

      case 'codicon':
        return this.renderCodicon(icon.name, icon.color);

      case 'svg':
        return icon.content;

      default:
        return this.renderFallback();
    }
  }

  /**
   * Renderiza un codicon de VS Code.
   * Por defecto usa el color #d4d7d6 (gris claro).
   */
  private renderCodicon(name: string, color: string = '#d4d7d6'): string {
    const style = ` style="color: ${color};"`;
    return `<span class="codicon codicon-${name}"${style}></span>`;
  }

  /**
   * Renderiza el icono de fallback (archivo genérico).
   */
  private renderFallback(_fileType?: string): string {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M13.85 4.44l-3.29-3.3A.5.5 0 0010.21 1H3.5A1.5 1.5 0 002 2.5v11A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5V4.79a.5.5 0 00-.15-.35zM10.5 2.12L12.88 4.5H11a.5.5 0 01-.5-.5V2.12zM12.5 14h-9a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5h6v2a1.5 1.5 0 001.5 1.5h2v8a.5.5 0 01-.5.5z" fill="currentColor"/>
    </svg>`;
  }
}
