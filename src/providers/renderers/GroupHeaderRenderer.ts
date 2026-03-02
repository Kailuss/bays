import { BayGroup } from '../../models/BayGroup';

export class GroupHeaderRenderer {
  static render(group: BayGroup, esc: (value: string) => string): string {
    const marker = group.isActive ? ' ●' : '';
    return `<div class="group-header" data-groupid="${group.id}">
      <span class="codicon codicon-files files"></span>
      <span class="group-label">${esc(group.label)}${marker}</span>
      <span class="group-actions">
        <button class="group-btn" data-action="closeGroup" data-groupid="${group.id}" title="Close Group"><span class="codicon codicon-close-all"></span></button>
        <button class="group-btn" data-action="toggleGroup" data-groupid="${group.id}" title="Collapse/Expand"><span class="codicon codicon-fold-down"></span></button>
      </span>
    </div>`;
  }
}
