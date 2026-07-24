import * as vscode from 'vscode';
import { BayStateService } from '../services/core/BayStateService';
import { VSCODE_COMMANDS } from '../constants/commands';

/**
 ** Registra los comandos relacionados con bays (abrir, cerrar, mover, etc.).
 *  Normalmente reciben un ID de bay desde el webview y resuelven el `SideBay`.
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

    vscode.commands.registerCommand('bays.toggleShowPath', async () => {
      const cfg = vscode.workspace.getConfiguration('bays');
      const current = cfg.get<boolean>('showFilePath', true);
      await cfg.update('showFilePath', !current, vscode.ConfigurationTarget.Global);
    }),

    vscode.commands.registerCommand('bays.pinBay', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.pin(); stateService.reorderOnPin(bay.metadata.id); }
    }),

    vscode.commands.registerCommand('bays.unpinBay', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.unpin(); stateService.reorderOnUnpin(bay.metadata.id); }
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

    // Contributed in package.json and reachable via keybindings / programmatic
    // invocation. Each delegates to the matching Bay method (the same ones the
    // context menu calls). Without these registrations, invoking the contributed
    // command ids raised "command not found".
    vscode.commands.registerCommand('bays.closeGroup', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.closeGroup(); }
    }),

    vscode.commands.registerCommand('bays.copyPath', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.copyPath(); }
    }),

    vscode.commands.registerCommand('bays.openTimeline', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.openTimeline(); }
    }),

    vscode.commands.registerCommand('bays.splitRight', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.splitRight(); }
    }),

    vscode.commands.registerCommand('bays.openChanges', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.openChanges(); }
    }),

    vscode.commands.registerCommand('bays.revealInFileExplorer', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.revealInFileExplorer(); }
    }),

    vscode.commands.registerCommand('bays.moveToNewWindow', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.moveToNewWindow(); }
    }),

    vscode.commands.registerCommand('bays.duplicateFile', async (arg: unknown) => {
      const bay = resolve(arg);
      if (bay) { await bay.duplicateFile(); }
    }),
  );
}
