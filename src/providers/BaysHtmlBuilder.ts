/**
 * Compone lo que la vista DICE, y nada de cómo se dibuja.
 *
 * Arquitectura:
 *  - el SHELL (`buildShell`) se asigna una vez y no se vuelve a tocar;
 *  - la LISTA (`buildSections`) viaja como datos, y el markup lo construye el
 *    cliente (`webview/rows.ts`);
 *  - los ICONOS son la excepción y viajan como HTML, deduplicados por clave en
 *    `IconKeyRegistry`: un marcador de tema es un `data:` URI de kilobytes.
 */

import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { BayIconManager } from '../services/ui/BayIconManager';
import { Bay } from '../models/Bay';
import { getGroupLabel } from '../models/BayGroup';
import { FileActionRegistry } from '../services/registry/FileActionRegistry';
import { bayStateCode } from '../utils/stateIndicator';
import { getDiffTypeDisplay } from '../constants/diffTypes';
import { relativeAge } from '../utils/relativeAge';
import { ICONS } from '../shared/icons';
import { IconRenderer, StylesBuilder, IconKeyRegistry, BuildSectionsOptions, WebviewResourceUris, PendingIcon, PendingIconRequest, BuildSectionsResult } from './html';
import type { BayView, GroupSection, QuickActionView, VariantView } from '../shared/protocol';

export class BaysHtmlBuilder {
  private readonly iconRenderer: IconRenderer;
  private readonly stylesBuilder: StylesBuilder;
  private readonly iconKeys = new IconKeyRegistry();
  // Set per-build from options; buildBay reads it to gate the hover buttons.
  // buildSections runs single-flight (debounced refresh), so a transient field is safe.
  private _enableHoverActions = true;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly iconManager: BayIconManager,
    context: vscode.ExtensionContext,
    private readonly fileActionRegistry?: FileActionRegistry,
  ) {
    this.iconRenderer = new IconRenderer(this.iconManager, context);
    this.stylesBuilder = new StylesBuilder();
  }

  //= EL SHELL, QUE SE ASIGNA UNA VEZ

  /**
   * El documento del webview: la CSP, las hojas, el script y el contenedor
   * vacío. Se asigna UNA vez, en `resolveWebviewView`, y no se vuelve a tocar.
   *
   * Reasignar `webview.html` destruye el documento entero y con él el scroll, el
   * foco, los grupos plegados, el bundle del cliente, el CSS y la fuente del
   * tema en base64, todo eso pagado otra vez en cada pestaña que se abriera o se
   * cerrara. Lo que cambia viaja ahora por `postMessage`.
   *
   * El `<style id="themeFont">` sale VACÍO a propósito: leer la fuente de un
   * tema es I/O de disco, y ponerla aquí dejaría el panel en blanco hasta
   * tenerla. La rellena el mensaje `themeFont`.
   */
  buildShell(webview: vscode.Webview): string {
    const uris  = this.resolveResourceUris(webview);
    const nonce = this.generateNonce();
    const csp   = this.stylesBuilder.buildCSP(webview, nonce);

    // El cliente no alcanza `vscode.l10n`, así que el bundle cargado se inyecta
    // aquí: síncrono, con nonce y ANTES de `main.js`. Sus etiquetas viven en
    // tablas de nivel de módulo que se leen al importar, y un bundle que llegara
    // por mensaje llegaría tarde a todas ellas.
    //
    // El `<` se escapa para que una traducción no pueda cerrar el `<script>`.
    const bundle = JSON.stringify(vscode.l10n.bundle ?? {}).replace(/</g, '\u003c');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link href="${uris.codiconCss}" rel="stylesheet" />
<link href="${uris.webviewCss}" rel="stylesheet" />
<style id="themeFont"></style>
<!-- ULTIMO a proposito: las reglas de un pack de iconos de producto empatan en
     especificidad con las de codicon.css, asi que gana la escrita mas tarde. Es
     lo que hace que un id del que el pack no diga nada se quede con el codicon
     que la extension trae. Movido por encima, el pack se apaga en silencio. -->
<style id="productIcons"></style>
</head>
<body data-enable-dragdrop="false">
  <div id="bays"></div>
  <script nonce="${nonce}">window.__l10n = ${bundle};</script>
  <script nonce="${nonce}" src="${uris.webviewScript}"></script>
</body>
</html>`;
  }

  //= LA LISTA, QUE VIAJA COMO DATOS

  /**
   * Qué dice la lista ahora mismo.
   *
   * El render es SÍNCRONO: los iconos se resuelven solo desde caché para no
   * bloquear el primer pintado. Los que fallan la caché salen con un placeholder
   * y se devuelven en `pendingIcons` para resolverse en paralelo y parchearse
   * por `postMessage`.
   */
  buildSections(options: BuildSectionsOptions): BuildSectionsResult {
    const { groups, getBaysInGroup, showPath, copilotReady, enableHoverActions = true } = options;

    this._enableHoverActions = enableHoverActions;

    const pendingIcons: PendingIcon[] = [];

    // Un grupo sin filas que dibujar no se enseña. Un grupo que solo sostiene la
    // preview de un markdown ("Open Preview to the Side") tiene cero bays en el
    // estado, y su cabecera sola se lee como algo roto.
    const populated = groups
      .map(group => ({ group, bays: getBaysInGroup(group.id) }))
      .filter(({ bays }) => bays.length > 0);

    // Con un solo grupo no hay cabecera ni acento de color: no hay nada de lo
    // que distinguirlo. El bloqueo, en cambio, sí sigue en pie.
    const single = populated.length <= 1;

    const sections: GroupSection[] = populated.map(({ group, bays }) => ({
      header: single ? undefined : {
        id     : group.id,
        label  : getGroupLabel(group),
        color  : group.color,
        locked : group.isLocked,
      },
      bays: this.buildBays(bays, group.isLocked, showPath, copilotReady, pendingIcons),
    }));

    return { sections, icons: this.iconKeys.dictionary(), pendingIcons };
  }

  /**
   * El `@font-face` del tema activo. Cadena vacía en los temas SVG (la mayoría);
   * en los basados en fuente trae la fuente incrustada. El manager la cachea,
   * así que volver a pedirla no relee el fichero.
   */
  themeFontCss(): Promise<string> {
    return this.iconManager.getFontFaceCss();
  }

  /** Resuelve el HTML de un icono por nombre de archivo (parche diferido). */
  resolveIconHtml(request: PendingIconRequest): Promise<string> {
    return this.iconRenderer.resolvePending(request);
  }

  /**
   * Al cambiar el TEMA, las claves que el cliente tiene describen marcadores del
   * tema anterior. Se tiran, y el siguiente render las vuelve a acuñar.
   */
  clearIconKeys(): void {
    this.iconKeys.clear();
  }

  //= RESOLUCIÓN DE RECURSOS

  private resolveResourceUris(webview: vscode.Webview): WebviewResourceUris {
    const asUri = (segments: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...segments));

    return {
      codiconCss: asUri(['dist', 'codicons', 'codicon.css']),
      webviewCss: asUri(['dist', 'styles', 'webview.css']),
      webviewScript: asUri(['dist', 'webview', 'main.js']),
    };
  }

  //= LAS FILAS

  private buildBays(
    bays: Bay[],
    locked: boolean,
    showPath: boolean,
    copilotReady: boolean,
    pendingIcons: PendingIcon[],
  ): BayView[] {
    // Las previews de markdown son bays de verdad (variantes de su .md), así que
    // aquí no se filtra nada: se dibujan como fila hija, o sueltas cuando su
    // parent no está en esta lista.
    const parents  = bays.filter(bay => !bay.metadata.sourceBayId);
    const variants = bays.filter(bay => bay.metadata.sourceBayId);

    const childrenByParent = new Map<string, Bay[]>();
    for (const child of variants) {
      const parentId = child.metadata.sourceBayId as string;
      const list = childrenByParent.get(parentId);
      if (list) { list.push(child); } else { childrenByParent.set(parentId, [child]); }
    }

    // Las fijadas primero. `sort` es estable, así que dentro de cada mitad se
    // conserva el orden que traía la lista (el del arrastre manual).
    const sorted = [...parents].sort((a, b) =>
      Number(b.state.isPinned) - Number(a.state.isPinned));

    const views: BayView[] = sorted.map(parent => {
      const children = childrenByParent.get(parent.metadata.id) ?? [];
      return this.buildBay(parent, children, locked, showPath, copilotReady, pendingIcons);
    });

    // Variantes huérfanas: su parent no está abierto, o vive en otro grupo.
    for (const child of variants) {
      if (parents.some(parent => parent.metadata.id === child.metadata.sourceBayId)) { continue; }
      views.push(this.buildOrphan(child, locked, pendingIcons));
    }

    return views;
  }

  private buildBay(
    bay: Bay,
    children: Bay[],
    locked: boolean,
    showPath: boolean,
    copilotReady: boolean,
    pendingIcons: PendingIcon[],
  ): BayView {
    const hover = this._enableHoverActions;
    const hasPreviewVariant = children.some(child => child.metadata.diffType === 'preview');

    return {
      id        : bay.metadata.id,
      label     : bay.metadata.label,
      detail    : showPath ? bay.metadata.detailLabel : undefined,
      pathParts : showPath ? bay.metadata.pathParts : undefined,
      tooltip   : bay.metadata.tooltipText || bay.metadata.label,
      iconKey   : this.iconKeyFor(bay, pendingIcons),
      active    : bay.state.isActive,
      pinned    : bay.state.isPinned,
      groupId   : bay.state.groupId,
      state     : bayStateCode(bay.state),
      canClose  : hover && !locked && bay.state.capabilities.canClose,
      canChat   : hover && copilotReady && !!bay.metadata.uri,
      quickAction: hover && bay.state.capabilities.canTogglePreview
        ? this.quickActionFor(bay, hasPreviewVariant)
        : undefined,
      variants  : children.map(child => this.buildVariant(child, locked, false)),
    };
  }

  /**
   * Una variante suelta: sigue SIENDO una variante (misma fila compacta, mismo
   * icono y color de diff) y no una bay normal. Dibujada como aquéllas, una
   * variante recién abierta aparentaba ser un parent. Lo que cambia es que
   * escribe el label nativo, que incluye el fichero, y que no se indenta: no hay
   * parent encima del que colgar.
   */
  private buildOrphan(bay: Bay, locked: boolean, pendingIcons: PendingIcon[]): BayView {
    return {
      id       : bay.metadata.id,
      label    : bay.metadata.label,
      tooltip  : bay.metadata.tooltipText || bay.metadata.label,
      iconKey  : this.iconKeyFor(bay, pendingIcons),
      active   : bay.state.isActive,
      pinned   : false,
      groupId  : bay.state.groupId,
      canClose : false,
      canChat  : false,
      // La fila que se dibuja ES la variante: el contenedor solo la envuelve.
      variants : [this.buildVariant(bay, locked, true)],
      variantOnly: true,
    };
  }

  private buildVariant(bay: Bay, locked: boolean, orphan: boolean): VariantView {
    const diff = getDiffTypeDisplay(bay.metadata.diffType, bay.metadata.label);

    return {
      id       : bay.metadata.id,
      // Bajo su parent basta el tipo ("Working Tree"); suelta, la fila necesita
      // el label nativo para saber de qué fichero habla.
      label    : orphan ? bay.metadata.label : (diff?.label ?? 'Diff'),
      icon     : (diff?.icon ?? ICONS.variant.generic) as VariantView['icon'],
      diffClass: diff?.cssClass || undefined,
      tooltip  : bay.metadata.tooltipText || bay.metadata.label,
      active   : bay.state.isActive,
      orphan,
      canClose : this._enableHoverActions && !locked && bay.state.capabilities.canClose,
      stats    : variantStats(bay),
    };
  }

  /** La clave del icono de una bay, encolando la resolución si falla la caché. */
  private iconKeyFor(bay: Bay, pendingIcons: PendingIcon[]): string {
    const { marker, html, pending } = this.iconRenderer.resolveImmediate(bay);
    if (pending) {
      pendingIcons.push({ bayId: bay.metadata.id, ...pending });
    }
    return marker !== undefined ? this.iconKeys.keyFor(marker) : this.iconKeys.keyForHtml(html as string);
  }

  private quickActionFor(bay: Bay, hasPreviewVariant: boolean): QuickActionView | undefined {
    if (!this.fileActionRegistry || !bay.metadata.uri) { return undefined; }

    const resolved = this.fileActionRegistry.resolve(
      bay.metadata.label, bay.metadata.uri, { viewMode: bay.state.viewMode });
    if (!resolved) { return undefined; }

    // El botón de markdown CREA la variante de preview; en cuanto la bay ya
    // tiene una (la fila hija "Preview") el botón no puede hacer nada.
    if (resolved.id === 'openMarkdownPreview' && hasPreviewVariant) { return undefined; }

    return {
      actionId: resolved.id,
      icon    : resolved.icon as QuickActionView['icon'],
      tooltip : resolved.tooltip,
    };
  }

  //= UTILIDADES

  // CSPRNG: la CSP confía en el nonce para script-src, así que no puede salir
  // de Math.random() (predecible).
  private generateNonce(): string {
    return randomBytes(24).toString('base64');
  }
}

/** Lo que una variante cuenta de sí misma, o nada. */
function variantStats(bay: Bay): VariantView['stats'] {
  const stats = bay.state.diffStats;
  if (!stats) { return undefined; }

  const { linesAdded, linesRemoved, timestamp, conflictSections } = stats;

  if (linesAdded !== undefined && linesRemoved !== undefined) {
    return {
      text   : `+${linesAdded} -${linesRemoved}`,
      tooltip: `${linesAdded} lines added, ${linesRemoved} lines removed`,
    };
  }
  if (timestamp) {
    return { text: relativeAge(timestamp), tooltip: new Date(timestamp).toLocaleString() };
  }
  if (conflictSections) {
    return {
      text    : `${conflictSections} conflicts`,
      tooltip : `${conflictSections} conflict sections`,
      conflict: true,
    };
  }
  return undefined;
}
