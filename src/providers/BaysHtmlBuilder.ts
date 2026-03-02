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
import { IconRenderer, StylesBuilder, BuildHtmlOptions, WebviewResourceUris } from './html';
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
   */
  async buildHtml(options: BuildHtmlOptions): Promise<string> {
    const {
      webview,
      groups,
      getTabsInGroup: getBaysInGroup,
      showPath,
      copilotReady,
      enableDragDrop = false,
      compactMode,
    } = options;

    const uris = this.resolveResourceUris(webview, enableDragDrop);
    const nonce = this.generateNonce();
    const baysHtml = await this.renderAllBays(groups, getBaysInGroup, showPath, copilotReady, compactMode);

    return this.assembleHtml(webview, uris, nonce, baysHtml, options.initialLoad);
  }

  //= RESOLUCIÓN DE RECURSOS

  private resolveResourceUris(webview: vscode.Webview, enableDragDrop: boolean): WebviewResourceUris {
    const asUri = (segments: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...segments));

    return {
      codiconCss: asUri(['dist', 'codicons', 'codicon.css']),
      webviewCss: asUri(['dist', 'styles', 'webview.css']),
      webviewScript: asUri(['dist', 'webview', 'webview.js']),
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
  ${uris.dragDropScript ? `<script nonce="${nonce}" src="${uris.dragDropScript}"></script>` : ''}
</body>
</html>`;
  }

  //= RENDERIZADO DE BAYS

  private async renderAllBays(
    groups: BayGroup[],
    getTabsInGroup: (groupId: number) => Bay[],
    showPath: boolean,
    copilotReady: boolean,
    compactMode: boolean,
  ): Promise<string> {
    if (groups.length <= 1) {
      const groupId = groups[0]?.id;
      if (groupId !== undefined) {
        return this.renderBayList(getTabsInGroup(groupId), showPath, copilotReady, compactMode);
      }
      return '';
    }

    let html = '';
    for (const group of groups) {
      html += this.renderGroupHeader(group);
      html += await this.renderBayList(getTabsInGroup(group.id), showPath, copilotReady, compactMode);
    }
    return html;
  }

  private renderGroupHeader(group: BayGroup): string {
    return GroupHeaderRenderer.render(group, this.esc);
  }

  private async renderBayList(
    bays: Bay[],
    showPath: boolean,
    copilotReady: boolean,
    compactMode: boolean,
  ): Promise<string> {
    // Separate parent bays (no parentId) from variant bays (have parentId)
    const parentBays = bays.filter(bay => !bay.metadata.parentId);
    const variantBays = bays.filter(bay => bay.metadata.parentId);
    
    // Build a map of parentId -> children
    const childrenByParent = new Map<string, Bay[]>();
    for (const child of variantBays) {
      const parentId = child.metadata.parentId!;
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

      let block = `<div class="${blockClass}" data-tabid="${this.esc(parent.metadata.id)}" data-pinned="${parent.state.isPinned}" data-groupid="${parent.state.groupId}">`;
      block += await this.renderBay(parent, showPath, copilotReady, compactMode);
      for (const child of children) {
        block += this.renderVariantBay(child, parent);
      }
      block += `</div>`;
      rendered.push(block);
    }

    // Orphan variant bays (parent file not open) — wrapped individually as draggable blocks
    for (const child of variantBays) {
      if (!parentBays.some(parent => parent.metadata.id === child.metadata.parentId)) {
        const orphanHtml = await this.renderOrphanVariantBay(child, showPath, copilotReady, compactMode);
        rendered.push(`<div class="bay-block" data-tabid="${this.esc(child.metadata.id)}" data-pinned="false" data-groupid="${child.state.groupId}">${orphanHtml}</div>`);
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
  private async renderOrphanVariantBay(
    bay: Bay,
    showPath: boolean,
    copilotReady: boolean,
    compactMode: boolean,
  ): Promise<string> {
    // Render like a normal bay but with diff icon prefix
    return this.renderBay(bay, showPath, copilotReady, compactMode);
  }

  private async renderBay(
    bay: Bay,
    showPath: boolean,
    copilotReady: boolean,
    compactMode: boolean,
  ): Promise<string> {
    // data-tabid only — data-pinned and data-groupid live on the parent .bay-block
    const activeClass = bay.state.isActive ? ' active' : '';
    const stateIndicator = getStateIndicator(bay);

    const pinBadge = bay.state.isPinned
      ? '<span class="pin-badge codicon codicon-pinned" title="Pinned"></span>'
      : '';
    
    // Version badge for parent bays with multiple versions
    const versionBadge = this.renderVersionBadge(bay);

    const fileActionBtn = bay.state.capabilities.canTogglePreview
      ? this.renderFileActionButton(bay)
      : '';

    const chatBtn = copilotReady && bay.metadata.uri
      ? `<button data-action="addToChat" data-tabid="${this.esc(bay.metadata.id)}" title="Add to Copilot Chat"><span class="codicon codicon-attach"></span></button>`
      : '';

    const closeBtn = bay.state.capabilities.canClose
      ? `<button data-action="closeTab" data-tabid="${this.esc(bay.metadata.id)}" title="Close"><span class="codicon codicon-remove-close"></span></button>`
      : '';

    const iconHtml = await this.iconRenderer.render(bay);

    return BayRowRenderer.render({
      bay,
      showPath,
      compactMode,
      activeClass,
      iconHtml,
      stateIndicator,
      pinBadge,
      versionBadge,
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

    return `<button data-action="fileAction" data-tabid="${this.esc(bay.metadata.id)}" data-actionid="${this.esc(resolved.id)}" title="${this.esc(resolved.tooltip)}"><span class="codicon codicon-${this.esc(resolved.icon)}"></span></button>`;
  }
  
  /**
   * Renderiza un badge con el número de versiones del documento.
   * Solo se muestra para parent bays que tienen document model con versiones.
   */
  private renderVersionBadge(bay: Bay): string {
    // Only show for parent bays (not children)
    if (bay.metadata.parentId || !bay.metadata.uri || !this.documentManager) {
      return '';
    }
    
    const document = this.documentManager.getDocumentByUri(bay.metadata.uri);
    if (!document || document.versionCount === 0) {
      return '';
    }
    
    const stats = this.documentManager.getDocumentStats(document.documentId);
    if (!stats) {
      return '';
    }
    
    // Build tooltip with version breakdown
    const tooltipParts: string[] = [];
    if (stats.workingTreeVersions > 0) {
      tooltipParts.push(`${stats.workingTreeVersions} working tree`);
    }
    if (stats.stagedVersions > 0) {
      tooltipParts.push(`${stats.stagedVersions} staged`);
    }
    if (stats.snapshots > 0) {
      tooltipParts.push(`${stats.snapshots} snapshots`);
    }
    if (stats.aiEdits > 0) {
      tooltipParts.push(`${stats.aiEdits} AI edits`);
    }
    if (stats.commits > 0) {
      tooltipParts.push(`${stats.commits} commits`);
    }
    
    const tooltip = tooltipParts.length > 0
      ? `${stats.totalVersions} versions (${tooltipParts.join(', ')})`
      : `${stats.totalVersions} versions`;
    
    return `<span class="version-badge" title="${this.esc(tooltip)}">
      <span class="codicon codicon-versions"></span>
      <span class="version-count">${stats.totalVersions}</span>
    </span>`;
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


