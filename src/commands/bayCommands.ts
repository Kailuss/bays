import * as vscode from 'vscode';
import { BayStateService } from '../services/core/BayStateService';
import { VSCODE_COMMANDS } from '../constants/commands';

/**
 * Registra los comandos relacionados con bays (abrir, cerrar, mover, etc.).
 * Normalmente reciben un ID de bay desde el webview y resuelven el `SideBay`.
 */
export function registerBayCommands(
  context: vscode.ExtensionContext,
  stateService: BayStateService
): void {
  const resolve = (arg: unknown) => {
    if (typeof arg === 'string') { return stateService.getBayById(arg); }
    return undefined;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('bays.openBay', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.activate(); }
    }),

    vscode.commands.registerCommand('bays.closeBay', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.close(); }
    }),

    vscode.commands.registerCommand('bays.closeOthers', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.closeOthers(); }
    }),

    vscode.commands.registerCommand('bays.closeToRight', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.closeToRight(); }
    }),

    vscode.commands.registerCommand('bays.closeAll', async () => {
      await vscode.commands.executeCommand(VSCODE_COMMANDS.CLOSE_ALL_EDITORS);
    }),

    vscode.commands.registerCommand('bays.saveAll', async () => {
      await vscode.workspace.saveAll(false);
    }),

    vscode.commands.registerCommand('bays.reorder', () => {
      vscode.window.showInformationMessage('Reorder: Coming soon');
    }),

    vscode.commands.registerCommand('bays.toggleCompactMode', async () => {
      const cfg = vscode.workspace.getConfiguration('bays');
      const current = cfg.get<boolean>('compactMode', false);
      await cfg.update('compactMode', !current, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('bays.pinBay', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.pin(); }
    }),

    vscode.commands.registerCommand('bays.unpinBay', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.unpin(); }
    }),

    vscode.commands.registerCommand('bays.revealInExplorer', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.revealInExplorer(); }
    }),

    vscode.commands.registerCommand('bays.copyRelativePath', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.copyRelativePath(); }
    }),

    vscode.commands.registerCommand('bays.copyFileContents', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.copyFileContents(); }
    }),

    vscode.commands.registerCommand('bays.compareWithActive', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.compareWithActive(); }
    }),

    vscode.commands.registerCommand('bays.moveToGroup', async (arg: unknown) => {
      const bay = resolve(arg);
      if (!bay) { return; }

      const groups = vscode.window.tabGroups.all;
      if (groups.length <= 1) {
        vscode.window.showInformationMessage('Only one group available');
        return;
      }

      const options = groups
        .filter(g => g.viewColumn !== bay.state.viewColumn)
        .map(g => ({ label: `Group ${g.viewColumn}`, viewColumn: g.viewColumn }));

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select target group',
      });

      if (selected) { await bay.moveToGroup(selected.viewColumn); }
    }),
  );
}
