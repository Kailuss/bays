import * as vscode from 'vscode';
import { updateEditorCursor } from './BayEditorUtils';
import { syncCursorPosition as syncCursorPositionUtil } from './BayCursorSyncUtils';
import type { Bay, DiffStats } from '../../models/Bay';
import type { BayStateService } from './BayStateService';
import type { DocumentManager } from './DocumentManager';
import { Logger } from '../../utils/logger';

/**
 * Manages hierarchical parent-child relationships between Bays.
 *
 * Responsibilities:
 * - Register/unregister children under parents
 * - Keep hasChildren and childrenCount synchronized
 * - Inherit state from parent to child (only viewMode for Markdown)
 * - Recalculate counters when necessary
 * - Delegate document metadata to DocumentManager
 *
 * IMPORTANT:
 * - Markdown children inherit ONLY viewMode from parent
 * - gitStatus, diagnosticSeverity and state icons are NOT inherited
 * - Children have NO bay-actions (only close button)
 * - When a child is active, parent maintains active appearance
 * - DocumentManager is the source of truth for document metadata
 *
 * @see docs/ANALISIS_PARENT_CHILD.md
 * @see docs/PLAN_OPTIMIZACION_TABSYNC.md
 * @see services/core/AGENT.md
 * @see DocumentManager for document metadata management
 */
export class BayHierarchyService {
  // --- Constructor y dependencias ---
  constructor(
    private stateService: BayStateService,
    private documentManager?: DocumentManager
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
   * Checks if a bay has variants.
   *
   * @param bayId Bay ID
   * @returns true if has variants, false otherwise
   */
  hasVariants(bayId: string): boolean {
    return this.stateService.getAllBays()
      .some(bay => bay.metadata.sourceBayId === bayId);
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

  /**
   * Obtiene el árbol jerárquico de bays (parents con sus hijos).
   * Útil para renderizado y navegación.
   *
   * @param groupId Optional: filter by group
   * @returns Bay tree
   */
  getBayTree(groupId?: number): BayTreeNode[] {
    const allBays = groupId 
      ? this.stateService.getBaysByGroupId(groupId)
      : this.stateService.getAllBays();

    const parents = allBays.filter((bay: Bay) => !bay.metadata.sourceBayId);

    return parents.map((parent: Bay) => ({
      bay: parent,
      children: this.buildChildrenTree(parent.metadata.id, allBays),
    }));
  }

  // --- HERENCIA Y SINCRONIZACIÓN DE ESTADO ---

  /**
   * Inherits state from parent to child bay.
   *
   * IMPORTANT:
   * - Only Markdown children inherit viewMode
   * - gitStatus, diagnosticSeverity and icons are NOT inherited
   * - This is by design to keep children simple
   * - Diff stats are delegated to DocumentManager if available
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

    // Calculate diff stats for the child (pass parent for DocumentManager lookup)
    if (variantBay.metadata.diffType) {
      this.calculateDiffStatsWithParent(variantBay, sourceBay);
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
   * If DocumentManager is available, attempts to get stats from there.
   * For working-tree and staged: attempts to get lines from VS Code diff.
   * For snapshots: uses timestamp information.
   * 
   * @param childBay Child bay to calculate stats
   * @param parentBay Parent bay (to get baseUri)
   */
  private calculateDiffStatsWithParent(childBay: Bay, parentBay: Bay): void {
    if (!childBay.metadata.diffType) { return; }

    const diffType = childBay.metadata.diffType;

    // If already has diffStats (e.g. extracted in tabConverter), don't overwrite
    if (childBay.state.diffStats) { return; }

    // Attempt to get stats from DocumentManager if available
    if (this.documentManager && parentBay.metadata.uri) {
      const stats = this.getStatsFromDocumentManager(parentBay.metadata.uri, childBay);
      if (stats) {
        childBay.state.diffStats = stats;
        return;
      }
    }

    // Fallback: calculate stats locally
    this.calculateLocalDiffStats(childBay, diffType);
  }

  /**
   * Attempts to get stats from DocumentManager.
   * 
   * @param baseUri Base URI of the parent document
   * @param childBay Child bay
   * @returns DiffStats or undefined
   */
  private getStatsFromDocumentManager(baseUri: vscode.Uri, childBay: Bay): DiffStats | undefined {
    if (!this.documentManager) {
      return undefined;
    }

    // Get document by URI
    const document = this.documentManager.getDocumentByUri(baseUri);
    if (!document) {
      return undefined;
    }

    // Get all versions for this diff type
    const versions = this.documentManager.getVersionsByType(
      document.documentId,
      childBay.metadata.diffType!
    );

    // Find version matching this bay
    const matchingVersion = versions.find((v: any) => v.relatedBayId === childBay.metadata.id);

    return matchingVersion?.stats;
  }

  /**
   * Calculates stats locally when DocumentManager is not available.
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

  /**
   * Gets document statistics from DocumentManager.
   *
   * @param bayId Parent bay ID
   * @returns Aggregated statistics or undefined
   */
  getDocumentStats(bayId: string): ReturnType<NonNullable<typeof this.documentManager>['getDocumentStats']> | undefined {
    const bay = this.stateService.getBayById(bayId);
    if (!bay?.metadata.uri || !this.documentManager) {
      return undefined;
    }

    const document = this.documentManager.getDocumentByUri(bay.metadata.uri);
    if (!document) {
      return undefined;
    }

    return this.documentManager.getDocumentStats(document.documentId);
  }

  /**
   * Recursively builds the children tree.
   *
   * @param parentId Parent ID
   * @param allBays All available bays
   * @returns Array of child nodes
   */
  private buildChildrenTree(parentId: string, allBays: Bay[]): BayTreeNode[] {
    const children = allBays.filter((bay: Bay) => bay.metadata.sourceBayId === parentId);

    return children.map((child: Bay) => ({
      bay: child,
      children: this.buildChildrenTree(child.metadata.id, allBays),
    }));
  }
}

/**
 * Node in the hierarchical bay tree.
 */
export type BayTreeNode = {
  bay: Bay;
  children: BayTreeNode[];
};
