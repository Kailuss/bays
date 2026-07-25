import { syncCursorPosition as syncCursorPositionUtil } from './BayCursorSyncUtils';
import type { Bay } from '../../models/Bay';
import type { BayStateService } from './BayStateService';
import { Logger } from '../../utils/logger';

/**
 * Manages hierarchical parent-child relationships between Bays.
 *
 * Responsibilities:
 * - Register/unregister children under parents
 * - Keep hasVariant and variantCount synchronized
 * - Inherit state from parent to child (only viewMode for Markdown)
 * - Recalculate counters when necessary
 *
 * IMPORTANT:
 * - Markdown children inherit ONLY viewMode from parent
 * - gitStatus, diagnosticSeverity and state icons are NOT inherited
 * - Children have NO bay-actions (only close button)
 * - When a child is active, parent maintains active appearance
 *
 * @see services/core/AGENT.md
 */
export class BayHierarchyService {
  // --- Constructor y dependencias ---
  constructor(
    private stateService: BayStateService
  ) {}

  // --- MÉTODOS PÚBLICOS DE JERARQUÍA ---

  /**
   * Registers a child bay under its parent.
   * Updates hasChildren and childrenCount of the parent.
   *
   * @param variantBayId Child bay ID
   * @param sourceBayId Parent bay ID
   */
  linkVariantToParentBay(variantBayId: string, sourceBayId: string): void {

    const sourceBay = this.stateService.getBayById(sourceBayId);

    // Si el sourceBay no existe, no podemos registrar variantBay.
    // Esto puede pasar si el evento de creación del sourceBay aún no se ha procesado.
    if (!sourceBay) {
      Logger.log(`[BayHierarchy] Cannot register child: sourceBay not found (${sourceBayId})`);
      return;
    }

    // Verificar que el variantBay existe antes de registrarlo en la jerarquía.
    const bayVariant = this.stateService.getBayById(variantBayId);
    if (!bayVariant) {
      Logger.log(`[BayHierarchy] Cannot register variant: variantBay not found (${variantBayId})`);
      return;
    }

    // Update sourceBay state
    sourceBay.state.hasVariant = true;
    sourceBay.state.variantCount++;
    // Note: canExpand computed on-demand, not stored in capabilities

    this.stateService.updateBay(sourceBay);

    Logger.log(`[BayHierarchy] Registered child: ${bayVariant.metadata.label} → ${sourceBay.metadata.label} (count: ${sourceBay.state.variantCount})`);
  }

  /**
   * Unregisters a variant bay from its source bay.
   * Updates hasChildren and childrenCount of the source bay.
   *
   * @param variantBayId Variant bay ID
   * @param sourceBayId Source bay ID
   */
  detachVariantFromParentBay(_variantBayId: string, sourceBayId: string): void {
    const sourceBay = this.stateService.getBayById(sourceBayId);
    if (!sourceBay) {
      Logger.log(`[BayHierarchy] Cannot unregister variant: sourceBay not found (${sourceBayId})`);
      return;
    }

    // Decrement counter
    sourceBay.state.variantCount = Math.max(0, sourceBay.state.variantCount - 1);

    // Update hasVariant if no more variants
    if (sourceBay.state.variantCount === 0) {
      sourceBay.state.hasVariant = false;
      // Note: canExpand computed on-demand from hasVariant
    }

    this.stateService.updateBay(sourceBay);

    Logger.log(`[BayHierarchy] Unregistered child from ${sourceBay.metadata.label} (remaining: ${sourceBay.state.variantCount})`);
  }

  /**
   * Gets all children of a parent bay.
   *
   * @param sourceBayId Parent bay ID
   * @returns Array of variant bays
   */
  fetchVariants(sourceBayId: string): Bay[] {
    return this.stateService.getAllBays()
      .filter(bay => bay.metadata.sourceBayId === sourceBayId);
  }

  /**
   * Cierra una bay Y sus variantes (diffs, previews) en las tabs nativas.
   *
   * Es la semántica de "cerrar" desde la UI de Bays: cerrar el padre arrastra
   * a sus variantes. Cerrar la tab nativa directamente (tab bar de VS Code) NO
   * pasa por aquí — ahí VS Code deja vivas las previews y BayEventService
   * dispara un resync que reabre el source (una variante nunca vive sin parent).
   *
   * Las variantes se cierran primero: sus eventos de cierre desregistran cada
   * una del padre antes de que el padre desaparezca del estado.
   */
  async closeBayWithVariants(bay: Bay): Promise<void> {
    if (bay.state.hasVariant) {
      for (const variant of this.fetchVariants(bay.metadata.id)) {
        await variant.close();
      }
    }
    await bay.close();
  }

  /**
   * Recalculates children count for all parents.
   * Useful after full synchronization or when inconsistencies exist.
   */
  recalculateAllCounts(): void {
    const allBays = this.stateService.getAllBays();
    const parents = allBays.filter(bay => !bay.metadata.sourceBayId);

    let updated = 0;
    for (const parent of parents) {
      const children = allBays.filter(bay => bay.metadata.sourceBayId === parent.metadata.id);
      const actualCount = children.length;

      if (parent.state.variantCount !== actualCount || 
          parent.state.hasVariant !== (actualCount > 0)) {
        parent.state.variantCount = actualCount;
        parent.state.hasVariant = actualCount > 0;
        // Note: canExpand computed on-demand from hasChildren state

        this.stateService.updateBay(parent);
        updated++;
      }
    }

    if (updated > 0) {
      Logger.log(`[BayHierarchy] Recalculated counts for ${updated} parents`);
    }
  }

  // --- HERENCIA Y SINCRONIZACIÓN DE ESTADO ---

  /**
   * Inherits state from parent to child bay.
   *
   * IMPORTANT:
   * - Only Markdown children inherit viewMode
   * - gitStatus, diagnosticSeverity and icons are NOT inherited
   * - This is by design to keep children simple
   *
   * @param variantBay Child bay that inherits
   * @param sourceBay Parent bay to inherit from
   */
  inheritState(variantBay: Bay, sourceBay: Bay): void {
    // Only Markdown children inherit viewMode
    if (sourceBay.metadata.fileExtension === '.md' && variantBay.metadata.diffType) {
      variantBay.state.viewMode = sourceBay.state.viewMode;
      Logger.log(`[BayHierarchy] Child inherited viewMode: ${variantBay.metadata.label} ← ${sourceBay.state.viewMode}`);
    }

    // Calculate diff stats for the child
    if (variantBay.metadata.diffType) {
      this.calculateDiffStats(variantBay);
    }
  }

  /**
   * Synchronizes cursor position (line and column) between a parent bay and all its children.
   * If syncCursorPosition config is enabled, updates all related editors.
   *
   * @param bayId Bay ID that changed cursor position
   * @param line Cursor line (1-based)
   * @param column Cursor column (1-based)
   */
  async syncCursorPosition(bayId: string, line: number, column: number): Promise<void> {
    await syncCursorPositionUtil(
      this.stateService,
      bayId,
      line,
      column,
      this.fetchVariants.bind(this)
    );
  }

  // --- MÉTODOS PRIVADOS Y HELPERS ---

  /**
   * Calculates diff statistics for a child bay based on its type.
   *
   * For working-tree/staged/edit: placeholder or label-derived stats.
   * For snapshots and commits: timestamp information.
   *
   * @param childBay Child bay to calculate stats
   */
  private calculateDiffStats(childBay: Bay): void {
    if (!childBay.metadata.diffType) { return; }

    const diffType = childBay.metadata.diffType;

    // If already has diffStats (e.g. extracted in tabConverter), don't overwrite
    if (childBay.state.diffStats) { return; }

    this.calculateLocalDiffStats(childBay, diffType);
  }

  /**
   * Calculates stats from locally available information.
   *
   * @param childBay Child bay
   * @param diffType Diff type
   */
  private calculateLocalDiffStats(childBay: Bay, diffType: string): void {
    // For working-tree, staged and edits, set placeholder stats
    // In real implementation, you would parse diff content
    if (diffType === 'working-tree' || diffType === 'staged' || diffType === 'edit') {
      // For Copilot edits, try extracting stats from label
      if (diffType === 'edit') {
        const statsMatch = childBay.metadata.label.match(/[+](\d+)[-](\d+)/);
        if (statsMatch) {
          childBay.state.diffStats = {
            linesAdded: parseInt(statsMatch[1], 10),
            linesRemoved: parseInt(statsMatch[2], 10),
          };
          return;
        }
      }
      // TODO: Implement real diff parsing when VS Code API supports it
      // For now, show placeholder stats
      childBay.state.diffStats = {
        linesAdded: 0,
        linesRemoved: 0,
      };
    } else if (diffType === 'snapshot' || diffType === 'commit') {
      // For snapshots and commits, use current time as placeholder
      childBay.state.diffStats = {
        timestamp: Date.now(),
        snapshotName: childBay.metadata.label,
      };
    } else if (diffType === 'merge-conflict') {
      // For merge conflicts, count would need file parsing
      childBay.state.diffStats = {
        conflictSections: 0, // Placeholder
      };
    }
  }
}
