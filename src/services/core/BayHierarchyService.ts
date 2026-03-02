import * as vscode from 'vscode';
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
 * - Children have NO tab-actions (only close button)
 * - When a child is active, parent maintains active appearance
 * - DocumentManager is the source of truth for document metadata
 * 
 * @see docs/ANALISIS_PARENT_CHILD.md
 * @see docs/PLAN_OPTIMIZACION_TABSYNC.md
 * @see services/core/AGENT.md
 * @see DocumentManager for document metadata management
 */
export class BayHierarchyService {
  constructor(
    private stateService: BayStateService,
    private documentManager?: DocumentManager
  ) {}

  /**
   * Registers a child bay under its parent.
   * Updates hasChildren and childrenCount of the parent.
   * 
   * @param childId Child bay ID
   * @param parentId Parent bay ID
   */
  registerChild(childId: string, parentId: string): void {
    const parent = this.stateService.fetchBayById(parentId);
    if (!parent) {
      Logger.log(`[BayHierarchy] Cannot register child: parent not found (${parentId})`);
      return;
    }

    const child = this.stateService.fetchBayById(childId);
    if (!child) {
      Logger.log(`[BayHierarchy] Cannot register child: child not found (${childId})`);
      return;
    }

    // Update parent state
    parent.state.hasChildren = true;
    parent.state.childrenCount++;
    // Note: canExpand computed on-demand, not stored in capabilities

    this.stateService.updateTab(parent);
    
    Logger.log(`[BayHierarchy] Registered child: ${child.metadata.label} → ${parent.metadata.label} (count: ${parent.state.childrenCount})`);
  }

  /**
   * Unregisters a child bay from its parent.
   * Updates hasChildren and childrenCount of the parent.
   * 
   * @param childId Child bay ID
   * @param parentId Parent bay ID
   */
  unregisterChild(childId: string, parentId: string): void {
    const parent = this.stateService.fetchBayById(parentId);
    if (!parent) {
      Logger.log(`[BayHierarchy] Cannot unregister child: parent not found (${parentId})`);
      return;
    }

    // Decrement counter
    parent.state.childrenCount = Math.max(0, parent.state.childrenCount - 1);
    
    // Update hasChildren if no more children
    if (parent.state.childrenCount === 0) {
      parent.state.hasChildren = false;
      // Note: canExpand computed on-demand from hasChildren
    }

    this.stateService.updateTab(parent);
    
    Logger.log(`[BayHierarchy] Unregistered child from ${parent.metadata.label} (remaining: ${parent.state.childrenCount})`);
  }

  /**
   * Gets all children of a parent bay.
   * 
   * @param parentId Parent bay ID
   * @returns Array of child bays
   */
  getChildren(parentId: string): Bay[] {
    return this.stateService.getAllTabs()
      .filter(bay => bay.metadata.parentId === parentId);
  }

  /**
   * Checks if a bay has children.
   * 
   * @param bayId Bay ID
   * @returns true if has children
   */
  hasChildren(bayId: string): boolean {
    return this.stateService.getAllTabs()
      .some(bay => bay.metadata.parentId === bayId);
  }

  /**
   * Recalculates children count for all parents.
   * Useful after full synchronization or when inconsistencies exist.
   */
  recalculateAllCounts(): void {
    const allBays = this.stateService.getAllTabs();
    const parents = allBays.filter(bay => !bay.metadata.parentId);
    
    let updated = 0;
    for (const parent of parents) {
      const children = allBays.filter(bay => bay.metadata.parentId === parent.metadata.id);
      const actualCount = children.length;
      
      if (parent.state.childrenCount !== actualCount || 
          parent.state.hasChildren !== (actualCount > 0)) {
        parent.state.childrenCount = actualCount;
        parent.state.hasChildren = actualCount > 0;
        // Note: canExpand computed on-demand from hasChildren state
        
        this.stateService.updateTab(parent);
        updated++;
      }
    }
    
    if (updated > 0) {
      Logger.log(`[BayHierarchy] Recalculated counts for ${updated} parents`);
    }
  }

  /**
   * Inherits state from parent to child bay.
   * 
   * IMPORTANT:
   * - Only Markdown children inherit viewMode
   * - gitStatus, diagnosticSeverity and icons are NOT inherited
   * - This is by design to keep children simple
   * - Diff stats are delegated to DocumentManager if available
   * 
   * @param childBay Child bay that inherits
   * @param parentBay Parent bay to inherit from
   */
  inheritState(childBay: Bay, parentBay: Bay): void {
    // Only Markdown children inherit viewMode
    if (parentBay.metadata.fileExtension === '.md' && childBay.metadata.diffType) {
      childBay.state.viewMode = parentBay.state.viewMode;
      Logger.log(`[BayHierarchy] Child inherited viewMode: ${childBay.metadata.label} ← ${parentBay.state.viewMode}`);
    }
    
    // Calculate diff stats for the child (pass parent for DocumentManager lookup)
    if (childBay.metadata.diffType) {
      this.calculateDiffStatsWithParent(childBay, parentBay);
    }
  }

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
    const matchingVersion = versions.find((v: any) => v.relatedTabId === childBay.metadata.id);
    
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
    const bay = this.stateService.fetchBayById(bayId);
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
   * Gets the hierarchical bay tree (parents with their children).
   * Useful for rendering and navigation.
   * 
   * @param groupId Optional: filter by group
   * @returns Bay tree
   */
  getTabTree(groupId?: number): BayTreeNode[] {
    const allBays = groupId 
      ? this.stateService.getTabsInGroup(groupId)
      : this.stateService.getAllTabs();
    
    const parents = allBays.filter((bay: Bay) => !bay.metadata.parentId);
    
    return parents.map((parent: Bay) => ({
      bay: parent,
      children: this.buildChildrenTree(parent.metadata.id, allBays),
    }));
  }

  /**
   * Recursively builds the children tree.
   * 
   * @param parentId Parent ID
   * @param allBays All available bays
   * @returns Array of child nodes
   */
  private buildChildrenTree(parentId: string, allBays: Bay[]): BayTreeNode[] {
    const children = allBays.filter((bay: Bay) => bay.metadata.parentId === parentId);
    
    return children.map((child: Bay) => ({
      bay: child,
      children: this.buildChildrenTree(child.metadata.id, allBays),
    }));
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
    const config = vscode.workspace.getConfiguration('bays');
    if (!config.get('syncCursorPosition', false)) {
      return; // Feature disabled
    }

    const bay = this.stateService.fetchBayById(bayId);
    if (!bay) {
      return;
    }

    // Update position in current bay
    bay.state.cursorLine = line;
    bay.state.cursorColumn = column;

    // Determine bay family (parent + children or just children if is parent)
    const family: Bay[] = [];
    let parentBay: Bay | undefined;

    if (bay.metadata.parentId) {
      // Is a child, find parent and siblings
      parentBay = this.stateService.fetchBayById(bay.metadata.parentId);
      if (parentBay) {
        family.push(parentBay);
        family.push(...this.getChildren(bay.metadata.parentId));
      }
    } else {
      // Is a parent, find its children
      family.push(...this.getChildren(bay.metadata.id));
    }

    // Update position in all family members
    for (const familyBay of family) {
      if (familyBay.metadata.id === bayId) {
        continue; // Skip self
      }

      // Update state
      familyBay.state.cursorLine = line;
      familyBay.state.cursorColumn = column;

      // If bay has URI, try updating editor if open
      if (familyBay.metadata.uri) {
        await this.updateEditorCursor(familyBay.metadata.uri, line, column);
      }
    }

    Logger.log(`[BayHierarchy] Synced cursor position: line ${line}, col ${column} (${family.length} bays affected)`);
  }

  /**
   * Updates cursor position in an open editor.
   * 
   * @param uri Document URI
   * @param line Line (1-based)
   * @param column Column (1-based)
   */
  private async updateEditorCursor(uri: vscode.Uri, line: number, column: number): Promise<void> {
    // Find editor matching the URI
    const editor = vscode.window.visibleTextEditors.find(
      e => e.document.uri.toString() === uri.toString()
    );

    if (!editor) {
      return; // Editor not visible, can't update
    }

    // Convert to 0-based for VS Code API
    const position = new vscode.Position(line - 1, column - 1);
    const selection = new vscode.Selection(position, position);

    // Update selection without changing focus
    editor.selection = selection;

    // Reveal position in center (optional)
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
  }
}

/**
 * Node in the hierarchical bay tree.
 */
export type BayTreeNode = {
  bay: Bay;
  children: BayTreeNode[];
};

/**
 * @deprecated Use BayTreeNode instead
 */
export type TabTreeNode = BayTreeNode;
