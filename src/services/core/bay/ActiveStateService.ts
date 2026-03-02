import * as vscode from 'vscode';
import { BayStateService } from '../BayStateService';
import { generateIdFromNativeTab } from '../helpers/tabConverter';
import { Logger } from '../../../utils/logger';

/**
 * ActiveStateService - Sincronización del Estado Activo
 *
 * Sincroniza el estado activo (isActive) de todos los bays con VS Code.
 * Asegura un solo bay activo por grupo y elimina tabs huérfanos.
 */
export class ActiveStateService {
  constructor(
    private stateService: BayStateService
  ) {}

  /**
   * Sincroniza el estado activo de todos los bays con VS Code.
   * Garantiza un solo bay activo por grupo.
   */
  syncActiveState(): { hasChanges: boolean } {
    let hasChanges = false;

    const nativeIds = new Set<string>();
    const activeTabPerGroup = new Map<vscode.ViewColumn, string>();
    
    for (const group of vscode.window.tabGroups.all) {
      for (const bay of group.tabs) {
        const id = generateIdFromNativeTab(bay);
        if (id) {
          nativeIds.add(id);
          if (bay.isActive) {
            activeTabPerGroup.set(group.viewColumn, id);
          }
        }
      }
    }

    for (const st of this.stateService.getAllBays()) {
      const id = st.metadata.id;
      const viewColumn = st.state.viewColumn;
      const shouldBeActive = activeTabPerGroup.get(viewColumn) === id;

      if (st.state.isActive !== shouldBeActive) {
        st.state.isActive = shouldBeActive;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      Logger.log('[ActiveState] Synchronized active state across all tabs');
    }

    return { hasChanges };
  }

  /**
   * Elimina bays del estado que ya no existen en VS Code (huérfanos).
   * Útil para sincronizar después de cierres rápidos o race conditions.
   */
  removeOrphanedTabs(): { removedCount: number } {
    const nativeIds = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const bay of group.tabs) {
        const id = generateIdFromNativeTab(bay);
        if (id) {
          nativeIds.add(id);
        }
      }
    }

    const allBays = this.stateService.getAllBays();
    const orphanedIds: string[] = [];
    
    for (const st of allBays) {
      if (!nativeIds.has(st.metadata.id)) {
        orphanedIds.push(st.metadata.id);
      }
    }

    for (const id of orphanedIds) {
      Logger.log(`[ActiveState] Removing orphaned bay: ${id}`);
      this.stateService.removeBay(id);
    }

    return { removedCount: orphanedIds.length };
  }
}
