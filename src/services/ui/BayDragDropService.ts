import { BayStateService } from '../core/BayStateService';
import { Bay }    from '../../models/Bay';
import { Logger }          from '../../utils/logger';

/**
 * Service dedicated to drag & drop management of bays.
 * Handles reordering logic respecting restrictions:
 * - Pinned bays cannot be moved
 * - Pinned bays always stay at the top
 * - Cannot drag an unpinned bay over the pinned section
 * - Child bays (variants) cannot be dragged independently
 * 
 * @see services/ui/AGENT.md for detailed patterns
 */
export class BayDragDropService {
  constructor(private readonly stateService: BayStateService) {}

  /**
   * Reorders a bay within the same group.
   * @param sourceBayId - ID of the bay being moved
   * @param targetBayId - ID of the bay being dropped on
   * @param insertPosition - 'before' to insert before, 'after' to insert after
   * @returns true if reordering was successful, false if blocked by restrictions
   */
  reorderWithinGroup(
    sourceBayId: string,
    targetBayId: string,
    insertPosition: 'before' | 'after',
  ): boolean {
    const sourceBay = this.stateService.getBayById(sourceBayId);
    const targetBay = this.stateService.getBayById(targetBayId);

    if (!sourceBay || !targetBay) { return false; }
    if (sourceBay.state.groupId !== targetBay.state.groupId) { return false; }

    // Restriction: child bays cannot be moved (linked to their parent)
    if (sourceBay.metadata.parentId) {
      Logger.log('[DragDrop] Blocked: Child bays cannot be dragged independently');
      return false;
    }

    // Restriction: pinned bays cannot be moved
    if (sourceBay.state.isPinned) { return false; }

    const group = this.stateService.getGroup(sourceBay.state.groupId);
    if (!group) { return false; }

    // Calculate index of last pinned bay
    const lastPinnedIndex = this.findLastPinnedIndex(group.bays);

    // Find current indices
    const sourceIndex = group.bays.findIndex(t => t.metadata.id === sourceBayId);
    const targetIndex = group.bays.findIndex(t => t.metadata.id === targetBayId);

    if (sourceIndex === -1 || targetIndex === -1) { return false; }

    // Calculate final insertion position
    let insertIndex = insertPosition === 'before' ? targetIndex : targetIndex + 1;

    // Restriction: don't allow unpinned bay to move over pinned section
    if (!sourceBay.state.isPinned && insertIndex <= lastPinnedIndex) {
      return false;
    }

    // If target bay is pinned, also block
    if (targetBay.state.isPinned && !sourceBay.state.isPinned) {
      return false;
    }

    // If moving to same position, do nothing
    if (sourceIndex === insertIndex || sourceIndex === insertIndex - 1) {
      return false;
    }

    // Perform reordering
    group.bays.splice(sourceIndex, 1);

    // Adjust insertIndex if needed (if we removed before insertion point)
    if (sourceIndex < insertIndex) {
      insertIndex--;
    }

    group.bays.splice(insertIndex, 0, sourceBay);

    // Update indexInGroup for all bays in the group
    group.bays.forEach((bay, idx) => {
      bay.state.indexInGroup = idx;
    });

    // Notify change
    this.stateService.updateBay(sourceBay);

    return true;
  }

  /**
   * Moves a bay from one group to another.
   * @param sourceBayId - ID of the bay being moved
   * @param targetGroupId - ID of target group
   * @param targetBayId - ID of the bay being dropped on (optional)
   * @param insertPosition - 'before' or 'after' if targetBayId specified
   * @returns true if move was successful
   */
  async moveBetweenGroups(
    sourceBayId: string,
    targetGroupId: number,
    targetBayId?: string,
    //insertPosition?: 'before' | 'after',
  ): Promise<boolean> {
    const sourceBay = this.stateService.getBayById(sourceBayId);
    if (!sourceBay || !sourceBay.metadata.uri) { return false; }

    // Restriction: pinned bays cannot be moved
    if (sourceBay.state.isPinned) { return false; }

    const targetGroup = this.stateService.getGroup(targetGroupId);
    if (!targetGroup) { return false; }

    // If there's a specific target, check restrictions
    if (targetBayId) {
      const targetBay = this.stateService.getBayById(targetBayId);
      if (targetBay && targetBay.state.isPinned) {
        return false; // Don't allow drop over pinned bays
      }
    }

    // Close bay in source group and open in destination
    // This will change the bay ID (because it includes viewColumn)
    try {
      await sourceBay.moveToGroup(targetGroupId);
      return true;
    } catch (error) {
      Logger.error('[BayDragDrop] Failed to move bay between groups:', error);
      return false;
    }
  }

  /**
   * Checks if a drop is valid.
   * @param sourceBayId - Bay being dragged
   * @param targetBayId - Bay being dropped on
   * @returns true if drop is valid
   */
  canDrop(sourceBayId: string, targetBayId: string): boolean {
    const sourceBay = this.stateService.getBayById(sourceBayId);
    const targetBay = this.stateService.getBayById(targetBayId);

    if (!sourceBay || !targetBay) { return false; }

    // Pinned bays cannot be moved
    if (sourceBay.state.isPinned) { return false; }

    // Cannot drop over pinned bays
    if (targetBay.state.isPinned) { return false; }

    return true;
  }

  /**
   * Finds the index of the last pinned bay in an array of bays.
   * @returns Index of last pinned bay, or -1 if no pinned bays
   */
  private findLastPinnedIndex(bays: Bay[]): number {
    let lastIndex = -1;
    for (let i = 0; i < bays.length; i++) {
      if (bays[i].state.isPinned) {
        lastIndex = i;
      }
    }
    return lastIndex;
  }
}
