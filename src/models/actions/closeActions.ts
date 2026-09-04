import * as vscode from 'vscode';
import type { BayMetadata, BayState } from '../Bay';
import { BayHelpers } from '../BayHelpers';

/**
 * Close actions - Cerrar tabs y grupos
 */

export async function close(metadata: BayMetadata, state: BayState): Promise<void> {
  if (!state.capabilities.canClose) {
    vscode.window.showWarningMessage(vscode.l10n.t('This bay cannot be closed'));
    return;
  }
  const t = BayHelpers.findNativeTab(metadata, state);
  if (t) {
    await vscode.window.tabGroups.close(t);
  }
}

export async function closeOthers(
  _metadata: BayMetadata,
  _state: BayState,
  activateFn: () => Promise<void>
): Promise<void> {
  await activateFn();
  await vscode.commands.executeCommand('workbench.action.closeOtherEditors');
}

export async function closeGroup(_metadata: BayMetadata, state: BayState): Promise<void> {
  const group = BayHelpers.nativeGroup(state.viewColumn);
  if (!group) {
    return;
  }
  await vscode.window.tabGroups.close(group);
}

/**
 * Cierra las bays que siguen a esta en el orden de la lista (el equivalente
 * vertical de "Close to the Right" de la tab bar nativa).
 */
export async function closeToRight(
  metadata: BayMetadata,
  state: BayState
): Promise<void> {
  const group = BayHelpers.nativeGroup(state.viewColumn);
  if (!group) {
    return;
  }

  const idx = group.tabs.findIndex((t) => BayHelpers.matchesNative(t, metadata));
  if (idx === -1) {
    return;
  }

  for (const t of group.tabs.slice(idx + 1)) {
    await vscode.window.tabGroups.close(t);
  }
}
