import * as vscode from 'vscode';
import { getConfiguration }         from '../constants/styles';
import { TIMINGS }                  from '../constants/timings';
import { SideTab }                  from '../models/Bay';
import type { BayViewMode }         from '../models/Bay';
import { BayStateService }          from '../services/core/BayStateService';
import { TabIconManager }           from '../services/ui/BayIconManager';
import { CopilotService }           from '../services/integration/CopilotService';
import { BayDragDropService }       from '../services/ui/BayDragDropService';
import { FileActionRegistry }       from '../services/registry/FileActionRegistry';
import { Logger }                   from '../utils/logger';
import { BaysHtmlBuilder }          from './BaysHtmlBuilder';
import { BayContextMenu }           from './BayContextMenu';

/**
 * Proveedor del Webview que coordina la vista de pestañas.
 * Gestiona el ciclo de vida del webview, mensajes y eventos.
 * La generación de HTML se delega a `BaysHtmlBuilder`.
 */
export class BaysWebviewProvider implements vscode.WebviewViewProvider { 
  public static readonly viewType = 'bays';

  private _view?: vscode.WebviewView;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _fullRefreshPending = false;
  private _initialLoadComplete = false;
  private readonly htmlBuilder: BaysHtmlBuilder;
  private readonly contextMenu: BayContextMenu;

  constructor(
    private readonly _extensionUri  : vscode.Uri,
    private readonly stateService   : BayStateService,
    private readonly syncService    : any, // TabSyncService (any para evitar import cíclico)
    private readonly copilotService : CopilotService,
    private readonly iconManager    : TabIconManager,
    private readonly context        : vscode.ExtensionContext,
    private readonly dragDropService: BayDragDropService,
    private readonly fileActionRegistry: FileActionRegistry,
  ) {
    // Get DocumentManager from syncService if available
    const documentManager = this.syncService?.getDocumentManager?.();
    this.htmlBuilder = new BaysHtmlBuilder(_extensionUri, iconManager, context, fileActionRegistry, documentManager);
    this.contextMenu = new BayContextMenu(stateService, copilotService);
    // Full rebuild on structural changes
    stateService.onDidChangeState(() => this.refresh());
    // Partial update for lightweight changes (active tab only)
    stateService.onDidChangeStateSilent(() => this.refreshSilent());
    // Notify tab state changes for animation
    stateService.onDidChangeTabState((tabId: string) => this.notifyTabStateChanged(tabId));
    // Rebuild when workspace folders change (updates header title)
    vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh());
  }

  //= WEBVIEW LIFECYCLE

  resolveWebviewView(
    webviewView : vscode.WebviewView,
    _ctx        : vscode.WebviewViewResolveContext,
    _token      : vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    // Configure webview options
    // localResourceRoots: Allow access to dist/ folder for CSS, JS, and codicons
    const distUri = vscode.Uri.joinPath(this._extensionUri, 'dist');
    
    webviewView.webview.options = {
      enableScripts      : true,
      localResourceRoots : [this._extensionUri, distUri],
    };

    webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg));

    // Set initial panel title to the workspace name
    webviewView.title = this.getWorkspaceName();

    this.refresh();
  }

  /**
   * Reconstruye el HTML completo y lo envía al webview.
   * Pequeño debounce para evitar repintados repetidos cuando cambian muchos eventos.
   */
  refresh(): void {
    Logger.log('[Bays] refresh() called, view exists: ' + !!this._view);
    if (!this._view) { return; }
    this._fullRefreshPending = true;
    if (this._debounceTimer) { clearTimeout(this._debounceTimer); }
    this._debounceTimer = setTimeout(async () => {
      this._debounceTimer = null;
      this._fullRefreshPending = false;
      if (!this._view) { return; }

      const config       = getConfiguration();
      const groups       = this.stateService.getGroups();
      const copilotReady = this.copilotService.isAvailable();
      
      Logger.log('[Bays] Building HTML, groups: ' + groups.length);

      this._view.webview.html = await this.htmlBuilder.buildHtml({
        webview        : this._view.webview,
        groups,
        getTabsInGroup : (groupId) => this.stateService.getTabsInGroup(groupId),
        workspaceName  : this.getWorkspaceName(),
        compactMode    : config.compactMode,
        showPath       : config.showFilePath,
        copilotReady,
        enableDragDrop : config.enableDragDrop,
        initialLoad    : !this._initialLoadComplete,
      });
      
      this._initialLoadComplete = true;

      // Also update the native VS Code panel title
      this._view.title = this.getWorkspaceName();
      
      Logger.log('[Bays] HTML assigned to webview');
    }, TIMINGS.WEBVIEW_REFRESH_DEBOUNCE);
  }

  /**
   * Envía una actualización parcial al webview (solo estado activo).
   * Evita reconstruir todo el HTML cuando solo cambia la pestaña activa.
   */
  private refreshSilent(): void {
    if (!this._view || this._fullRefreshPending) { return; }

    const activeTabIds: string[] = [];
    for (const group of this.stateService.getGroups()) {
      for (const tab of this.stateService.getTabsInGroup(group.id)) {
        if (tab.state.isActive) { activeTabIds.push(tab.metadata.id); }
      }
    }

    this._view.webview.postMessage({
      type: 'updateActiveTab',
      activeTabIds,
    });
  }

  /**
   * Notifica al webview que el estado de una tab ha cambiado (diagnóstico o git status).
   * Envía el nuevo estado para actualización granular sin reconstruir el HTML.
   */
  async notifyTabStateChanged(tabId: string): Promise<void> {
    if (!this._view || this._fullRefreshPending) { return; }

    const tab = this.stateService.getTab(tabId);
    if (!tab) { return; }

    const { getStateIndicator } = await import('../utils/stateIndicator.js');
    const stateIndicator = getStateIndicator(tab);

    this._view.webview.postMessage({
      type: 'tabStateChanged',
      tabId,
      stateClass: stateIndicator.nameClass,
      stateHtml: stateIndicator.html,
    });
  }


  //= MESSAGE HANDLERS

  private async handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'openTab': {
        // Forzar sincronización de estado antes de buscar la tab
        // (crítico para preview tabs que pueden haber cambiado)
        if (this.syncService?.syncActiveState) {
          this.syncService.syncActiveState();
          // Pequeño retardo para dar tiempo a que VS Code propague el estado de pestañas sincronizado.
          await new Promise(resolve => setTimeout(resolve, TIMINGS.SYNC_PROPAGATION_DELAY));
        }

        const tab = this.findTab(msg.tabId);
        if (!tab) {
          Logger.warn('[Bays] Tab not found for activation (likely closed): ' + msg.tabId);
          // La tab ya no existe - hacer refresh inmediato para limpiar
          this.refresh();
          return;
        }

        // If this tab is in preview mode, track it as the last preview source
        if (tab.state.viewMode === 'preview') {
          this.stateService.setLastMarkdownPreviewTabId(tab.metadata.id);
        }

        try {
          await tab.activate();
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          Logger.error('[Bays] Failed to activate tab: ' + tab.metadata.label, err);

          // Si el error indica que la tab no existe o no corresponde al documento activo,
          // hacer refresh para limpiar
          if (errorMsg.includes('not found') || 
              errorMsg.includes('no longer exists') ||
              errorMsg.includes('does not correspond')) {
            Logger.log('[Bays] Tab was closed/removed or mismatch, refreshing to sync state');
            this.refresh();
          }
        }
        break;
      }
      case 'closeTab': {
        const tab = this.findTab(msg.tabId);
        if (tab) { await tab.close(); }
        break;
      }
      case 'pinTab': {
        const tab = this.findTab(msg.tabId);
        if (tab) {
          await tab.pin();
          this.stateService.reorderOnPin(tab.metadata.id);
        }
        break;
      }
      case 'unpinTab': {
        const tab = this.findTab(msg.tabId);
        if (tab) {
          await tab.unpin();
          this.stateService.reorderOnUnpin(tab.metadata.id);
        }
        break;
      }
      case 'addToChat': {
        const tab = this.findTab(msg.tabId);
        if (tab) { await this.copilotService.addFileToChat(tab.metadata.uri); }
        break;
      }
      case 'contextMenu': {
        const tab = this.findTab(msg.tabId);
        if (tab) { await this.contextMenu.show(tab); }
        break;
      }
      case 'dropTab': {
        const { sourceTabId, targetTabId, insertPosition, sourceGroupId, targetGroupId } = msg;

        // Movimiento dentro del mismo grupo
        if (sourceGroupId === targetGroupId) {
          this.dragDropService.reorderWithinGroup(sourceTabId, targetTabId, insertPosition);
        } else {
          // Movimiento entre grupos
          await this.dragDropService.moveBetweenGroups(sourceTabId, targetGroupId, targetTabId, insertPosition);
        }
        break;
      }
      case 'fileAction': {
        const tab = this.findTab(msg.tabId);
        if (tab?.metadata.uri && msg.actionId) {
          // For Markdown toggle actions, update viewMode state
          const isMarkdownToggle = msg.actionId === 'openMarkdownPreview' || msg.actionId === 'editMarkdownSource';
          
          if (isMarkdownToggle) {
            // Simply toggle the viewMode state for THIS tab only
            // Each tab remembers its own preference (preview vs source)
            const newViewMode: BayViewMode = tab.state.viewMode === 'preview' ? 'source' : 'preview';
            tab.state.viewMode = newViewMode;
            Logger.log(`[WebviewProvider] Toggled viewMode for: ${tab.metadata.label} → ${tab.state.viewMode}`);
            
            // Track which tab last activated the preview (for unique identification)
            if (msg.actionId === 'openMarkdownPreview') {
              this.stateService.setLastMarkdownPreviewTabId(tab.metadata.id);
            } else {
              // If switching back to source, clear the tracker (if this was the active preview)
              if (this.stateService.lastMarkdownPreviewTabId === tab.metadata.id) {
                this.stateService.setLastMarkdownPreviewTabId(null);
              }
            }
          }
          
          // Pass context for dynamic action execution
          const context = { viewMode: tab.state.viewMode };
          const shouldFocus = this.fileActionRegistry.shouldSetFocus(msg.actionId);
          
          // Execute the action (this changes the view)
          await this.fileActionRegistry.execute(msg.actionId, tab.metadata.uri, context);
          
          // For Markdown toggle, always activate the tab to reflect the view change immediately
          if (isMarkdownToggle || (shouldFocus && !tab.state.isActive)) {
            await tab.activate();
          }
          
          // Update state after activation to reflect changes
          if (isMarkdownToggle) {
            this.stateService.updateTab(tab);
          }
        }
        break;
      }
      case 'saveAll': {
        await vscode.workspace.saveAll(false);
        break;
      }
      case 'reorder': {
        vscode.window.showInformationMessage('Reorder: Coming soon');
        break;
      }
      case 'closeGroup': {
        const group = vscode.window.tabGroups.all.find(g => g.viewColumn === msg.groupId);
        if (group) {
          await vscode.window.tabGroups.close(group);
        }
        break;
      }
      case 'toggleCompactMode': {
        const cfg = vscode.workspace.getConfiguration('bays');
        const current = cfg.get<boolean>('compactMode', false);
        await cfg.update('compactMode', !current, vscode.ConfigurationTarget.Global);
        break;
      }
      case 'refresh': {
        this.refresh();
        break;
      }
    }
  }

  private findTab(id: string): SideTab | undefined {
    return this.stateService.getTab(id);
  }

  //= HELPERS

  /**
   * Devuelve el nombre del workspace activo.
   * Usa el nombre del archivo .code-workspace si está disponible,
   * o el nombre de la primera carpeta, o 'No Folder'.
   */
  private getWorkspaceName(): string {
    const wsFile = vscode.workspace.workspaceFile;
    if (wsFile) {
      const base = wsFile.path.split('/').pop() ?? '';
      return base.replace(/\.code-workspace$/i, '') || 'Workspace';
    }
    return vscode.workspace.workspaceFolders?.[0]?.name ?? 'No Folder';
  }

  /**
   * Actualiza el título del panel (visible en la barra del webview).
   * Útil para mostrar estados de carga o el nombre del workspace.
   */
  public sendHeaderMessage(text: string): void {
    if (this._view) {
      this._view.title = text;
    }
  }
}
