import * as vscode from 'vscode';
import { getConfiguration }         from '../constants/styles';
import { TIMINGS }                  from '../constants/timings';
import { Bay }                  from '../models/Bay';
import type { BayViewMode }         from '../models/Bay';
import { BayStateService }          from '../services/core/BayStateService';
import type { DocumentManager }     from '../services/core/DocumentManager';
import { BayIconManager }           from '../services/ui/BayIconManager';
import { CopilotService }           from '../services/integration/CopilotService';
import { BayDragDropService }       from '../services/ui/BayDragDropService';
import { FileActionRegistry }       from '../services/registry/FileActionRegistry';
import { Logger }                   from '../utils/logger';
import { BaysHtmlBuilder }          from './BaysHtmlBuilder';
import { BayContextMenu }           from './BayContextMenu';

type BaySyncLike = {
  syncActiveState?: () => void;
  getDocumentManager?: () => DocumentManager | undefined;
};

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
    private readonly syncService    : BaySyncLike,
    private readonly copilotService : CopilotService,
    private readonly iconManager    : BayIconManager,
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
    // Partial update for lightweight changes (active bay only)
    stateService.onDidChangeStateSilent(() => this.refreshSilent());
    // Notify bay state changes for animation
    stateService.onDidChangeBayState((bayId: string) => this.notifyBayStateChanged(bayId));
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

      const html = await this.htmlBuilder.buildHtml({
        webview        : this._view.webview,
        groups,
        getBaysInGroup : (groupId) => this.stateService.getBaysByGroupId(groupId),
        workspaceName  : this.getWorkspaceName(),
        compactMode    : config.compactMode,
        showPath       : config.showFilePath,
        copilotReady,
        enableDragDrop : config.enableDragDrop,
        initialLoad    : !this._initialLoadComplete,
      });
      
      this._view.webview.html = html;
      this._initialLoadComplete = true;

      // Also update the native VS Code panel title
      this._view.title = this.getWorkspaceName();
      
      Logger.log('[Bays] HTML assigned to webview');
      
      // Debug: Verify data-bay-id attributes exist
      const bayMatch = html.match(/<div class="bay[^>]+data-bay-id="([^"]+)"/);
      if (bayMatch) {
        Logger.log('[Bays] Sample bayId found: ' + bayMatch[1].substring(0, 50));
      } else {
        Logger.error('[Bays] ERROR: No data-bay-id found in HTML!');
      }
      
    }, TIMINGS.WEBVIEW_REFRESH_DEBOUNCE);
  }

  /**
   * Envía una actualización parcial al webview (solo estado activo).
   * Evita reconstruir todo el HTML cuando solo cambia la pestaña activa.
   */
  private refreshSilent(): void {
    if (!this._view || this._fullRefreshPending) { return; }

    const activeBayIds: string[] = [];
    for (const group of this.stateService.getGroups()) {
      for (const bay of this.stateService.getBaysByGroupId(group.id)) {
        if (bay.state.isActive) { activeBayIds.push(bay.metadata.id); }
      }
    }

    this._view.webview.postMessage({
      type: 'updateActiveBay',
      activeBayIds,
    });
  }

  /**
   * Notifica al webview que el estado de una bay ha cambiado (diagnóstico o git status).
   * Envía el nuevo estado para actualización granular sin reconstruir el HTML.
   */
  async notifyBayStateChanged(bayId: string): Promise<void> {
    if (!this._view || this._fullRefreshPending) { return; }

    const bay = this.stateService.getBayById(bayId);
    if (!bay) { return; }

    const { getStateIndicator } = await import('../utils/stateIndicator.js');
    const stateIndicator = getStateIndicator(bay);

    this._view.webview.postMessage({
      type: 'bayStateChanged',
      bayId: bayId,
      stateClass: stateIndicator.nameClass,
      stateHtml: stateIndicator.html,
    });
  }


  //= MESSAGE HANDLERS

  private readonly messageHandlers = new Map<string, (msg: any) => Promise<void>>([
    ['openBay', async (msg)         => await this.handleOpenBay    (msg.bayId)              ],
    ['closeBay', async (msg)        => await this.handleCloseBay   (msg.bayId)              ],
    ['pinBay', async (msg)          => await this.handlePinBay     (msg.bayId)              ],
    ['unpinBay', async (msg)        => await this.handleUnpinBay   (msg.bayId)              ],
    ['addToChat', async (msg)       => await this.handleAddToChat  (msg.bayId)              ],
    ['contextMenu', async (msg)     => await this.handleContextMenu(msg.bayId)              ],
    ['dropBay', async (msg)         => await this.handleDropBay    (msg)                    ],
    ['fileAction', async (msg)      => await this.handleFileAction (msg.bayId, msg.actionId)],
    ['saveAll', async (_)           => { await vscode.workspace.saveAll(false); }           ],
    ['reorder', async (_)           => void vscode.window.showInformationMessage('Reorder: Coming soon')],
    ['closeGroup', async (msg)      => {
      const group = vscode.window.tabGroups.all.find(g => g.viewColumn === msg.groupId);
      if (group) { await vscode.window.tabGroups.close(group); }
    }],
    ['toggleCompactMode', async (_) => {
      const cfg = vscode.workspace.getConfiguration('bays');
      const current = cfg.get<boolean>('compactMode', false);
      await cfg.update('compactMode', !current, vscode.ConfigurationTarget.Global);
    }],
    ['refresh', async (_)           => this.refresh()],
  ]);

  private async handleMessage(msg: any): Promise<void> {
    const handler = this.messageHandlers.get(msg.type);
    if (handler) {
      await handler(msg);
    } else {
      Logger.warn(`[Bays] Unknown message type: ${msg.type}`);
    }
  }

  private async handleOpenBay(bayId: string): Promise<void> {
    if (this.syncService?.syncActiveState) {
      this.syncService.syncActiveState();
      await new Promise(resolve => setTimeout(resolve, TIMINGS.SYNC_PROPAGATION_DELAY));
    }

    const bay = this.findBay(bayId);
    if (!bay) {
      Logger.warn('[Bays] Bay not found for activation (likely closed): ' + bayId);
      this.refresh();
      return;
    }

    if (bay.state.viewMode === 'preview') {
      this.stateService.setLastMarkdownPreviewBayId(bay.metadata.id);
    }

    try {
      await bay.activate();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      Logger.error('[Bays] Failed to activate bay: ' + bay.metadata.label, err);

      if (errorMsg.includes('not found') ||
          errorMsg.includes('no longer exists') ||
          errorMsg.includes('does not correspond')) {
        Logger.log('[Bays] Bay was closed/removed or mismatch, refreshing to sync state');
        this.refresh();
      }
    }
  }

  private async handleCloseBay(bayId: string): Promise<void> {
    const bay = this.findBay(bayId);
    if (bay) {
      await bay.close();
    }
  }

  private async handlePinBay(bayId: string): Promise<void> {
    const bay = this.findBay(bayId);
    if (!bay) { return; }
    await bay.pin();
    this.stateService.reorderOnPin(bay.metadata.id);
  }

  private async handleUnpinBay(bayId: string): Promise<void> {
    const bay = this.findBay(bayId);
    if (!bay) { return; }
    await bay.unpin();
    this.stateService.reorderOnUnpin(bay.metadata.id);
  }

  private async handleAddToChat(bayId: string): Promise<void> {
    const bay = this.findBay(bayId);
    if (bay) {
      await this.copilotService.addFileToChat(bay.metadata.uri);
    }
  }

  private async handleContextMenu(bayId: string): Promise<void> {
    const bay = this.findBay(bayId);
    if (bay) {
      await this.contextMenu.show(bay);
    }
  }

  private async handleDropBay(msg: any): Promise<void> {
    const { sourceBayId, targetBayId, insertPosition, sourceGroupId, targetGroupId } = msg;
    if (sourceGroupId === targetGroupId) {
      this.dragDropService.reorderWithinGroup(sourceBayId, targetBayId, insertPosition);
      return;
    }

    await this.dragDropService.moveBetweenGroups(sourceBayId, targetGroupId, targetBayId);
  }

  private async handleFileAction(bayId: string, actionId?: string): Promise<void> {
    const bay = this.findBay(bayId);
    if (!bay?.metadata.uri || !actionId) {
      return;
    }

    const isMarkdownToggle = actionId === 'openMarkdownPreview' || actionId === 'editMarkdownSource';
    if (isMarkdownToggle) {
      const newViewMode: BayViewMode = bay.state.viewMode === 'preview' ? 'source' : 'preview';
      bay.state.viewMode = newViewMode;
      Logger.log(`[WebviewProvider] Toggled viewMode for: ${bay.metadata.label} → ${bay.state.viewMode}`);

      if (actionId === 'openMarkdownPreview') {
        this.stateService.setLastMarkdownPreviewBayId(bay.metadata.id);
      } else if (this.stateService.lastMarkdownPreviewBayId === bay.metadata.id) {
        this.stateService.setLastMarkdownPreviewBayId(null);
      }
    }

    const context = { viewMode: bay.state.viewMode };
    const shouldFocus = this.fileActionRegistry.shouldSetFocus(actionId);
    await this.fileActionRegistry.execute(actionId, bay.metadata.uri, context);

    if (isMarkdownToggle || (shouldFocus && !bay.state.isActive)) {
      await bay.activate();
    }

    if (isMarkdownToggle) {
      this.stateService.updateBay(bay);
    }
  }

  private findBay(id: string): Bay | undefined {
    return this.stateService.getBayById(id);
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
