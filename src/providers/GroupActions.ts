import * as vscode from 'vscode';
import { BayGroup, BayGroupColor, GROUP_COLORS, defaultGroupColor, getGroupLabel } from '../models/BayGroup';
import { GroupCustomizationService } from '../services/ui/GroupCustomizationService';

/** Muestras para el QuickPick: no admite color, pero sí emoji. */
const COLOR_SWATCH: Record<BayGroupColor, string> = {
  blue    : '🔵',
  green   : '🟢',
  yellow  : '🟡',
  orange  : '🟠',
  red     : '🔴',
  purple  : '🟣',
};

const COLOR_NAME: Record<BayGroupColor, string> = {
  blue    : 'Blue',
  green   : 'Green',
  yellow  : 'Yellow',
  orange  : 'Orange',
  red     : 'Red',
  purple  : 'Purple',
};

/**
 * Las tres acciones de grupo: renombrar, colorear y bloquear.
 *
 * Cada una es directa — no hay menú previo que las agrupe: la cabecera ya
 * expone un botón por acción. Sólo el color abre un QuickPick, porque elegir
 * entre seis valores no cabe en un botón.
 *
 * Todas devuelven `true` si tocaron algo, para que el llamante decida cuándo
 * reaplicar la personalización y repintar.
 */
export class GroupActions {
  constructor(private readonly customization: GroupCustomizationService) {}

  /** Pide un nombre nuevo. Vaciar el campo devuelve el nombre por defecto. */
  async rename(group: BayGroup): Promise<boolean> {
    const value = await vscode.window.showInputBox({
      prompt      : `Rename ${group.label}`,
      value       : group.customLabel ?? '',
      placeHolder : `Leave empty to restore "${group.label}"`,
      validateInput: input => input.length > 60 ? 'Name is too long (max 60 characters)' : undefined,
    });

    if (value === undefined) { return false; }

    await this.customization.setLabel(group.id, value);
    return true;
  }

  async pickColor(group: BayGroup): Promise<boolean> {
    const auto   = defaultGroupColor(group.viewColumn);
    const isAuto = this.customization.get(group.id)?.color === undefined;

    // "Auto" no es un color más: borra la elección y devuelve el grupo al color
    // que le toca por columna, que es lo que ve un grupo recién abierto.
    const items: Array<vscode.QuickPickItem & { color?: BayGroupColor }> = [
      {
        label       : `${COLOR_SWATCH[auto]}  Auto`,
        description : isAuto ? 'current · from group position' : 'from group position',
        color       : undefined,
      },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      ...GROUP_COLORS.map(color => ({
        label       : `${COLOR_SWATCH[color]}  ${COLOR_NAME[color]}`,
        description : !isAuto && color === group.color ? 'current' : undefined,
        color,
      })),
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `Color for ${getGroupLabel(group)}`,
    });
    if (!pick) { return false; }

    await this.customization.setColor(group.id, pick.color);
    return true;
  }

  async toggleLock(group: BayGroup): Promise<boolean> {
    await this.customization.setLocked(group.id, !group.isLocked);
    return true;
  }
}
