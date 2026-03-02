import { Bay, DiffStats } from '../../models/Bay';
import { getDiffTypeDisplay } from '../../constants/diffTypes';

type VariantRowRenderOptions = {
  bay: Bay;
  parentId: string;
  esc: (value: string) => string;
};

export class VariantRowRenderer {
  static render(options: VariantRowRenderOptions): string {
    const { bay, parentId, esc } = options;
    const activeClass = bay.state.isActive ? ' active' : '';

    const diffInfo = getDiffTypeDisplay(bay.metadata.diffType, bay.metadata.label);
    const diffTypeClass = diffInfo?.cssClass ? ` ${diffInfo.cssClass}` : '';

    const iconHtml = diffInfo
      ? `<span class="codicon codicon-${diffInfo.icon}"></span>`
      : '<span class="codicon codicon-diff"></span>';
    const labelHtml = diffInfo ? esc(diffInfo.label) : 'Diff';

    const statsHtml = this.renderStats(bay.state.diffStats);

    const closeBtn = bay.state.capabilities.canClose
      ? `<button data-action="closeTab" data-bayId="${esc(bay.metadata.id)}" title="Close"><span class="codicon codicon-close"></span></button>`
      : '';

    return `<div class="bay variant${activeClass}${diffTypeClass}" data-bayId="${esc(bay.metadata.id)}" data-parentid="${parentId}">
      <span class="bay-icon">${iconHtml}</span>
      <span class="child-type-label">${labelHtml}</span>
      ${statsHtml}
      <span class="bay-actions">${closeBtn}</span>
    </div>`;
  }

  private static renderStats(diffStats?: DiffStats): string {
    if (!diffStats) {
      return '';
    }

    const { linesAdded, linesRemoved, timestamp, conflictSections } = diffStats;

    if (linesAdded !== undefined && linesRemoved !== undefined) {
      return `<span class="child-stats" title="${linesAdded} lines added, ${linesRemoved} lines removed"><span class="stats-added">+${linesAdded}</span><span class="stats-removed">-${linesRemoved}</span></span>`;
    }

    if (timestamp) {
      const relativeTime = this.formatRelativeTime(timestamp);
      return `<span class="child-stats" title="${new Date(timestamp).toLocaleString()}">${relativeTime}</span>`;
    }

    if (conflictSections) {
      return `<span class="child-stats conflict" title="${conflictSections} conflict sections">${conflictSections} conflicts</span>`;
    }

    return '';
  }

  private static formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ago`;
    }
    if (hours > 0) {
      return `${hours}h ago`;
    }
    if (minutes > 0) {
      return `${minutes}m ago`;
    }
    return 'just now';
  }
}
