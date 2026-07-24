/**
 * Renderizador de iconos para tabs del webview.
 * Soporta iconos basados en fuente (Seti), base64, codicons y SVG.
 */

import * as vscode from 'vscode';
import { TabIconManager } from '../../services/ui/BayIconManager';
import { Bay } from '../../models/Bay';
import { resolveBuiltInCodicon } from '../../utils/builtinIcons';
import { DEFAULT_FILE_ICON, parseFontIconMarker, iconFontFamily } from '../../utils/iconMarkers';
import { Logger } from '../../utils/logger';
import { IconData } from './types';

export class IconRenderer {
  constructor(
    private readonly iconManager: TabIconManager,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /**
   * Render inmediato y SÍNCRONO para el primer pintado: usa solo la caché.
   * Si el icono está cacheado, lo devuelve resuelto; si no, devuelve un
   * placeholder y marca la bay como pendiente para resolverla en paralelo
   * después (ver BaysHtmlBuilder.pendingIcons / provider.patchIcons).
   */
  renderImmediate(bay: Bay): { html: string; pending: { fileName: string; languageId?: string } | null } {
    const { bayType: tabType, viewType, label, fileExtension: fileType } = bay.metadata;

    if (tabType === 'webview') {
      return { html: this.renderCodicon(resolveBuiltInCodicon(label, viewType), '#d4d7d6'), pending: null };
    }

    const fileName = this.resolveFileName(bay);
    if (!fileName) {
      return { html: this.renderFallback(fileType), pending: null };
    }

    const cached = this.iconManager.getCachedIcon(fileName);
    if (cached) {
      return { html: this.renderIconData(this.parseIconString(cached)), pending: null };
    }

    // Cache miss → placeholder ahora, resolución diferida en paralelo
    return {
      html: this.renderFallback(fileType),
      pending: { fileName, languageId: bay.metadata.languageId },
    };
  }

  /**
   * Resolución asíncrona de un icono por nombre de archivo, para el parche
   * diferido tras el primer pintado. Devuelve el HTML del icono ya resuelto.
   */
  async renderByFileName(fileName: string, languageId?: string): Promise<string> {
    try {
      const cached = this.iconManager.getCachedIcon(fileName);
      if (cached) {
        return this.renderIconData(this.parseIconString(cached));
      }
      const data = await this.iconManager.getFileIconAsBase64(fileName, this.context, languageId);
      if (data) {
        return this.renderIconData(this.parseIconString(data));
      }
    } catch (error) {
      Logger.error(`[Bays] Deferred icon resolution failed for ${fileName}`, error);
    }
    return this.renderFallback();
  }

  /**
   * Resuelve el nombre del archivo desde la bay.
   */
  private resolveFileName(bay: Bay): string | null {
    const { bayType: tabType, uri, label, sourceBayId: parentId } = bay.metadata;

    // Variants have parentId set
    if (parentId && uri) {
      return uri.path.split('/').pop() || label;
    }

    return label || null;
  }

  /**
   * Parsea el string de icono a IconData.
   */
  private parseIconString(data: string): IconData {
    if (data === DEFAULT_FILE_ICON) {
      return { type: 'fallback' };
    }

    // Marcador de icono basado en fuente: "font-icon:\E05F:#cccccc:seti:"
    const font = parseFontIconMarker(data);
    if (font) {
      return {
        type       : 'font',
        hexCode    : font.hexCode,
        color      : font.color,
        // Sin fontId no hay @font-face al que apuntar: el glyph se pintaría con
        // la fuente de la UI (un cuadro vacío). Mejor caer al SVG genérico.
        fontFamily : font.fontId ? iconFontFamily(font.fontId) : undefined,
        fontSize   : font.fontSize || undefined,
      };
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
      case 'font': {
        // Sin font-family el codepoint se pintaría con la fuente de la UI.
        if (!icon.fontFamily) { return this.renderFallback(); }
        // El `size` que declara el tema es relativo a SU contenedor (seti usa
        // 150%); aquí la caja del icono es fija (16px vía .seti-icon), así que
        // solo se aplica el fontSize de la definición concreta si lo trae.
        const size = icon.fontSize ? `font-size: ${icon.fontSize};` : '';
        return `<span class="seti-icon" style="font-family: '${icon.fontFamily}'; color: ${icon.color};${size}">&#x${icon.hexCode};</span>`;
      }

      case 'base64':
        return `<img src="${icon.data}" alt="" />`;

      case 'codicon':
        return this.renderCodicon(icon.name, icon.color);

      case 'svg':
        return icon.content;

      case 'fallback':
        return this.renderFallback();

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
