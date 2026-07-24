import { Bay, DiffStats } from '../../models/Bay';
import { getDiffTypeDisplay } from '../../constants/diffTypes';

type VariantRowRenderOptions = {
  bay: Bay;
  esc: (value: string) => string;
  /** El parent no está en la lista (no abierto, o vive en otro grupo). */
  orphan?: boolean;
  /** false en grupos bloqueados: la variante tampoco muestra su X. */
  allowClose?: boolean;
  /** false con enableHoverActions desactivado: sin X, igual que las bays normales. */
  hover?: boolean;
};

export class VariantRowRenderer {
  static render(options: VariantRowRenderOptions): string {
    const { bay, esc, orphan = false, allowClose = true, hover = true } = options;
    const activeClass = bay.state.isActive ? ' active' : '';

    const diffInfo = getDiffTypeDisplay(bay.metadata.diffType, bay.metadata.label);
    const diffTypeClass = diffInfo?.cssClass ? ` ${diffInfo.cssClass}` : '';
    const orphanClass = orphan ? ' orphan' : '';

    const iconHtml = diffInfo
      ? `<span class="codicon codicon-${diffInfo.icon}"></span>`
      : '<span class="codicon codicon-diff"></span>';

    // Bajo su parent basta el tipo ("Working Tree"); suelta, la fila necesita el
    // label nativo para saber de qué archivo habla.
    const labelHtml = orphan
      ? esc(bay.metadata.label)
      : (diffInfo ? esc(diffInfo.label) : 'Diff');

    const statsHtml = this.renderStats(bay.state.diffStats);

    // Sin parent no hay jerarquía que preservar → cierre normal.
    const closeAction = orphan ? 'closeBay' : 'closeVariant';
    const closeBtn = hover && allowClose && bay.state.capabilities.canClose
      ? `<button data-action="${closeAction}" data-bay-id="${esc(bay.metadata.id)}" title="Close variant"><span class="codicon codicon-close"></span></button>`
      : '';

    return `<div class="bay variant${activeClass}${diffTypeClass}${orphanClass}" data-bay-id="${esc(bay.metadata.id)}" title="${esc(bay.metadata.tooltipText || bay.metadata.label)}">
      <span class="bay-icon">${iconHtml}</span>
      <span class="variant-label">${labelHtml}</span>
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
      return `<span class="variant-stats" title="${linesAdded} lines added, ${linesRemoved} lines removed"><span class="stats-added">+${linesAdded}</span><span class="stats-removed">-${linesRemoved}</span></span>`;
    }

    if (timestamp) {
      const relativeTime = this.formatRelativeTime(timestamp);
      return `<span class="variant-stats" title="${new Date(timestamp).toLocaleString()}">${relativeTime}</span>`;
    }

    if (conflictSections) {
      return `<span class="variant-stats conflict" title="${conflictSections} conflict sections">${conflictSections} conflicts</span>`;
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
