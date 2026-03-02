import * as vscode from 'vscode';
import { BayStateService } from '../BayStateService';
import { Logger } from '../../../utils/logger';

/**
 * ActiveStateService - Sincronización del Estado Activo
 * 
 * Responsabilidades:
 * - Sincronizar el estado activo (isActive) de todos los tabs con VS Code
 * - Gestionar la propiedad Markdown preview (isPreviewOwner)
 * - Asegurar un solo tab activo por grupo de editor
 * - Limpiar tabs huérfanos (que ya no existen en VS Code)
 * 
 * Lógica crítica:
 * - Markdown preview ownership: Si se abre un Markdown preview, el tab que lo generó
 *   debe marcarse como isPreviewOwner para resaltar visualmente esta relación.
 * - Active state enforcement: Solo un tab puede estar activo por grupo.
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
   * 3. Buscar el native tab correspondiente
   * 4. Actualizar isActive según tab.isActive
   * 5. Asegurar un solo tab activo por grupo
   * 
   * Casos especiales:
   * - Multiple actives: Si hay múltiples tabs activos en un grupo (race condition),
   *   solo el último visto en la iteración se marca como activo.
   */
  syncActiveState(): { hasChanges: boolean } {
    let hasChanges = false;

    // Build a set of all native tab IDs currently open in VS Code
    const nativeIds = new Set<string>();
    const activeTabPerGroup = new Map<vscode.ViewColumn, string>();
    
    // First pass: collect all native IDs and identify active tabs per group
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const id = this.generateIdFromNativeTab(tab);
        if (id) {
          nativeIds.add(id);
          if (tab.isActive) {
            activeTabPerGroup.set(group.viewColumn, id);
          }
        }
      }
    }

    // Second pass: update active state for all tabs in state
    for (const st of this.stateService.getAllTabs()) {
      const id = st.metadata.id;
      const viewColumn = st.state.viewColumn;

      // Check if this tab should be active
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
   * Un tab es huérfano si:
   * - Su ID no aparece en el set de IDs nativos actuales
   * 
   * Esto puede ocurrir cuando:
   * - El usuario cierra un tab rápidamente
   * - Un evento de cierre no se captura correctamente (race condition)
   * - La extensión se activa después de que tabs ya están abiertos
   */
  removeOrphanedTabs(): { removedCount: number } {
    // Build a set of all native tab IDs currently open in VS Code
    const nativeIds = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const id = this.generateIdFromNativeTab(tab);
        if (id) {
          nativeIds.add(id);
        }
      }
    }

    // Find tabs in state that don't exist in VS Code
    const allTabs = this.stateService.getAllTabs();
    const orphanedIds: string[] = [];
    
    for (const st of allTabs) {
      if (!nativeIds.has(st.metadata.id)) {
        orphanedIds.push(st.metadata.id);
      }
    }

    // Remove orphaned tabs
    for (const id of orphanedIds) {
      Logger.log(`[ActiveState] Removing orphaned tab: ${id}`);
      this.stateService.removeTab(id);
    }

    return { removedCount: orphanedIds.length };
  }

  /**
   * Genera un ID ligero desde un native tab sin crear un SideTab completo.
   * Usado para comparación rápida de existencia.
   */
  private generateIdFromNativeTab(tab: vscode.Tab): string | undefined {
    const input = tab.input;
    const viewColumn = tab.group.viewColumn;

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
