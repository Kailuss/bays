/**
 * Builder encargado de generar el HTML/CSS del webview de bays.
 * Orquesta los módulos especializados para renderizado.
 *
 * Arquitectura:
 *  - IconRenderer   → renderizado de iconos (font/base64/codicon)
 *  - StylesBuilder  → CSS crítico y CSP
 *  - types.ts       → tipos compartidos
 */

import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { BayIconManager } from '../services/ui/BayIconManager';
import { Bay } from '../models/Bay';
import { BayGroup, BayGroupColor } from '../models/BayGroup';
import { FileActionRegistry } from '../services/registry/FileActionRegistry';
import { getStateIndicator } from '../utils/stateIndicator';
import { IconRenderer, StylesBuilder, BuildHtmlOptions, WebviewResourceUris, PendingIcon, BuildHtmlResult } from './html';
import { BayRowRenderer, GroupHeaderRenderer, VariantRowRenderer } from './renderers';

/**
 * Contexto de render de una lista de bays. Agrupa lo que antes viajaba como
 * parámetros posicionales, ahora que las propiedades del grupo (bloqueo y color)
 * también tienen que bajar hasta cada fila.
 */
type BayListContext = {
  showPath     : boolean;
  copilotReady : boolean;
  compactMode  : boolean;
  pendingIcons : PendingIcon[];
  /** Grupo bloqueado: ninguna fila dibuja su botón de cierre. */
  locked       : boolean;
  /** `null` con un solo grupo: el color existe, pero pintarlo no distingue nada. */
  color        : BayGroupColor | null;
};

export class BaysHtmlBuilder {
  private readonly iconRenderer: IconRenderer;
  private readonly stylesBuilder: StylesBuilder;
  // Set per-build from options; renderBay reads it to gate the hover buttons.
  // buildHtml runs single-flight (debounced refresh), so a transient field is safe.
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

  //= HTML PRINCIPAL

  /**
   * Construye el HTML completo del webview.
   *
   * El render es SÍNCRONO: los iconos se resuelven solo desde caché para no
   * bloquear el primer pintado. Los que fallan la caché se devuelven en
   * `pendingIcons` para resolverse en paralelo y parchearse por postMessage.
   */
  async buildHtml(options: BuildHtmlOptions): Promise<BuildHtmlResult> {
    const {
      webview,
      groups,
      getBaysInGroup,
      showPath,
      copilotReady,
      enableDragDrop = false,
      enableHoverActions = true,
      compactMode,
    } = options;

    this._enableHoverActions = enableHoverActions;

    const uris = this.resolveResourceUris(webview);
    const nonce = this.generateNonce();
    const pendingIcons: PendingIcon[] = [];
    const baysHtml = this.renderAllBays(groups, getBaysInGroup, showPath, copilotReady, compactMode, pendingIcons);

    // Cadena vacía en los temas SVG (la mayoría). En los basados en fuente trae
    // la fuente del tema incrustada; el manager la cachea, así que reconstruir
    // el HTML no vuelve a leer el fichero de disco.
    const fontFaceCss = await this.iconManager.getFontFaceCss();

    const html = this.assembleHtml(webview, uris, nonce, baysHtml, fontFaceCss, enableDragDrop, options.initialLoad);
    return { html, pendingIcons };
  }

  /**
   * Resuelve el HTML de un icono por nombre de archivo (parche diferido).
   */
  resolveIconHtml(fileName: string, languageId?: string): Promise<string> {
    return this.iconRenderer.renderByFileName(fileName, languageId);
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

  //= ENSAMBLAJE HTML

  private assembleHtml(
    webview: vscode.Webview,
    uris: WebviewResourceUris,
    nonce: string,
    baysHtml: string,
    fontFaceCss: string,
    enableDragDrop: boolean,
    initialLoad = false,
  ): string {
    const csp = this.stylesBuilder.buildCSP(webview, nonce);
    const bodyClass = initialLoad ? '' : 'loaded';

    // La config viaja al cliente como data-attribute del body (main.ts la lee
    // en el arranque); el bundle es único y decide en runtime qué inicializa.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
${fontFaceCss ? `<style>${fontFaceCss}</style>` : ''}
<link href="${uris.codiconCss}" rel="stylesheet" />
<link href="${uris.webviewCss}" rel="stylesheet" />
</head>
<body class="${bodyClass}" data-enable-dragdrop="${enableDragDrop}">
  ${baysHtml || '<div class="empty">No open bays</div>'}
  <script nonce="${nonce}" src="${uris.webviewScript}"></script>
</body>
</html>`;
  }

  //= RENDERIZADO DE BAYS

  private renderAllBays(
    groups: BayGroup[],
    getBaysInGroup: (groupId: number) => Bay[],
    showPath: boolean,
    copilotReady: boolean,
    compactMode: boolean,
    pendingIcons: PendingIcon[],
  ): string {
    // Skip groups with no renderable bays. A group holding only a markdown
    // preview webview (e.g. "Open Preview to the Side") has zero bays in state
    // — rendering its header with nothing under it just looks broken.
    const populated = groups
      .map(group => ({ group, bays: getBaysInGroup(group.id) }))
      .filter(({ bays }) => bays.length > 0);

    const context = (group: BayGroup, color: BayGroupColor | null): BayListContext => ({
      showPath,
      copilotReady,
      compactMode,
      pendingIcons,
      locked: group.isLocked,
      color,
    });

    // Con un solo grupo no hay cabecera ni acento de color: no hay nada de lo
    // que distinguirlo. El bloqueo, en cambio, sí sigue en pie.
    if (populated.length <= 1) {
      const only = populated[0];
      return only ? this.renderBayList(only.bays, context(only.group, null)) : '';
    }

    let html = '';
    for (const { group, bays } of populated) {
      html += this.renderGroupHeader(group);
      html += this.renderBayList(bays, context(group, group.color));
    }
    return html;
  }

  private renderGroupHeader(group: BayGroup): string {
    return GroupHeaderRenderer.render(group, this.esc);
  }

  private renderBayList(bays: Bay[], context: BayListContext): string {
    // Markdown previews are real bays now (variants of their source .md), so
    // there is no preview filtering here — they render as child rows, or as
    // standalone rows when orphaned (source not open / in another group).

    // Separate parent bays (no parentId) from variant bays (have parentId)
    const parentBays = bays.filter(bay => !bay.metadata.sourceBayId);
    const variantBays = bays.filter(bay => bay.metadata.sourceBayId);

    // Build a map of parentId -> children
    const childrenByParent = new Map<string, Bay[]>();
    for (const child of variantBays) {
      const parentId = child.metadata.sourceBayId!;
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId)!.push(child);
    }

    // Sort parent bays: pinned first
    const sortedParents = [...parentBays].sort((a, b) => {
      if (a.state.isPinned && !b.state.isPinned) { return -1; }
      if (!a.state.isPinned && b.state.isPinned) { return 1; }
      return 0;
    });

    // El acento de color viaja en el bloque, no en la cabecera, para que las
    // filas se lean como pertenecientes al grupo también al hacer scroll.
    const colorAttr = context.color ? ` data-group-color="${context.color}"` : '';

    // Render parents with their children inside a shared .bay-block wrapper.
    // The wrapper is the D&D unit: height, cloning and positioning operate on it.
    const rendered: string[] = [];
    for (const parent of sortedParents) {
      const children = childrenByParent.get(parent.metadata.id) || [];
      const blockClass = children.length > 0 ? 'bay-block has-children' : 'bay-block';
      const hasPreviewVariant = children.some(child => child.metadata.diffType === 'preview');

      let block = `<div class="${blockClass}" data-bay-id="${this.esc(parent.metadata.id)}" data-pinned="${parent.state.isPinned}" data-groupid="${parent.state.groupId}"${colorAttr}>`;
      block += this.renderBay(parent, context, hasPreviewVariant);
      for (const child of children) {
        block += this.renderVariantBay(child, context.locked);
      }
      block += `</div>`;
      rendered.push(block);
    }

    // Orphan variant bays (parent file not open) — wrapped individually as draggable blocks
    for (const child of variantBays) {
      if (!parentBays.some(parent => parent.metadata.id === child.metadata.sourceBayId)) {
        const orphanHtml = this.renderOrphanVariantBay(child, context.locked);
        rendered.push(`<div class="bay-block" data-bay-id="${this.esc(child.metadata.id)}" data-pinned="false" data-variant="true" data-groupid="${child.state.groupId}"${colorAttr}>${orphanHtml}</div>`);
      }
    }
    return rendered.join('');
  }

  /**
   * Renders a variant bay (diff) attached to its parent.
   * Always compact, indented, no path shown.
   */
  private renderVariantBay(
    bay: Bay,
    locked: boolean,
  ): string {
    return VariantRowRenderer.render({
      bay,
      esc: this.esc,
      allowClose: !locked,
      hover: this._enableHoverActions,
    });
  }

  /**
   * Renders an orphan variant bay (diff/preview whose parent is not in this list:
   * source file closed, or living in another editor group).
   *
   * Sigue siendo una VARIANTE: misma fila compacta, icono y color de diff. Antes
   * se dibujaba con `renderBay()` y quedaba idéntica a una bay normal, así que
   * una variante recién abierta aparentaba ser un parent. Lo único que cambia es
   * que se muestra el label nativo (incluye el archivo) y no se indenta, porque
   * no hay parent encima del que colgar.
   */
  private renderOrphanVariantBay(bay: Bay, locked: boolean): string {
    return VariantRowRenderer.render({
      bay,
      esc: this.esc,
      orphan: true,
      allowClose: !locked,
      hover: this._enableHoverActions,
    });
  }

  private renderBay(
    bay: Bay,
    context: BayListContext,
    hasPreviewVariant = false,
  ): string {
    const { showPath, copilotReady, compactMode, pendingIcons, locked } = context;

    // data-bay-id only — data-pinned and data-groupid live on the parent .bay-block
    const activeClass = bay.state.isActive ? ' active' : '';
    const stateIndicator = getStateIndicator(bay);

    const pinBadge = bay.state.isPinned
      ? '<span class="pin-badge codicon codicon-pinned" title="Pinned"></span>'
      : '';

    const hover = this._enableHoverActions;

    const fileActionBtn = hover && bay.state.capabilities.canTogglePreview
      ? this.renderFileActionButton(bay, hasPreviewVariant)
      : '';

    const chatBtn = hover && copilotReady && bay.metadata.uri
      ? `<button data-action="addToChat" data-bay-id="${this.esc(bay.metadata.id)}" title="Add to Copilot Chat"><span class="codicon codicon-attach"></span></button>`
      : '';

    const closeBtn = hover && !locked && bay.state.capabilities.canClose
      ? `<button data-action="closeBay" data-bay-id="${this.esc(bay.metadata.id)}" title="Close"><span class="codicon codicon-remove-close"></span></button>`
      : '';

    const { html: iconHtml, pending } = this.iconRenderer.renderImmediate(bay);
    if (pending) {
      pendingIcons.push({ bayId: bay.metadata.id, fileName: pending.fileName, languageId: pending.languageId });
    }

    return BayRowRenderer.render({
      bay,
      showPath,
      compactMode,
      activeClass,
      iconHtml,
      stateIndicator,
      pinBadge,
      fileActionBtn,
      chatBtn,
      closeBtn,
      esc: this.esc,
    });
  }

  //= BOTONES DE ACCIÓN

  private renderFileActionButton(bay: Bay, hasPreviewVariant = false): string {
    if (!this.fileActionRegistry || !bay.metadata.uri) { return ''; }

    const context = { viewMode: bay.state.viewMode };
    const resolved = this.fileActionRegistry.resolve(bay.metadata.label, bay.metadata.uri, context);
    if (!resolved) { return ''; }

    // The markdown button CREATES the preview variant; once the bay already has
    // one (the child "Preview" row), the button is pointless — hide it.
    if (resolved.id === 'openMarkdownPreview' && hasPreviewVariant) { return ''; }

    return `<button data-action="fileAction" data-bay-id="${this.esc(bay.metadata.id)}" data-actionid="${this.esc(resolved.id)}" title="${this.esc(resolved.tooltip)}"><span class="codicon codicon-${this.esc(resolved.icon)}"></span></button>`;
  }

  //= UTILIDADES

  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // CSPRNG: la CSP confía en el nonce para script-src, así que no puede salir
  // de Math.random() (predecible).
  private generateNonce(): string {
    return randomBytes(24).toString('base64');
  }
}


