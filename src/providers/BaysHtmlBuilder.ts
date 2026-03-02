/**
 * Builder encargado de generar el HTML/CSS del webview de tabs.
 * Orquesta los módulos especializados para renderizado.
 *
 * Arquitectura:
 *  - IconRenderer   → renderizado de iconos (font/base64/codicon)
 *  - StylesBuilder  → CSS crítico y CSP
 *  - types.ts       → tipos compartidos
 */

import * as vscode from 'vscode';
import { TabIconManager } from '../services/ui/BayIconManager';
import type { DocumentManager } from '../services/core/DocumentManager';
import { SideTab } from '../models/SideTab';
import { SideTabGroup } from '../models/SideTabGroup';
import { FileActionRegistry } from '../services/registry/FileActionRegistry';
import { getStateIndicator } from '../utils/stateIndicator';
import { IconRenderer, StylesBuilder, BuildHtmlOptions, WebviewResourceUris } from './html';
import { getDiffTypeDisplay, getDiffTypeBadgeHtml } from '../constants/diffTypes';

export class BaysHtmlBuilder {
  private readonly iconRenderer: IconRenderer;
  private readonly stylesBuilder: StylesBuilder;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly iconManager: TabIconManager,
    private readonly context: vscode.ExtensionContext,
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
      groups: grps,
      getTabsInGroup: getTabs,
      showPath: path,
      copilotReady: copilot,
      enableDragDrop: dragDrop = false,
      compactMode,
      workspaceName,
    } = options;

    const uris = this.resolveResourceUris(webview, dragDrop);
    const nonce = this.generateNonce();
    const tabsHtml = await this.renderAllTabs(grps, getTabs, path, copilot, dragDrop, compactMode);

    return this.assembleHtml(webview, uris, nonce, workspaceName, compactMode, tabsHtml, dragDrop, options.initialLoad);
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
    workspaceName: string,
    compactMode: boolean,
    tabsHtml: string,
    enableDragDrop: boolean,
    initialLoad = false,
  ): string {
    const csp = this.stylesBuilder.buildCSP(webview, nonce);
    const criticalCss = this.stylesBuilder.buildCriticalCSS();
    const bodyClass = initialLoad ? '' : 'loaded';

    return /* html */ `<!DOCTYPE html>
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
  ${tabsHtml || '<div class="empty">No open tabs</div>'}
  <script nonce="${nonce}" src="${uris.webviewScript}"></script>
  ${uris.dragDropScript ? `<script nonce="${nonce}" src="${uris.dragDropScript}"></script>` : ''}
</body>
</html>`;
  }

  //= RENDERIZADO DE TABS

  private async renderAllTabs(
    groups: SideTabGroup[],
    getTabsInGroup: (groupId: number) => SideTab[],
    showPath: boolean,
    copilotReady: boolean,
    enableDragDrop: boolean,
    compactMode: boolean,
  ): Promise<string> {
    if (groups.length <= 1) {
      const groupId = groups[0]?.id;
      if (groupId !== undefined) {
        return this.renderTabList(getTabsInGroup(groupId), showPath, copilotReady, enableDragDrop, compactMode);
      }
      return '';
    }

    let html = '';
    for (const group of groups) {
      html += this.renderGroupHeader(group);
      html += await this.renderTabList(getTabsInGroup(group.id), showPath, copilotReady, enableDragDrop, compactMode);
    }
    return html;
  }

  private renderGroupHeader(group: SideTabGroup): string {
    const marker = group.isActive ? ' ●' : '';
    return `<div class="group-header" data-groupid="${group.id}">
      <span class="codicon codicon-files files"></span>
      <span class="group-label">${this.esc(group.label)}${marker}</span>
      <span class="group-actions">
        <button class="group-btn" data-action="closeGroup" data-groupid="${group.id}" title="Close Group"><span class="codicon codicon-close-all"></span></button>
        <button class="group-btn" data-action="toggleGroup" data-groupid="${group.id}" title="Collapse/Expand"><span class="codicon codicon-fold-down"></span></button>
      </span>
    </div>`;
  }

  private async renderTabList(
    tabs: SideTab[],
    showPath: boolean,
    copilotReady: boolean,
    enableDragDrop: boolean,
    compactMode: boolean,
  ): Promise<string> {
    // Separate parent tabs (no parentId) from child tabs (have parentId)
    const parentTabs = tabs.filter(t => !t.metadata.parentId);
    const childTabs = tabs.filter(t => t.metadata.parentId);
    
    // Build a map of parentId -> children
    const childrenByParent = new Map<string, SideTab[]>();
    for (const child of childTabs) {
      const parentId = child.metadata.parentId!;
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId)!.push(child);
    }
    
    // Sort parent tabs: pinned first
    const sortedParents = [...parentTabs].sort((a, b) => {
      if (a.state.isPinned && !b.state.isPinned) { return -1; }
      if (!a.state.isPinned && b.state.isPinned) { return 1; }
      return 0;
    });

    // Render parents with their children inside a shared .tab-block wrapper.
    // The wrapper is the D&D unit: height, cloning and positioning operate on it.
    const rendered: string[] = [];
    for (const parent of sortedParents) {
      const children = childrenByParent.get(parent.metadata.id) || [];
      const blockClass = children.length > 0 ? 'tab-block has-children' : 'tab-block';

      let block = `<div class="${blockClass}" data-tabid="${this.esc(parent.metadata.id)}" data-pinned="${parent.state.isPinned}" data-groupid="${parent.state.groupId}">`;
      block += await this.renderTab(parent, showPath, copilotReady, enableDragDrop, compactMode);
      for (const child of children) {
        block += await this.renderChildTab(child, copilotReady, parent);
      }
      block += `</div>`;
      rendered.push(block);
    }

    // Orphan child tabs (parent file not open) — wrapped individually as draggable blocks
    for (const child of childTabs) {
      if (!parentTabs.some(p => p.metadata.id === child.metadata.parentId)) {
        const orphanHtml = await this.renderOrphanChildTab(child, showPath, copilotReady, compactMode);
        rendered.push(`<div class="tab-block" data-tabid="${this.esc(child.metadata.id)}" data-pinned="false" data-groupid="${child.state.groupId}">${orphanHtml}</div>`);
      }
    }
    
    return rendered.join('');
  }

  /**
   * Renders a child tab (diff) attached to its parent.
   * Always compact, indented, no path shown.
   */
  private async renderChildTab(
    tab: SideTab,
    copilotReady: boolean,
    parent: SideTab,
  ): Promise<string> {
    const activeClass = tab.state.isActive ? ' active' : '';
    const dataParentId = `data-parentid="${this.esc(parent.metadata.id)}"`;

    // Get diff type display info
    const diffInfo = getDiffTypeDisplay(tab.metadata.diffType, tab.metadata.label);
    const diffTypeClass = diffInfo?.cssClass ? ` ${diffInfo.cssClass}` : '';
    
    // Icon and label
    const iconHtml = diffInfo 
      ? `<span class="codicon codicon-${diffInfo.icon}"></span>` 
      : '<span class="codicon codicon-diff"></span>';
    const labelHtml = diffInfo ? this.esc(diffInfo.label) : 'Diff';

    // Stats display
    const statsHtml = this.renderChildStats(tab.state.diffStats);

    // Close button
    const closeBtn = tab.state.capabilities.canClose
      ? `<button data-action="closeTab" data-tabid="${this.esc(tab.metadata.id)}" title="Close"><span class="codicon codicon-close"></span></button>`
      : '';

    return `<div class="tab child-tab${activeClass}${diffTypeClass}" data-tabid="${this.esc(tab.metadata.id)}" ${dataParentId}>
      <span class="tab-icon">${iconHtml}</span>
      <span class="child-type-label">${labelHtml}</span>
      ${statsHtml}
      <span class="tab-actions">${closeBtn}</span>
    </div>`;
  }

  /**
   * Renders stats for a child tab (diff statistics)
   */
  private renderChildStats(diffStats: any): string {
    if (!diffStats) {
      return '';
    }

    const { linesAdded, linesRemoved, timestamp, conflictSections } = diffStats;

    // Lines changed (working tree, staged, edit)
    if (linesAdded !== undefined && linesRemoved !== undefined) {
      return `<span class="child-stats" title="${linesAdded} lines added, ${linesRemoved} lines removed"><span class="stats-added">+${linesAdded}</span><span class="stats-removed">-${linesRemoved}</span></span>`;
    }

    // Timestamp (snapshots)
    if (timestamp) {
      const relativeTime = this.formatRelativeTime(timestamp);
      return `<span class="child-stats" title="${new Date(timestamp).toLocaleString()}">${relativeTime}</span>`;
    }

    // Conflicts
    if (conflictSections) {
      return `<span class="child-stats conflict" title="${conflictSections} conflict sections">${conflictSections} conflicts</span>`;
    }

    return '';
  }

  /**
   * Formats a timestamp as relative time (e.g., "2 hours ago")
   */
  private formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ago`;
    }
    if (hours > 0) {
      return `${hours}h ago`;
    }
    if (minutes > 0) {
      return `${minutes}m ago`;
    }
    return 'just now';
  }

  /**
   * Renders an orphan child tab (diff whose parent file is not open).
   * Shown with full info since there's no parent context.
   */
  private async renderOrphanChildTab(
    tab: SideTab,
    showPath: boolean,
    copilotReady: boolean,
    compactMode: boolean,
  ): Promise<string> {
    // Render like a normal tab but with diff icon prefix
    return this.renderTab(tab, showPath, copilotReady, false, compactMode);
  }

  private async renderTab(
    tab: SideTab,
    showPath: boolean,
    copilotReady: boolean,
    _enableDragDrop: boolean,
    compactMode: boolean,
  ): Promise<string> {
    // data-tabid only — data-pinned and data-groupid live on the parent .tab-block
    const activeClass = tab.state.isActive ? ' active' : '';
    const stateIndicator = getStateIndicator(tab);

    const pinBadge = tab.state.isPinned
      ? '<span class="pin-badge codicon codicon-pinned" title="Pinned"></span>'
      : '';
    
    // Version badge for parent tabs with multiple versions
    const versionBadge = this.renderVersionBadge(tab);

    const fileActionBtn = tab.state.capabilities.canTogglePreview
      ? this.renderFileActionButton(tab)
      : '';

    const chatBtn = copilotReady && tab.metadata.uri
      ? `<button data-action="addToChat" data-tabid="${this.esc(tab.metadata.id)}" title="Add to Copilot Chat"><span class="codicon codicon-attach"></span></button>`
      : '';

    const closeBtn = tab.state.capabilities.canClose
      ? `<button data-action="closeTab" data-tabid="${this.esc(tab.metadata.id)}" title="Close"><span class="codicon codicon-remove-close"></span></button>`
      : '';

    const iconHtml = await this.iconRenderer.render(tab);

    // Compact mode: same layout as normal, single-line text (name + inline path)
    if (compactMode) {
      const pathSuffix = showPath && tab.metadata.detailLabel
        ? `<span class="tab-path-inline">${this.esc(tab.metadata.detailLabel)}</span>`
        : '';
      return `<div class="tab compact${activeClass}" data-tabid="${this.esc(tab.metadata.id)}">
      <span class="tab-icon">${iconHtml}</span>
      <div class="tab-text">
        <div class="tab-name${stateIndicator.nameClass}">${this.esc(tab.metadata.label)}${pinBadge}${versionBadge}${pathSuffix}</div>
      </div>
      ${stateIndicator.html}
      <span class="tab-actions">
        ${fileActionBtn}${chatBtn}${closeBtn}
      </span>
    </div>`;
    }

    // Normal mode: two-line layout
    const pathHtml = showPath && tab.metadata.detailLabel
      ? `<div class="tab-path">${this.esc(tab.metadata.detailLabel)}</div>`
      : '';

    return `<div class="tab${activeClass}" data-tabid="${this.esc(tab.metadata.id)}">
      <span class="tab-icon">${iconHtml}</span>
      <div class="tab-text">
        <div class="tab-name${stateIndicator.nameClass}">${this.esc(tab.metadata.label)}${pinBadge}${versionBadge}</div>
        ${pathHtml}
      </div>
      ${stateIndicator.html}
      <span class="tab-actions">
        ${fileActionBtn}${chatBtn}${closeBtn}
      </span>
    </div>`;
  }

  //= BOTONES DE ACCIÓN

  private renderFileActionButton(tab: SideTab): string {
    if (!this.fileActionRegistry || !tab.metadata.uri) { return ''; }

    // Pass viewMode context for dynamic actions (like MD toggle)
    const context = { viewMode: tab.state.viewMode };
    const resolved = this.fileActionRegistry.resolve(tab.metadata.label, tab.metadata.uri, context);
    if (!resolved) { return ''; }

    return `<button data-action="fileAction" data-tabid="${this.esc(tab.metadata.id)}" data-actionid="${this.esc(resolved.id)}" title="${this.esc(resolved.tooltip)}"><span class="codicon codicon-${this.esc(resolved.icon)}"></span></button>`;
  }
  
  /**
   * Renderiza un badge con el número de versiones del documento.
   * Solo se muestra para parent tabs que tienen document model con versiones.
   */
  private renderVersionBadge(tab: SideTab): string {
    // Only show for parent tabs (not children)
    if (tab.metadata.parentId || !tab.metadata.uri || !this.documentManager) {
      return '';
    }
    
    const document = this.documentManager.getDocumentByUri(tab.metadata.uri);
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

