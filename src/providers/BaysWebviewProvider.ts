import * as vscode from 'vscode';
import { getConfiguration }     from '../constants/styles'; //
import { TIMINGS }              from '../constants/timings';
import { Bay }                  from '../models/Bay';
import { BayHelpers }           from '../models/BayHelpers';
import { BayGroup }              from '../models/BayGroup';
import { BayStateService }      from '../services/core/BayStateService';
import { BayIconManager }       from '../services/ui/BayIconManager';
import { CopilotService }       from '../services/integration/CopilotService';
import { BayDragDropService }   from '../services/ui/BayDragDropService';
import { FileActionRegistry }   from '../services/registry/FileActionRegistry';
import { Logger }               from '../utils/logger';
import { BaysHtmlBuilder }      from './BaysHtmlBuilder';
import type { PendingIcon }     from './html';
import { BayContextMenu }       from './BayContextMenu';
import { GroupActions }         from './GroupActions';
import type {
  WebviewToHostMessage,
  ContextMenuRequestMessage,
  DropBayMessage,
  ShowContextMenuMessage,
  UpdateActiveBayMessage,
  UpdateBayLabelMessage,
  UpdateIconsMessage,
  BayStateChangedMessage,
} from '../shared/protocol';

/**
 * Un handler por cada `type` del protocolo webview→host. El compilador
 * garantiza cobertura total: añadir un mensaje a `WebviewToHostMessage`
 * rompe la compilación hasta que su handler exista aquí.
 */
type MessageHandlers = {
  [K in WebviewToHostMessage['type']]: (
    msg: Extract<WebviewToHostMessage, { type: K }>
  ) => Promise<void>;
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
  private readonly groupActions: GroupActions;

  constructor(
    private readonly _extensionUri  : vscode.Uri,
    private readonly stateService   : BayStateService,
    private readonly copilotService : CopilotService,
    private readonly iconManager    : BayIconManager,
    private readonly context        : vscode.ExtensionContext,
    private readonly dragDropService: BayDragDropService,
    private readonly fileActionRegistry: FileActionRegistry,
    groupActions: GroupActions,
  ) {
    this.htmlBuilder  = new BaysHtmlBuilder(_extensionUri, iconManager, context, fileActionRegistry);
    this.contextMenu  = new BayContextMenu(stateService, copilotService);
    this.groupActions = groupActions;
    context.subscriptions.push(
      // Full rebuild on structural changes
      stateService.onDidChangeState(() => this.refresh()),
      // Partial update for lightweight changes (active bay only)
      stateService.onDidChangeStateSilent(() => this.refreshSilent()),
      // Notify bay state changes for animation
      stateService.onDidChangeBayState((bayId: string) => void this.notifyBayStateChanged(bayId)),
      // Partial update when a webview's title is rewritten at runtime (Claude Code, …)
      stateService.onDidChangeBayLabel((bayId: string) => this.notifyBayLabelChanged(bayId)),
      // Rebuild when workspace folders change (updates header title)
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
    );
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

    // Frontera de confianza: lo que llega por postMessage es `any`; a partir
    // de aquí todo el dispatch va tipado contra el protocolo compartido.
    webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg as WebviewToHostMessage));

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

      const { html, pendingIcons } = await this.htmlBuilder.buildHtml({
        webview        : this._view.webview,
        groups,
        getBaysInGroup : (groupId) => this.stateService.getBaysByGroupId(groupId),
        compactMode        : config.compactMode,
        showPath           : config.showFilePath,
        copilotReady,
        enableDragDrop     : config.enableDragDrop,
        enableHoverActions : config.enableHoverActions,
        initialLoad        : !this._initialLoadComplete,
      });

      this._view.webview.html = html;
      this._initialLoadComplete = true;

      // Also update the native VS Code panel title
      this._view.title = this.getWorkspaceName();

      // Resolve icons that missed the cache in parallel and patch them in
      // (first paint isn't blocked on disk I/O — rows render with a placeholder)
      void this.patchIcons(pendingIcons);

      Logger.log('[Bays] HTML assigned to webview');
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
    } satisfies UpdateActiveBayMessage);
  }

  /**
   * Resuelve en paralelo los iconos que fallaron la caché durante el render
   * síncrono y los envía al webview para parchear cada `.bay-icon` en su sitio.
   * Así el primer pintado no se bloquea esperando I/O de disco por cada bay.
   */
  private async patchIcons(pending: PendingIcon[]): Promise<void> {
    if (!this._view || pending.length === 0) { return; }

    const view = this._view;
    const resolved = await Promise.all(
      pending.map(async (p) => ({
        bayId: p.bayId,
        html : await this.htmlBuilder.resolveIconHtml(p),
      })),
    );
    // Null = sin mejora sobre el placeholder ya pintado (p.ej. el icono de la
    // extensión dueña de un webview no se pudo leer): esa bay no se parchea.
    const icons = resolved.filter((p): p is { bayId: string; html: string } => p.html !== null);
    if (icons.length === 0) { return; }

    // Bail out if a full rebuild replaced the view/DOM while we were resolving
    if (this._view !== view || this._fullRefreshPending) { return; }

    view.webview.postMessage({ type: 'updateIcons', icons } satisfies UpdateIconsMessage);
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
    } satisfies BayStateChangedMessage);
  }

  /**
   * Notifica al webview que el NOMBRE de una bay ha cambiado. Envía el label en
   * crudo; el cliente lo aplica como texto (sin HTML) sobre `.bay-name`, dejando
   * intactos los badges (pin) que le siguen.
   */
  private notifyBayLabelChanged(bayId: string): void {
    if (!this._view || this._fullRefreshPending) { return; }

    const bay = this.stateService.getBayById(bayId);
    if (!bay) { return; }

    this._view.webview.postMessage({
      type: 'updateBayLabel',
      bayId,
      label: bay.metadata.label,
    } satisfies UpdateBayLabelMessage);
  }


  //= MESSAGE HANDLERS

  private readonly messageHandlers: MessageHandlers = {
    openBay        : async (msg) => await this.handleOpenBay     (msg.bayId),
    closeBay       : async (msg) => await this.handleCloseBay    (msg.bayId),
    closeVariant   : async (msg) => await this.handleCloseVariant(msg.bayId),
    addToChat      : async (msg) => await this.handleAddToChat   (msg.bayId),
    contextMenu    : async (msg) => this.handleContextMenu(msg),
    menuAction     : async (msg) => await this.handleMenuAction(msg.bayId, msg.actionId),
    dropBay        : async (msg) => await this.handleDropBay    (msg),
    fileAction     : async (msg) => await this.handleFileAction (msg.bayId, msg.actionId),
    renameGroup    : async (msg) => await this.handleGroupAction(msg.groupId, g => this.groupActions.rename   (g)),
    setGroupColor  : async (msg) => await this.handleGroupAction(msg.groupId, g => this.groupActions.pickColor(g)),
    toggleGroupLock: async (msg) => await this.handleGroupAction(msg.groupId, g => this.groupActions.toggleLock(g)),
  };

  private async handleMessage(msg: WebviewToHostMessage): Promise<void> {
    const handler = this.messageHandlers[msg.type] as
      | ((m: WebviewToHostMessage) => Promise<void>)
      | undefined;
    if (handler) {
      await handler(msg);
    } else {
      Logger.warn(`[Bays] Unknown message type: ${(msg as { type?: string }).type}`);
    }
  }

  private async handleOpenBay(bayId: string): Promise<void> {
    const bay = this.findBay(bayId);
    if (!bay) {
      Logger.warn('[Bays] Bay not found for activation (likely closed): ' + bayId);
      this.refresh();
      return;
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

  private async handleCloseVariant(bayId: string): Promise<void> {
    const variant = this.findBay(bayId);
    if (!variant) {
      Logger.warn('[Bays] Variant bay not found: ' + bayId);
      this.refresh();
      return;
    }
    
    Logger.log(`[Bays] === CLOSE VARIANT START: ${variant.metadata.label} ===`);
    
    // Verify it's actually a variant (has parentId)
    if (!variant.metadata.sourceBayId) {
      Logger.warn('[Bays] Not a variant (no parentId), closing normally: ' + bayId);
      await variant.close();
      return;
    }

    // Get parent bay BEFORE any operations
    const parent = this.stateService.getBayById(variant.metadata.sourceBayId);
    if (!parent) {
      Logger.warn('[Bays] Parent bay not found: ' + variant.metadata.sourceBayId);
      await variant.close();
      return;
    }

    // Get hierarchy service
    const hierarchyService = this.stateService.getHierarchyService();
    if (!hierarchyService) {
      Logger.warn('[Bays] Hierarchy service not available');
      await variant.close();
      return;
    }

    // Find the variant's native tab (diff)
    const variantNativeTab = BayHelpers.findNativeTab(variant.metadata, variant.state);
    if (!variantNativeTab) {
      Logger.warn('[Bays] Variant native tab not found');
      this.refresh();
      return;
    }

    // Verify it's a diff tab
    if (!(variantNativeTab.input instanceof vscode.TabInputTextDiff)) {
      Logger.warn('[Bays] Not a diff tab, closing normally');
      await variant.close();
      return;
    }

    Logger.log(`[Bays] Variant diff URIs - original: ${variantNativeTab.input.original.toString()}`);
    Logger.log(`[Bays] Variant diff URIs - modified: ${variantNativeTab.input.modified.toString()}`);
    
    // === FASE 0: PREVENCIÓN DE EVENTOS ===
    // Marcar AMBOS (variant Y parent) como cierres intencionales
    // Esto previene que BayEventService procese los eventos cuando VS Code los dispare
    Logger.log(`[Bays] PHASE 0: Marking variant and parent as intentional closes`);
    this.stateService.markAsIntentionalClose(variant.metadata.id);
    this.stateService.markAsIntentionalClose(parent.metadata.id);

    try {
      // === FASE 1: ACTUALIZAR ESTADO INTERNO ===
      // Actualizar jerarquía: desregistrar variant del parent
      Logger.log(`[Bays] PHASE 1: Updating internal state`);
      hierarchyService.detachVariantFromParentBay(variant.metadata.id, parent.metadata.id);

      // Remover variant del estado interno (sin procesar jerarquía, ya lo hicimos)
      this.stateService.removeBayFromState(variant.metadata.id);
      Logger.log(`[Bays] Variant removed from state, parent childrenCount: ${parent.state.variantCount}`);

      // === FASE 2: OPERACIÓN FÍSICA ===
      // Cerrar el diff tab (VS Code puede cerrar también el parent)
      Logger.log(`[Bays] PHASE 2: Closing diff tab physically`);
      await vscode.window.tabGroups.close(variantNativeTab, true);
      Logger.log(`[Bays] Close command completed`);

      // === FASE 3: VERIFICAR REALIDAD FÍSICA Y CORREGIR ===
      // Dar un momento a VS Code para procesar completamente
      await new Promise(resolve => setTimeout(resolve, 100));

      Logger.log(`[Bays] PHASE 3: Verifying physical state`);

      // Verificar si el parent todavía existe físicamente en VS Code
      const parentStillOpen = BayHelpers.findNativeTab(parent.metadata, parent.state);

      if (!parentStillOpen && parent.metadata.uri) {
        // Parent fue cerrado por VS Code (side effect del cierre del diff)
        Logger.log(`[Bays] Parent was closed by VS Code, reopening: ${parent.metadata.label}`);

        // Reabrir el parent en la misma posición
        await vscode.window.showTextDocument(parent.metadata.uri, {
          viewColumn: parent.state.viewColumn,
          preview: false,
          preserveFocus: true
        });

        Logger.log(`[Bays] Parent reopened successfully`);
      } else if (parentStillOpen) {
        Logger.log(`[Bays] Parent still open, no reopening needed`);
      } else {
        Logger.log(`[Bays] Parent has no URI, cannot reopen`);
      }
    } catch (error) {
      Logger.error(`[Bays] Close variant failed for ${variant.metadata.label}`, error);
    } finally {
      // === FASE 4: LIMPIEZA (SIEMPRE) ===
      // El polling se instala también si el cierre o la reapertura fallaron:
      // sin este finally, un showTextDocument rechazado dejaba los markers de
      // intentionalCloses pegados para siempre y todos los cierres externos
      // futuros de estas bays se ignoraban en silencio.
      // Una vez confirmado que el parent sigue abierto como native tab, VS Code
      // terminó de procesar los eventos en cascada. Máximo 3000ms de safety net.
      Logger.log(`[Bays] PHASE 4: Polling until VS Code events settle`);
      const POLL_INTERVAL = 150;
      const MAX_WAIT      = 3000;
      let elapsed         = 0;
      const parentMeta    = parent.metadata;
      const parentState   = parent.state;

      const poll = setInterval(() => {
        elapsed += POLL_INTERVAL;
        const parentNativeTab = BayHelpers.findNativeTab(parentMeta, parentState);
        const settled         = !!parentNativeTab || elapsed >= MAX_WAIT;

        if (settled) {
          clearInterval(poll);
          this.stateService.clearIntentionalClose(variant.metadata.id);
          this.stateService.clearIntentionalClose(parent.metadata.id);
          Logger.log(`[Bays] Markers cleared after ${elapsed}ms (native tab ${parentNativeTab ? 'confirmed open' : 'not found — max wait reached'})`);
        }
      }, POLL_INTERVAL);

      // Notificar cambio de UI
      this.stateService.notifyChange();
    }

    Logger.log(`[Bays] === CLOSE VARIANT END: ${variant.metadata.label} ===`);
  }

  private async handleAddToChat(bayId: string): Promise<void> {
    const bay = this.findBay(bayId);
    if (bay) {
      await this.copilotService.addFileToChat(bay);
    }
  }

  /**
   * Responde al clic derecho con el modelo del menú. Dibujarlo es cosa del
   * webview (`BaysContextMenu`): sólo él sabe dónde está el cursor y sólo ahí
   * puede aparecer un menú bajo el puntero.
   */
  private handleContextMenu(msg: ContextMenuRequestMessage): void {
    if (!this._view) { return; }

    const bay = this.findBay(msg.bayId);
    if (!bay) { return; }

    const items = this.contextMenu.build(bay);
    if (items.length === 0) { return; }

    this._view.webview.postMessage({
      type : 'showContextMenu',
      bayId: bay.metadata.id,
      x    : msg.x,
      y    : msg.y,
      items,
    } satisfies ShowContextMenuMessage);
  }

  private async handleMenuAction(bayId: string, actionId: string): Promise<void> {
    const bay = this.findBay(bayId);
    if (!bay || !actionId) { return; }
    await this.contextMenu.execute(actionId, bay);
  }

  //= GRUPOS

  /**
   * Resuelve el grupo, ejecuta la acción y repinta sólo si cambió algo.
   * Compartido por los tres botones de la cabecera y por el doble clic.
   */
  private async handleGroupAction(
    groupId: number,
    action: (group: BayGroup) => Promise<boolean>,
  ): Promise<void> {
    const group = this.stateService.getGroup(groupId);
    if (!group) {
      Logger.warn(`[Bays] Group not found: ${groupId}`);
      return;
    }

    if (await action(group)) { this.stateService.refreshGroupCustomizations(); }
  }

  private async handleDropBay(msg: DropBayMessage): Promise<void> {
    const { sourceBayId, targetBayId, insertPosition, sourceGroupId, targetGroupId } = msg;
    if (sourceGroupId === targetGroupId) {
      // The webview already committed the DOM move; only reconcile the model.
      // If the reorder was rejected, refresh to restore the authoritative order.
      // A local reorder always carries target+position (null only happens on
      // cross-group drops); a malformed message just restores the DOM.
      if (!targetBayId || !insertPosition) { this.refresh(); return; }
      const ok = this.dragDropService.reorderWithinGroup(sourceBayId, targetBayId, insertPosition);
      if (!ok) { this.refresh(); }
      return;
    }

    // A successful move closes+reopens the bay in the target group, which fires
    // native tab events and rebuilds. If it's rejected (e.g. webview with no
    // URI, or a pinned bay), nothing rebuilds — refresh to restore the DOM,
    // otherwise the client-faded block would just vanish.
    const moved = await this.dragDropService.moveBetweenGroups(sourceBayId, targetGroupId, targetBayId ?? undefined);
    if (!moved) { this.refresh(); }
  }

  private async handleFileAction(bayId: string, actionId: string): Promise<void> {
    const bay = this.findBay(bayId);
    if (!bay?.metadata.uri || !actionId) {
      return;
    }

    // The markdown "Open Preview" action needs no special-casing here: the
    // preview opens as its own tab, arrives as a variant bay through the normal
    // tab events, and the resulting structural rebuild hides the button.
    const shouldFocus = this.fileActionRegistry.shouldSetFocus(actionId);
    await this.fileActionRegistry.execute(actionId, bay.metadata.uri, { viewMode: bay.state.viewMode });

    if (shouldFocus && !bay.state.isActive) {
      await bay.activate();
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

}
