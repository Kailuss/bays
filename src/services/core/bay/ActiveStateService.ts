import * as vscode from 'vscode';
import { BayStateService } from '../BayStateService';
import { generateIdFromNativeTab } from '../helpers/tabConverter';
import { Logger } from '../../../platform/logger';

/**
 * ActiveStateService - Sincronización del Estado Activo
 *
 * Sincroniza el estado activo (isActive) de todos los bays con VS Code.
 * Asegura un solo bay activo por grupo.
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

    const activeTabPerGroup = new Map<vscode.ViewColumn, string>();

    for (const group of vscode.window.tabGroups.all) {
      for (const bay of group.tabs) {
        if (!bay.isActive) { continue; }
        const id = generateIdFromNativeTab(bay);
        if (id) {
          activeTabPerGroup.set(group.viewColumn, id);
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
}
