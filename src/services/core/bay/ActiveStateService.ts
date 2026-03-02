import * as vscode from 'vscode';
import { BayStateService } from '../BayStateService';
import { Logger } from '../../../utils/logger';

/**
 * ActiveStateService - Sincronización del Estado Activo
 * 
 * Responsabilidades:
 * - Sincronizar el estado activo (isActive) de todos los tabs con VS Code
 * - Gestionar la propiedad Markdown preview (isPreviewOwner)
 * - Asegurar un solo bay activo por grupo de editor
 * - Limpiar tabs huérfanos (que ya no existen en VS Code)
 * 
 * Lógica crítica:
 * - Markdown preview ownership: Si se abre un Markdown preview, el bay que lo generó
 *   debe marcarse como isPreviewOwner para resaltar visualmente esta relación.
 * - Active state enforcement: Solo un bay puede estar activo por grupo.
 * - Orphan cleanup: Mantener el estado sincronizado eliminando tabs obsoletos.
 */
export class ActiveStateService {
  constructor(
    private stateService: BayStateService
  ) {}

  /**
   * Sincroniza el estado activo de todos los tabs con el estado actual de VS Code.
   * 
   * Flujo:
   * 1. Construir el set de IDs nativos actuales en VS Code
   * 2. Iterar sobre todos los tabs en el estado
   * 3. Buscar el native bay correspondiente
   * 4. Actualizar isActive según bay.isActive
   * 5. Asegurar un solo bay activo por grupo
   * 
   * Casos especiales:
   * - Multiple actives: Si hay múltiples tabs activos en un grupo (race condition),
   *   solo el último visto en la iteración se marca como activo.
   */
  syncActiveState(): { hasChanges: boolean } {
    let hasChanges = false;

    // Build a set of all native bay IDs currently open in VS Code
    const nativeIds = new Set<string>();
    const activeTabPerGroup = new Map<vscode.ViewColumn, string>();
    
    // First pass: collect all native IDs and identify active tabs per group
    for (const group of vscode.window.tabGroups.all) {
      for (const bay of group.tabs) {
        const id = this.generateIdFromNativeTab(bay);
        if (id) {
          nativeIds.add(id);
          if (bay.isActive) {
            activeTabPerGroup.set(group.viewColumn, id);
          }
        }
      }
    }

    // Second pass: update active state for all tabs in state
    for (const st of this.stateService.getAllBays()) {
      const id = st.metadata.id;
      const viewColumn = st.state.viewColumn;

      // Check if this bay should be active
      const shouldBeActive = activeTabPerGroup.get(viewColumn) === id;

      // Update isActive
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
   * Remueve tabs del estado que ya no existen en VS Code (huérfanos).
   * 
   * Un bay es huérfano si:
   * - Su ID no aparece en el set de IDs nativos actuales
   * 
   * Esto puede ocurrir cuando:
   * - El usuario cierra un bay rápidamente
   * - Un evento de cierre no se captura correctamente (race condition)
   * - La extensión se activa después de que tabs ya están abiertos
   */
  removeOrphanedTabs(): { removedCount: number } {
    // Build a set of all native bay IDs currently open in VS Code
    const nativeIds = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const bay of group.tabs) {
        const id = this.generateIdFromNativeTab(bay);
        if (id) {
          nativeIds.add(id);
        }
      }
    }

    // Find tabs in state that don't exist in VS Code
    const allBays = this.stateService.getAllBays();
    const orphanedIds: string[] = [];
    
    for (const st of allBays) {
      if (!nativeIds.has(st.metadata.id)) {
        orphanedIds.push(st.metadata.id);
      }
    }

    // Remove orphaned tabs
    for (const id of orphanedIds) {
      Logger.log(`[ActiveState] Removing orphaned bay: ${id}`);
      this.stateService.removeBay(id);
    }

    return { removedCount: orphanedIds.length };
  }

  /**
   * Genera un ID ligero desde un native bay sin crear un Bay completo.
   * Usado para comparación rápida de existencia.
   */
  private generateIdFromNativeTab(bay: vscode.Tab): string | undefined {
    const input = bay.input;
    const viewColumn = bay.group.viewColumn;

    if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputNotebook) {
      return `${input.uri.toString()}-${viewColumn}`;
    }

    if (input instanceof vscode.TabInputTextDiff) {
      // For diffs, use original URI (right-hand side)
      return `${input.original.toString()}-${viewColumn}`;
    }

    if (input instanceof vscode.TabInputWebview) {
      // For webviews, use viewType if available
      const viewType = (input as any).viewType || 'webview';
      return `webview:${viewType}-${viewColumn}`;
    }

    if (input instanceof vscode.TabInputCustom) {
      return `${input.uri.toString()}-${viewColumn}`;
    }

    return undefined;
  }
}
