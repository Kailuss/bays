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
import { BayIconManager } from '../services/ui/BayIconManager';
import type { DocumentManager } from '../services/core/DocumentManager';
import { Bay } from '../models/Bay';
import { BayGroup } from '../models/BayGroup';
import { FileActionRegistry } from '../services/registry/FileActionRegistry';
import { getStateIndicator } from '../utils/stateIndicator';
import { IconRenderer, StylesBuilder, BuildHtmlOptions, WebviewResourceUris, PendingIcon, BuildHtmlResult } from './html';
import { BayRowRenderer, GroupHeaderRenderer, VariantRowRenderer } from './renderers';

export class BaysHtmlBuilder {
  private readonly iconRenderer: IconRenderer;
  private readonly stylesBuilder: StylesBuilder;

  constructor(
    private readonly extensionUri: vscode.Uri,
    iconManager: BayIconManager,
    context: vscode.ExtensionContext,
    private readonly fileActionRegistry?: FileActionRegistry,
    private readonly documentManager?: DocumentManager,
  ) {
    this.iconRenderer = new IconRenderer(iconManager, context);
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
      compactMode,
    } = options;

    const uris = this.resolveResourceUris(webview, enableDragDrop);
    const nonce = this.generateNonce();
    const pendingIcons: PendingIcon[] = [];
    const baysHtml = this.renderAllBays(groups, getBaysInGroup, showPath, copilotReady, compactMode, pendingIcons);

    const html = this.assembleHtml(webview, uris, nonce, baysHtml, options.initialLoad);
    return { html, pendingIcons };
  }

  /**
   * Resuelve el HTML de un icono por nombre de archivo (parche diferido).
   */
  resolveIconHtml(fileName: string, languageId?: string): Promise<string> {
    return this.iconRenderer.renderByFileName(fileName, languageId);
  }

  //= RESOLUCIÓN DE RECURSOS

  private resolveResourceUris(webview: vscode.Webview, enableDragDrop: boolean): WebviewResourceUris {
    const asUri = (segments: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...segments));

    return {
      codiconCss: asUri(['dist', 'codicons', 'codicon.css']),
      webviewCss: asUri(['dist', 'styles', 'webview.css']),
      webviewScript: asUri(['dist', 'webview', 'webview.js']),
      pathTruncationScript: asUri(['dist', 'webview', 'pathTruncation.js']),
      dragDropScript: enableDragDrop ? asUri(['dist', 'webview', 'dragdrop.js']) : null,
    };
  }

  //= ENSAMBLAJE HTML

  private assembleHtml(
    webview: vscode.Webview,
    uris: WebviewResourceUris,
    nonce: string,
    baysHtml: string,
    initialLoad = false,
  ): string {
    const csp = this.stylesBuilder.buildCSP(webview, nonce);
    const criticalCss = this.stylesBuilder.buildCriticalCSS();
    const bodyClass = initialLoad ? '' : 'loaded';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${criticalCss}</style>
<link href="${uris.codiconCss}" rel="stylesheet" />
<link href="${uris.webviewCss}" rel="stylesheet" />
</head>
<body class="${bodyClass}">
  ${baysHtml || '<div class="empty">No open bays</div>'}
  <script nonce="${nonce}" src="${uris.webviewScript}"></script>
  <script nonce="${nonce}" src="${uris.pathTruncationScript}"></script>
  ${uris.dragDropScript ? `<script nonce="${nonce}" src="${uris.dragDropScript}"></script>` : ''}
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
    if (groups.length <= 1) {
      const groupId = groups[0]?.id;
      if (groupId !== undefined) {
        return this.renderBayList(getBaysInGroup(groupId), showPath, copilotReady, compactMode, pendingIcons);
      }
      return '';
    }

    let html = '';
    for (const group of groups) {
      html += this.renderGroupHeader(group);
      html += this.renderBayList(getBaysInGroup(group.id), showPath, copilotReady, compactMode, pendingIcons);
    }
    return html;
  }

  private renderGroupHeader(group: BayGroup): string {
    return GroupHeaderRenderer.render(group, this.esc);
  }

  private renderBayList(
    bays: Bay[],
    showPath: boolean,
    copilotReady: boolean,
    compactMode: boolean,
    pendingIcons: PendingIcon[],
  ): string {
    // CRITICAL: Filter out markdown preview bays - they should NEVER be rendered
    // Preview tabs are managed as viewMode state on source bays
    const filteredBays = bays.filter(bay => {
      // Filter by viewType (webview tabs)
      if (bay.metadata.viewType === 'markdown.preview') {
        return false;
      }
      // Filter by label pattern (fallback)
      if (bay.metadata.bayType === 'webview' && bay.metadata.label.startsWith('Preview ')) {
        return false;
      }
      return true;
    });

    // Separate parent bays (no parentId) from variant bays (have parentId)
    const parentBays = filteredBays.filter(bay => !bay.metadata.sourceBayId);
    const variantBays = filteredBays.filter(bay => bay.metadata.sourceBayId);

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

    // Render parents with their children inside a shared .bay-block wrapper.
    // The wrapper is the D&D unit: height, cloning and positioning operate on it.
    const rendered: string[] = [];
    for (const parent of sortedParents) {
      const children = childrenByParent.get(parent.metadata.id) || [];
      const blockClass = children.length > 0 ? 'bay-block has-children' : 'bay-block';

      let block = `<div class="${blockClass}" data-bay-id="${this.esc(parent.metadata.id)}" data-pinned="${parent.state.isPinned}" data-groupid="${parent.state.groupId}">`;
      block += this.renderBay(parent, showPath, copilotReady, compactMode, pendingIcons);
      for (const child of children) {
        block += this.renderVariantBay(child, parent);
      }
      block += `</div>`;
      rendered.push(block);
    }

    // Orphan variant bays (parent file not open) — wrapped individually as draggable blocks
    for (const child of variantBays) {
      if (!parentBays.some(parent => parent.metadata.id === child.metadata.sourceBayId)) {
        const orphanHtml = this.renderOrphanVariantBay(child, showPath, copilotReady, compactMode, pendingIcons);
        rendered.push(`<div class="bay-block" data-bay-id="${this.esc(child.metadata.id)}" data-pinned="false" data-groupid="${child.state.groupId}">${orphanHtml}</div>`);
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
    parent: Bay,
  ): string {
    return VariantRowRenderer.render({
      bay,
      parentId: this.esc(parent.metadata.id),
      esc: this.esc,
    });
  }

  /**
   * Renders an orphan variant bay (diff whose parent file is not open).
   * Shown with full info since there's no parent context.
   */
  private renderOrphanVariantBay(
    bay: Bay,
    showPath: boolean,
    copilotReady: boolean,
    compactMode: boolean,
    pendingIcons: PendingIcon[],
  ): string {
    // Render like a normal bay but with diff icon prefix
    return this.renderBay(bay, showPath, copilotReady, compactMode, pendingIcons);
  }

  private renderBay(
    bay: Bay,
    showPath: boolean,
    copilotReady: boolean,
    compactMode: boolean,
    pendingIcons: PendingIcon[],
  ): string {
    // data-bay-id only — data-pinned and data-groupid live on the parent .bay-block
    const activeClass = bay.state.isActive ? ' active' : '';
    const stateIndicator = getStateIndicator(bay);

    const pinBadge = bay.state.isPinned
      ? '<span class="pin-badge codicon codicon-pinned" title="Pinned"></span>'
      : '';

    const fileActionBtn = bay.state.capabilities.canTogglePreview
      ? this.renderFileActionButton(bay)
      : '';

    const chatBtn = copilotReady && bay.metadata.uri
      ? `<button data-action="addToChat" data-bay-id="${this.esc(bay.metadata.id)}" title="Add to Copilot Chat"><span class="codicon codicon-attach"></span></button>`
      : '';

    const closeBtn = bay.state.capabilities.canClose
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

  private renderFileActionButton(bay: Bay): string {
    if (!this.fileActionRegistry || !bay.metadata.uri) { return ''; }

    // Pass viewMode context for dynamic actions (like MD toggle)
    const context = { viewMode: bay.state.viewMode };
    const resolved = this.fileActionRegistry.resolve(bay.metadata.label, bay.metadata.uri, context);
    if (!resolved) { return ''; }

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

  private generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }
}


