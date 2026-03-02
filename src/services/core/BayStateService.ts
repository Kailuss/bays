import * as vscode from 'vscode';
import { SideTab as Bay } from '../../models/Bay';
import { BayGroup } from '../../models/BayGroup';
import { Logger }       from '../../utils/logger';
import type { BayHierarchyService } from './BayHierarchyService';
import type { DocumentManager } from './DocumentManager';

/**
 * In-memory store for Bays and groups — the "source of truth" for the UI.
 * - `onDidChangeState`: structural changes (open/close/move bays).
 * - `onDidChangeStateSilent`: lightweight changes (e.g. only `isActive`) that don't need
 *   a full webview rebuild.
 * 
 * REFACTORIZACIÓN: Añadido soporte para hierarchy service.
 * @see docs/PLAN_OPTIMIZACION_TABSYNC.md
 * @see services/core/AGENT.md
 */
export class BayStateService {
  private tabs   : Map<string, Bay>      = new Map();
  private groups : Map<number, BayGroup> = new Map();
  private _isBulkLoading                     = false;
  private _onDidChangeState                  = new vscode.EventEmitter<void>();
  readonly onDidChangeState                  = this._onDidChangeState.event;
  private _onDidChangeStateSilent            = new vscode.EventEmitter<void>();
  readonly onDidChangeStateSilent            = this._onDidChangeStateSilent.event;
  private _onDidChangeTabState               = new vscode.EventEmitter<string>();
  readonly onDidChangeTabState               = this._onDidChangeTabState.event;
  
  // Hierarchy service (injected to avoid circular dependency)
  private hierarchyService?: BayHierarchyService;
  
  // Document manager (injected to avoid circular dependency)
  private documentManager?: DocumentManager;

  /** 
   * ID de la última bay que activó el Markdown Preview.
   * Se usa para saber qué bay debe mostrarse como activa cuando el preview está visible.
   */
  private _lastMarkdownPreviewTabId: string | null = null;

  get lastMarkdownPreviewTabId(): string | null {
    return this._lastMarkdownPreviewTabId;
  }

  setLastMarkdownPreviewTabId(tabId: string | null): void {
    this._lastMarkdownPreviewTabId = tabId;
  }

  /**
   * Notifica cambios estructurales en el estado.
   * Usado por servicios especializados para disparar actualización de UI.
   */
  notifyChange(): void {
    if (!this._isBulkLoading) {
      this._onDidChangeState.fire();
    }
  }

  /**
   * Inyecta el hierarchy service para evitar dependencia circular.
   * Llamado desde BaySyncService después de crear BayHierarchyService.
   */
  setHierarchyService(service: BayHierarchyService): void {
    this.hierarchyService = service;
  }
  
  /**
   * Inyecta el document manager para gestión centralizada de documentos.
   * Llamado desde BaySyncService después de crear DocumentManager.
   */
  setDocumentManager(manager: DocumentManager): void {
    this.documentManager = manager;
  }

  //- Bay management

  // Add a bay (or update if it already exists in the group).
  addTab(tab: Bay): void {
    this.tabs.set(tab.metadata.id, tab);

    const group = this.groups.get(tab.state.groupId);
    if (group) {
      const existsInGroup = group.bays.find(t => t.metadata.id === tab.metadata.id);
      if (!existsInGroup) {
        group.bays.push(tab);
      }
    }
    
    // Create/update document if this is a parent bay with URI
    if (this.documentManager && tab.metadata.uri && !tab.metadata.parentId) {
      const document = this.documentManager.getOrCreateDocument(
        tab.metadata.uri,
        tab.metadata.languageId || 'plaintext',
        tab.metadata.label,
        tab.metadata.fileExtension || ''
      );
      this.documentManager.associateParentTab(document.documentId, tab.metadata.id);
    }
    
    // Associate child bay with document if parent exists
    if (this.documentManager && tab.metadata.parentId && tab.metadata.uri) {
      const parentTab = this.tabs.get(tab.metadata.parentId);
      if (parentTab?.metadata.uri) {
        const document = this.documentManager.getDocumentByUri(parentTab.metadata.uri);
        if (document) {
          this.documentManager.associateChildTab(document.documentId, tab.metadata.id);
        }
      }
    }

    if (!this._isBulkLoading) { this._onDidChangeState.fire(); }
  }

  // Remove a bay by id and clean it from its group.
  // ✅ NUEVO: Desregistra children del parent si es necesario
  removeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) {
      return;
    }
    
    // Si es child bay, desregistrar del parent
    if (tab.metadata.parentId && this.hierarchyService) {
      this.hierarchyService.unregisterChild(id, tab.metadata.parentId);
    }
    
    // Si es parent bay con children, eliminar children primero
    if (tab.state.hasChildren && this.hierarchyService) {
      const children = this.hierarchyService.getChildren(id);
      for (const child of children) {
        this.removeTabInternal(child.metadata.id);
      }
    }
    
    this.removeTabInternal(id);
  }

  // Método interno para eliminar sin lógica de jerarquía (evita recursión)
  private removeTabInternal(id: string): void {
    const bay = this.tabs.get(id);
    if (bay) {
      const group = this.groups.get(bay.state.groupId);
      if (group) {
        group.bays = group.bays.filter(t => t.metadata.id !== id);
      }
      
      // Cleanup document associations
      if (this.documentManager) {
        if (bay.metadata.parentId) {
          // Desasociar child bay del documento
          const parentBay = this.tabs.get(bay.metadata.parentId);
          if (parentBay?.metadata.uri) {
            const document = this.documentManager.getDocumentByUri(parentBay.metadata.uri);
            if (document) {
              this.documentManager.dissociateChildTab(document.documentId, id);
            }
          }
        } else if (bay.metadata.uri) {
          // Desasociar parent bay del documento
          const document = this.documentManager.getDocumentByUri(bay.metadata.uri);
          if (document) {
            this.documentManager.dissociateParentTab(document.documentId);
          }
        }
      }

      this.tabs.delete(id);
      this._onDidChangeState.fire();
    }
  }

  // Update a bay in-place (both the map and its group array).
  updateTab(tab: Bay): void {
    this.tabs.set(tab.metadata.id, tab);

    const group = this.groups.get(tab.state.groupId);
    if (group) {
      const index = group.bays.findIndex(t => t.metadata.id === tab.metadata.id);
      if (index !== -1) {
        group.bays[index] = tab;
      }
    }

    this._onDidChangeState.fire();
  }

  // Update a bay without triggering tree refresh (for silent state updates like isActive).
  updateTabSilent(tab: Bay): void {
    this.tabs.set(tab.metadata.id, tab);

    const group = this.groups.get(tab.state.groupId);
    if (group) {
      const index = group.bays.findIndex(t => t.metadata.id === tab.metadata.id);
      if (index !== -1) {
        group.bays[index] = tab;
      }
    }
    this._onDidChangeStateSilent.fire();
  }

  // Update a bay's diagnostic/git state and notify for animation.
  updateTabStateWithAnimation(tab: Bay): void {
    this.tabs.set(tab.metadata.id, tab);

    const group = this.groups.get(tab.state.groupId);
    if (group) {
      const index = group.bays.findIndex(t => t.metadata.id === tab.metadata.id);
      if (index !== -1) {
        group.bays[index] = tab;
      }
    }
    
    // Solo dispara el evento de cambio de estado para la animación
    // NO dispara _onDidChangeState para evitar rebuild completo
    this._onDidChangeTabState.fire(tab.metadata.id);
  }

  /**
   * Fetch a bay by ID (canonical method name per AGENT.md).
   * @returns Bay instance or undefined if not found
   */
  fetchBayById(id: string): Bay | undefined {
    return this.tabs.get(id);
  }

  /**
   * @deprecated Use fetchBayById() for consistency with AGENT.md
   */
  getTab(id: string): Bay | undefined {
    return this.tabs.get(id);
  }

  getAllTabs(): Bay[] {
    return Array.from(this.tabs.values());
  }

  getTabsInGroup(groupId: number): Bay[] {
    const group = this.groups.get(groupId);
    return group ? [...group.bays] : [];
  }

  // Replace all bays with a new set (used during full sync).
  replaceTabs(tabs: Bay[]): void {
    this._isBulkLoading = true;
    this.tabs.clear();

    // Clear bays from all groups
    this.groups.forEach(group => {
      group.bays = [];
    });

    tabs.forEach(tab => this.addTab(tab));
    this._isBulkLoading = false;
    this._onDidChangeState.fire();
  }

  //- Group management

  addGroup(group: BayGroup): void {
    this.groups.set(group.id, group);
    this._onDidChangeState.fire();
  }

  removeGroup(id: number): void {
    this.groups.delete(id);
    this._onDidChangeState.fire();
  }

  getGroup(id: number): BayGroup | undefined {
    return this.groups.get(id);
  }

  getGroups(): BayGroup[] {
    return Array.from(this.groups.values());
  }

  setActiveGroup(id: number): void {
    this.groups.forEach(group => {
      group.isActive = group.id === id;
    });
    this._onDidChangeState.fire();
  }

  //- Search

  // Buscar una bay por su URI; opcionalmente limitar al grupo indicado.
  findTabByUri(uri: vscode.Uri, groupId?: number): Bay | undefined {
    const uriString = uri.toString();

    for (const tab of this.tabs.values()) {
      if (tab.metadata.uri?.toString() === uriString) {
        if (groupId === undefined || tab.state.groupId === groupId) {
          return tab;
        }
      }
    }

    return undefined;
  }

  //- Pin / unpin reordering

  /**
   * Reordena una bay después de pin/unpin.
   * Mueve la bay justo después de la última bay pinneada en su grupo.
   */
  private reorderAfterPinChange(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) { return; }

    const group = this.groups.get(tab.state.groupId);
    if (!group) { return; }

    // Remove the bay from its current position
    const idx = group.bays.findIndex(t => t.metadata.id === tabId);
    if (idx === -1) { return; }
    group.bays.splice(idx, 1);

    // Find the insertion point: after the last pinned bay
    let insertAt = 0;
    for (let i = 0; i < group.bays.length; i++) {
      if (group.bays[i].state.isPinned) { insertAt = i + 1; }
    }

    group.bays.splice(insertAt, 0, tab);
    this._onDidChangeState.fire();
  }

  /**
   * Moves a bay to just after the last pinned bay in its group.
   * Called after the bay is pinned so it visually moves up.
   */
  reorderOnPin(tabId: string): void {
    this.reorderAfterPinChange(tabId);
  }

  /**
   * Moves a bay to the first position among non-pinned bays in its group.
   * Called after the bay is unpinned.
   */
  reorderOnUnpin(tabId: string): void {
    this.reorderAfterPinChange(tabId);
  }

  //- Utilities

  clear(): void {
    this.tabs.clear();
    this.groups.clear();
    this._onDidChangeState.fire();
  }

  getStats(): { tabs: number; groups: number } {
    return {
      tabs: this.tabs.size,
      groups: this.groups.size,
    };
  }
}
