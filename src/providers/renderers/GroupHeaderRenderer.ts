import { BayGroup, getGroupLabel } from '../../models/BayGroup';

export class GroupHeaderRenderer {
  static render(group: BayGroup, esc: (value: string) => string): string {
    const label = esc(getGroupLabel(group));

    // El candado refleja el estado además de alternarlo: bloqueado, el botón se
    // queda visible sin hover (ver group-header.css) y es el único indicio de
    // por qué a las bays de este grupo les falta la X.
    const lockIcon = group.isLocked ? 'lock' : 'unlock';
    const lockTitle = group.isLocked ? 'Unlock Group' : 'Lock Group';

    return `<div class="group-header" data-groupid="${group.id}" data-color="${group.color}" data-locked="${group.isLocked}">
      <button class="group-toggle" data-action="toggleGroup" data-groupid="${group.id}" title="Collapse/Expand"><span class="codicon codicon-chevron-down"></span></button>
      <span class="group-label">${label}</span>
      <span class="group-actions">
        <button class="group-btn" data-action="renameGroup" data-groupid="${group.id}" title="Rename Group"><span class="codicon codicon-edit"></span></button>
        <button class="group-btn" data-action="setGroupColor" data-groupid="${group.id}" title="Set Color"><span class="codicon codicon-symbol-color"></span></button>
        <button class="group-btn group-lock-btn" data-action="toggleGroupLock" data-groupid="${group.id}" title="${lockTitle}"><span class="codicon codicon-${lockIcon}"></span></button>
      </span>
    </div>`;
  }
}
