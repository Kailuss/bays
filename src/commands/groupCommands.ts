import * as vscode from 'vscode';
import { BayGroup } from '../models/BayGroup';
import { BayStateService } from '../services/core/BayStateService';
import { GroupActions } from '../providers/GroupActions';

/**
 ** Comandos de grupo: renombrar, colorear y bloquear.
 *
 *  Existen además de los botones de la cabecera porque con un único grupo no se
 *  dibuja cabecera alguna — sin estos comandos ese caso no tendría forma de
 *  personalizarse. Aceptan un id de grupo (number) y, si no llega, actúan sobre
 *  el grupo activo.
 */
export function registerGroupCommands(
  context: vscode.ExtensionContext,
  stateService: BayStateService,
  groupActions: GroupActions,
): void {
  const resolve = (arg: unknown): BayGroup | undefined => {
    if (typeof arg === 'number') { return stateService.getGroup(arg); }

    const groups = stateService.getGroups();
    return groups.find(g => g.isActive) ?? groups[0];
  };

  const run = async (arg: unknown, action: (group: BayGroup) => Promise<boolean>) => {
    const group = resolve(arg);
    if (!group) {
      void vscode.window.showInformationMessage(vscode.l10n.t('No editor group available'));
      return;
    }
    if (await action(group)) { stateService.refreshGroupCustomizations(); }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('bays.renameGroup', (arg: unknown) =>
      run(arg, group => groupActions.rename(group))),

    vscode.commands.registerCommand('bays.setGroupColor', (arg: unknown) =>
      run(arg, group => groupActions.pickColor(group))),

    vscode.commands.registerCommand('bays.toggleGroupLock', (arg: unknown) =>
      run(arg, group => groupActions.toggleLock(group))),
  );
}
