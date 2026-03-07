import * as vscode from 'vscode';
import { Bay } from '../../models/Bay';
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
 */
export class BayStateService {
  private bays   : Map<string, Bay>      = new Map();
  private groups : Map<number, BayGroup> = new Map();
  private _isBulkLoading                     = false;
  private _onDidChangeState                  = new vscode.EventEmitter<void>();
  readonly onDidChangeState                  = this._onDidChangeState.event;
  private _onDidChangeStateSilent            = new vscode.EventEmitter<void>();
  readonly onDidChangeStateSilent            = this._onDidChangeStateSilent.event;
  private _onDidChangeBayState               = new vscode.EventEmitter<string>();
  readonly onDidChangeBayState               = this._onDidChangeBayState.event;

  // Hierarchy service (injected to avoid circular dependency)
  private hierarchyService?: BayHierarchyService;

  // Document manager (injected to avoid circular dependency)
  private documentManager?: DocumentManager;

  /**
   * Tracking de cierres intencionales con contador de referencias.
   * Cuando cerramos variants programáticamente, marcamos el ID aquí.
   * - markAsIntentionalClose: incrementa el contador (varios variants pueden marcar el mismo parent)
   * - clearIntentionalClose: decrementa; solo se elimina cuando llega a 0
   * - isIntentionalClose: true si contador > 0
   * Esto evita que el primer timeout limpie el marcador antes de que llegue
   * el evento de VS Code del segundo cierre.
   */
  private intentionalCloses = new Map<string, number>();

  /**
   * ID de la última bay que activó el Markdown Preview.
   * Se usa para saber qué bay debe mostrarse como activa cuando el preview está visible.
   */
  private _lastMarkdownPreviewBayId: string | null = null;

  get lastMarkdownPreviewBayId(): string | null {
    return this._lastMarkdownPreviewBayId;
  }

  setLastMarkdownPreviewBayId(bayId: string | null): void {
    this._lastMarkdownPreviewBayId = bayId;
  }

  /**
   * Marca un bay ID como cierre intencional.
   * Usado cuando cerramos una bay programáticamente para evitar
   * procesar el evento de cierre que VS Code disparará después.
   */
  markAsIntentionalClose(bayId: string): void {
    const current = this.intentionalCloses.get(bayId) ?? 0;
    this.intentionalCloses.set(bayId, current + 1);
    Logger.log(`[BayState] Marked as intentional close: ${bayId} (count: ${current + 1})`);
  }

  /**
   * Verifica si un bay ID está marcado como cierre intencional.
   */
  isIntentionalClose(bayId: string): boolean {
    return (this.intentionalCloses.get(bayId) ?? 0) > 0;
  }

  /**
   * Remueve un bay ID del tracking de cierres intencionales.
   * Debe llamarse después de procesar el cierre para limpiar el estado.
   */
  clearIntentionalClose(bayId: string): void {
    const current = this.intentionalCloses.get(bayId) ?? 0;
    if (current <= 1) {
      this.intentionalCloses.delete(bayId);
      Logger.log(`[BayState] Cleared intentional close: ${bayId}`);
    } else {
      this.intentionalCloses.set(bayId, current - 1);
      Logger.log(`[BayState] Decremented intentional close: ${bayId} (count: ${current - 1})`);
    }
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
   * Obtiene el hierarchy service.
   * Retorna undefined si aún no ha sido inyectado.
   */
  getHierarchyService(): BayHierarchyService | undefined {
    return this.hierarchyService;
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
  addBay(bay: Bay): void {
    this.bays.set(bay.metadata.id, bay);

    const group = this.groups.get(bay.state.groupId);
    if (group) {
      const existsInGroup = group.bays.find(t => t.metadata.id === bay.metadata.id);
      if (!existsInGroup) {
        group.bays.push(bay);
      }
    }

    // Create/update document if this is a parent bay with URI
    if (this.documentManager && bay.metadata.uri && !bay.metadata.sourceBayId) {
      const document = this.documentManager.getOrCreateDocument(
        bay.metadata.uri,
        bay.metadata.languageId || 'plaintext',
        bay.metadata.label,
        bay.metadata.fileExtension || ''
      );
      this.documentManager.associateVariant(document.documentId, bay.metadata.id);
    }

    // Associate child bay with document if parent exists
    if (this.documentManager && bay.metadata.sourceBayId && bay.metadata.uri) {
      const parentBay = this.bays.get(bay.metadata.sourceBayId);
      if (parentBay?.metadata.uri) {
        const document = this.documentManager.getDocumentByUri(parentBay.metadata.uri);
        if (document) {
          this.documentManager.associateVariant(document.documentId, bay.metadata.id);
        }
      }
    }

    if (!this._isBulkLoading) { this._onDidChangeState.fire(); }
  }

  // Remove a bay by id and clean it from its group.
  // ✅ NUEVO: Desregistra children del parent si es necesario
  removeBay(id: string): void {
    const bay = this.bays.get(id);
    if (!bay) {
      return;
    }
    
    // Si es child bay, desregistrar del parent
    if (bay.metadata.sourceBayId && this.hierarchyService) {
      this.hierarchyService.detachVariantFromParentBay(id, bay.metadata.sourceBayId);
    }
    
    // Si es parent bay con children, eliminar children primero
    if (bay.state.hasVariant && this.hierarchyService) {
      const children = this.hierarchyService.fetchVariants(id);
      for (const child of children) {
        this.removeBayInternal(child.metadata.id);
      }
    }
    
    this.removeBayInternal(id);
  }

  /**
   * Remueve una bay del estado sin procesar jerarquía.
   * SOLO usar cuando la jerarquía ya fue actualizada manualmente.
   * Para cierres normales, usar removeBay() que maneja jerarquía automáticamente.
   */
  removeBayFromState(id: string): void {
    this.removeBayInternal(id);
  }

  // Método interno para eliminar sin lógica de jerarquía (evita recursión)
  private removeBayInternal(id: string): void {
    const bay = this.bays.get(id);
    if (bay) {

      const group = this.groups.get(bay.state.groupId);

      if (group) { group.bays = group.bays.filter(t => t.metadata.id !== id); }

      // Cleanup document associations
      if (this.documentManager) {
        if (bay.metadata.sourceBayId) {

          // Desasociar child bay del documento
          const parentBay = this.bays.get(bay.metadata.sourceBayId);
          if (parentBay?.metadata.uri) {
            const document = this.documentManager.getDocumentByUri(parentBay.metadata.uri);
            if (document) { this.documentManager.dissociateVariant(document.documentId, id); }
          }

        } else if (bay.metadata.uri) {

          // Desasociar parent bay del documento
          const document = this.documentManager.getDocumentByUri(bay.metadata.uri);
          if (document) { this.documentManager.dissociateVariant(document.documentId, id); }

        }
      }

      this.bays.delete(id);
      this._onDidChangeState.fire();
    }
  }

  // Update a bay in-place (both the map and its group array).
  updateBay(bay: Bay): void {
    this.bays.set(bay.metadata.id, bay);

    const group = this.groups.get(bay.state.groupId);
    if (group) {
      const index = group.bays.findIndex(t => t.metadata.id === bay.metadata.id);
      if (index !== -1) {
        group.bays[index] = bay;
      }
    }

    this._onDidChangeState.fire();
  }

  // Update a bay without triggering tree refresh (for silent state updates like isActive).
  updateBaySilent(bay: Bay): void {
    this.bays.set(bay.metadata.id, bay);

    const group = this.groups.get(bay.state.groupId);
    if (group) {
      const index = group.bays.findIndex(t => t.metadata.id === bay.metadata.id);
      if (index !== -1) {
        group.bays[index] = bay;
      }
    }
    this._onDidChangeStateSilent.fire();
  }

  // Update a bay's diagnostic/git state and notify for animation.
  updateBayStateWithAnimation(bay: Bay): void {
    this.bays.set(bay.metadata.id, bay);

    const group = this.groups.get(bay.state.groupId);
    if (group) {
      const index = group.bays.findIndex(t => t.metadata.id === bay.metadata.id);
      if (index !== -1) {
        group.bays[index] = bay;
      }
    }
    
    // Solo dispara el evento de cambio de estado para la animación
    // NO dispara _onDidChangeState para evitar rebuild completo
    this._onDidChangeBayState.fire(bay.metadata.id);
  }

  /**
   * Get a bay by ID (canonical method name per AGENT.md).
   * @returns Bay instance or undefined if not found
   */
  getBayById(id: string): Bay | undefined {
    return this.bays.get(id);
  }

  getAllBays(): Bay[] {
    return Array.from(this.bays.values());
  }

  getBaysByGroupId(groupId: number): Bay[] {
    const group = this.groups.get(groupId);
    return group ? [...group.bays] : [];
  }

  // Replace all bays with a new set (used during full sync).
  replaceBays(bays: Bay[]): void {
    this._isBulkLoading = true;
    this.bays.clear();

    // Clear bays from all groups
    this.groups.forEach(group => {
      group.bays = [];
    });

    bays.forEach(bay => this.addBay(bay));
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
  findBayByUri(uri: vscode.Uri, groupId?: number): Bay | undefined {
    const uriString = uri.toString();

    for (const bay of this.bays.values()) {
      if (bay.metadata.uri?.toString() === uriString) {
        if (groupId === undefined || bay.state.groupId === groupId) {
          return bay;
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
  private reorderAfterPinChange(bayId: string): void {
    const bay = this.bays.get(bayId);
    if (!bay) { return; }

    const group = this.groups.get(bay.state.groupId);
    if (!group) { return; }

    // Remove the bay from its current position
    const idx = group.bays.findIndex(t => t.metadata.id === bayId);
    if (idx === -1) { return; }
    group.bays.splice(idx, 1);

    // Find the insertion point: after the last pinned bay
    let insertAt = 0;
    for (let i = 0; i < group.bays.length; i++) {
      if (group.bays[i].state.isPinned) { insertAt = i + 1; }
    }

    group.bays.splice(insertAt, 0, bay);
    this._onDidChangeState.fire();
  }

  /**
   * Moves a bay to just after the last pinned bay in its group.
   * Called after the bay is pinned so it visually moves up.
   */
  reorderOnPin(bayId: string): void {
    this.reorderAfterPinChange(bayId);
  }

  /**
   * Moves a bay to the first position among non-pinned bays in its group.
   * Called after the bay is unpinned.
   */
  reorderOnUnpin(bayId: string): void {
    this.reorderAfterPinChange(bayId);
  }

  //- Utilities

  clear(): void {
    this.bays.clear();
    this.groups.clear();
    this._onDidChangeState.fire();
  }

  getStats(): { bays: number; groups: number } {
    return {
      bays: this.bays.size,
      groups: this.groups.size,
    };
  }
}
