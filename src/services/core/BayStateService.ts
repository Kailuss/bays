import * as vscode from 'vscode';
import { Bay } from '../../models/Bay';
import { BayGroup, createTabGroup } from '../../models/BayGroup';
import { Logger }       from '../../utils/logger';
import type { BayHierarchyService } from './BayHierarchyService';
import type { GroupCustomizationService } from '../ui/GroupCustomizationService';

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
  private _onDidChangeBayLabel               = new vscode.EventEmitter<string>();
  readonly onDidChangeBayLabel               = this._onDidChangeBayLabel.event;

  // Hierarchy service (injected to avoid circular dependency)
  private hierarchyService?: BayHierarchyService;

  // Group customizations (name/color/lock) — injected from extension.ts, which
  // owns the ExtensionContext the service persists to.
  private groupCustomization?: GroupCustomizationService;

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
   * Notifica un cambio ligero de solo estado activo (isActive).
   * Dispara el emisor "silent" para que el provider haga una actualización
   * parcial por postMessage (toggle de la clase .active) en lugar de
   * reconstruir todo el HTML del webview.
   */
  notifyActiveChange(): void {
    if (!this._isBulkLoading) {
      this._onDidChangeStateSilent.fire();
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
   * Inyecta el servicio de personalización de grupos y lo aplica a los grupos
   * ya presentes (la inyección ocurre antes del primer sync, pero también puede
   * llegar después si el orden de arranque cambia).
   */
  setGroupCustomizationService(service: GroupCustomizationService): void {
    this.groupCustomization = service;
    this.applyGroupCustomizations();
  }

  getGroupCustomizationService(): GroupCustomizationService | undefined {
    return this.groupCustomization;
  }

  /**
   * Reaplica nombre, color y bloqueo sobre TODOS los grupos del mapa.
   * Necesario tras cada sync (los grupos se reconstruyen desde la API nativa,
   * que no sabe nada de la personalización) y tras cada cambio del usuario.
   */
  applyGroupCustomizations(): void {
    if (!this.groupCustomization) { return; }
    for (const group of this.groups.values()) { this.groupCustomization.apply(group); }
  }

  /**
   * Reaplica la personalización y repinta. Nombre, color y bloqueo cambian el
   * markup de la cabecera y de los botones de cierre, así que es un cambio
   * estructural: rebuild completo, no parche por postMessage.
   */
  refreshGroupCustomizations(): void {
    this.applyGroupCustomizations();
    this.notifyChange();
  }

  //- Bay management

  // Add a bay (or update if it already exists in the group).
  addBay(bay: Bay): void {
    this.bays.set(bay.metadata.id, bay);

    let group = this.groups.get(bay.state.groupId);

    // Safety net: the bay belongs to a group we don't know yet (e.g. a split
    // created at runtime). Without this the bay would sit in the map but in no
    // group, and the render (which iterates groups) would never show it.
    if (!group) {
      const native = vscode.window.tabGroups.all.find(g => g.viewColumn === bay.state.groupId);
      if (native) {
        group = createTabGroup(native);
        this.groupCustomization?.apply(group);
        this.groups.set(group.id, group);
        Logger.log(`[BayState] Created missing group ${group.id} for bay: ${bay.metadata.label}`);
      }
    }

    if (group) {
      const existsInGroup = group.bays.find(t => t.metadata.id === bay.metadata.id);
      if (!existsInGroup) {
        group.bays.push(bay);
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
    
    // Si es parent bay con children, eliminar children primero.
    // EXCEPCIÓN: las variantes de preview NO se eliminan en cascada — cerrar el
    // .md no cierra su preview en VS Code, así que la pestaña nativa sigue viva.
    // Se dejan en el estado y la capa de eventos (BayEventService) dispara un
    // resync que reabre el source y las re-enlaza: una variante nunca queda
    // huérfana de forma permanente.
    if (bay.state.hasVariant && this.hierarchyService) {
      const children = this.hierarchyService.fetchVariants(id);
      for (const child of children) {
        if (child.metadata.diffType === 'preview') { continue; }
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

  /**
   * Re-key a bay after its backing file was renamed or moved. The bay id embeds the
   * URI (`${uri}-${viewColumn}`), so a rename changes the id: the bay must move under
   * the new key both in the map and in its group array — kept at the SAME position so
   * manual drag order survives.
   *
   * `newBay` must be freshly converted from the post-rename native tab so every derived
   * field (label, path parts, language, git status) is already correct.
   *
   * Scope: the caller guarantees the bay is a plain file bay (not itself a variant and
   * with no variants of its own). Variant / parent-with-variant remaps go through a full
   * resync instead, because their ids and `sourceBayId` links would all have to be
   * rewired together — beyond what a single in-place swap can do safely.
   *
   * @returns true if the bay was found and re-keyed; false otherwise (caller should resync).
   */
  rekeyBay(oldId: string, newBay: Bay): boolean {
    const oldBay = this.bays.get(oldId);
    if (!oldBay) { return false; }

    const newId = newBay.metadata.id;
    // Nothing to do if the id didn't actually change.
    if (newId === oldId) { return false; }
    // Never clobber a distinct existing bay (e.g. the rename target already open here).
    if (this.bays.has(newId)) { return false; }

    // Capture the position BEFORE removal so the fresh bay lands in the same slot.
    const group = this.groups.get(oldBay.state.groupId);
    const idx = group ? group.bays.findIndex(b => b.metadata.id === oldId) : -1;

    // removeBayInternal drops the map key, filters it out of the group and fires
    // onDidChangeState. It does NOT cascade to children — this path only handles
    // bays that have none.
    this.removeBayInternal(oldId);

    // Insert the fresh bay at the captured slot (preserves manual drag order).
    newBay.state.indexInGroup = oldBay.state.indexInGroup;
    this.bays.set(newId, newBay);
    if (group) {
      if (idx >= 0 && idx <= group.bays.length) { group.bays.splice(idx, 0, newBay); }
      else { group.bays.push(newBay); }
    }

    this._onDidChangeState.fire();
    Logger.log(`[BayState] Rekeyed bay ${oldId} → ${newId}`);
    return true;
  }

  // Método interno para eliminar sin lógica de jerarquía (evita recursión)
  private removeBayInternal(id: string): void {
    const bay = this.bays.get(id);
    if (bay) {

      const group = this.groups.get(bay.state.groupId);

      if (group) { group.bays = group.bays.filter(t => t.metadata.id !== id); }

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
   * Notifica que el NOMBRE de una bay ha cambiado (título de webview reescrito en
   * runtime, p.ej. Claude Code mostrando la sesión actual). Actualización parcial
   * por postMessage: solo se reemplaza el texto de `.bay-name`, sin rebuild ni
   * cambio de id (el id del webview deriva del viewType estable, no del label).
   */
  notifyBayLabelChange(bayId: string): void {
    if (!this._isBulkLoading) {
      this._onDidChangeBayLabel.fire(bayId);
    }
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

  /**
   * Reemplaza el conjunto de grupos SIN disparar eventos.
   * Usado por syncAll/resyncAll: poda grupos obsoletos (columnas renumeradas o
   * cerradas) y añade los nuevos; el replaceBays posterior ya notifica una vez.
   */
  setGroups(groups: BayGroup[]): void {
    this.groups.clear();
    for (const group of groups) {
      this.groupCustomization?.apply(group);
      this.groups.set(group.id, group);
    }
  }

  getGroup(id: number): BayGroup | undefined {
    return this.groups.get(id);
  }

  getGroups(): BayGroup[] {
    return Array.from(this.groups.values());
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

  // Todas las bays que comparten una URI (el mismo archivo abierto en varios
  // grupos son bays distintas). Diagnósticos y git status son por-URI, no
  // por-grupo, así que cambios de estado deben aplicarse a todas.
  findBaysByUri(uri: vscode.Uri): Bay[] {
    const uriString = uri.toString();
    const matches: Bay[] = [];
    for (const bay of this.bays.values()) {
      if (bay.metadata.uri?.toString() === uriString) { matches.push(bay); }
    }
    return matches;
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

  dispose(): void {
    this._onDidChangeState.dispose();
    this._onDidChangeStateSilent.dispose();
    this._onDidChangeBayState.dispose();
    this._onDidChangeBayLabel.dispose();
  }
}
