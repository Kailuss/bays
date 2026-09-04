/**
 * Renderizador de iconos para las filas del webview.
 *
 * Solo DECIDE qué icono le toca a una bay; convertirlo en HTML es de
 * `utils/iconHtml.ts`, que es el único sitio que genera markup de icono y el que
 * valida lo que viene del JSON de un tema ajeno antes de interpolarlo.
 */

import * as vscode from 'vscode';
import { BayIconManager } from '../../services/ui/BayIconManager';
import { Bay } from '../../models/Bay';
import { resolveBuiltInCodicon } from '../../utils/builtinIcons';
import {
  lookupWebviewExtensionIcon,
  resolveWebviewExtensionIconAsync,
} from '../../platform/webviewExtensionIcons';
import { codiconHtml, iconMarkerToHtml, placeholderIconHtml } from '../../utils/iconHtml';
import { IconKeyRegistry } from './IconKeyRegistry';
import { Logger } from '../../platform/logger';
import type { PendingIconRequest } from './types';

/** Color de los codicons de las tabs sin icono de tema (gris claro). */
const BUILTIN_ICON_COLOR = '#d4d7d6';

export class IconRenderer {
  constructor(
    private readonly iconManager: BayIconManager,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /**
   * Qué icono le toca a una bay, SÍNCRONO y solo desde caché.
   *
   * Devuelve un MARCADOR cuando el icono viene del tema —así el registro puede
   * deduplicar por él, que es lo que evita mandar el mismo `data:` URI de
   * kilobytes una vez por fila— y HTML ya resuelto cuando no pasa por un tema:
   * el logo de la extensión dueña de un webview, o un codicon de reserva.
   *
   * Un fallo de caché sale con el marcador de placeholder y se devuelve en
   * `pending` para resolverse en paralelo y parchearse después (ver
   * `BaysHtmlBuilder` / `provider.patchIcons`).
   */
  resolveImmediate(bay: Bay): {
    marker?: string;
    html?: string;
    pending: PendingIconRequest | null;
  } {
    const { bayType: tabType, viewType, label, uri, originalUri } = bay.metadata;

    // Los webviews de otras extensiones y las tabs empotradas sin URI (Settings,
    // «Extension: …»; `originalUri` descarta el diff defensivo sin uri) llevan el
    // logo REAL de la extensión dueña. El lookup contesta solo desde caché: con
    // una dueña candidata cuyo icono aún no se ha leído del disco se pinta el
    // codicon ahora y se difiere la lectura, que es la misma mecánica que un
    // fallo de caché del tema.
    if (tabType === 'webview' || (!uri && !originalUri)) {
      const lookup = lookupWebviewExtensionIcon(viewType, label);
      if (lookup.state === 'loaded') {
        return { html: lookup.dataUri, pending: null };
      }
      return {
        html    : codiconHtml(resolveBuiltInCodicon(label, viewType), BUILTIN_ICON_COLOR),
        pending : lookup.state === 'deferrable' ? { kind: 'webview', viewType, label } : null,
      };
    }

    const fileName = this.resolveFileName(bay);
    if (!fileName) {
      return { marker: IconKeyRegistry.PLACEHOLDER, pending: null };
    }

    const cached = this.iconManager.getCachedIcon(fileName);
    if (cached) {
      return { marker: cached, pending: null };
    }

    return {
      marker : IconKeyRegistry.PLACEHOLDER,
      pending: { kind: 'file', fileName, languageId: bay.metadata.languageId },
    };
  }

  /**
   * Resolución asíncrona de lo que falló la caché, para el parche diferido tras
   * el primer pintado. Devuelve el HTML del icono ya resuelto.
   */
  async resolvePending(request: PendingIconRequest): Promise<string> {
    if (request.kind === 'webview') {
      try {
        const dataUri = await resolveWebviewExtensionIconAsync(request.viewType, request.label);
        if (dataUri) { return dataUri; }
      } catch (error) {
        Logger.error(`[Bays] Deferred extension icon failed for ${request.label}`, error);
      }
      return codiconHtml(
        resolveBuiltInCodicon(request.label, request.viewType),
        BUILTIN_ICON_COLOR,
      );
    }

    try {
      const cached = this.iconManager.getCachedIcon(request.fileName);
      if (cached) {
        return iconMarkerToHtml(cached);
      }
      const data = await this.iconManager.getFileIconAsBase64(
        request.fileName, this.context, request.languageId,
      );
      if (data) {
        return iconMarkerToHtml(data);
      }
    } catch (error) {
      Logger.error(`[Bays] Deferred icon resolution failed for ${request.fileName}`, error);
    }
    return placeholderIconHtml();
  }

  /**
   * Resuelve el nombre del archivo desde la bay.
   */
  private resolveFileName(bay: Bay): string | null {
    const { uri, label, sourceBayId: parentId } = bay.metadata;

    // Variants have parentId set
    if (parentId && uri) {
      return uri.path.split('/').pop() || label;
    }

    return label || null;
  }
}
