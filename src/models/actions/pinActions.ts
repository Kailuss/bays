import * as vscode from 'vscode';
import type { BayMetadata, BayState } from '../Bay';

/**
 * Pin/Unpin actions - Pinear y despinear tabs
 */

export async function pin(
  metadata: BayMetadata,
  state: BayState,
  activateFn: () => Promise<void>
): Promise<void> {
  if (!state.capabilities.canPin) {
    vscode.window.showWarningMessage('This bay cannot be pinned');
    return;
  }
  await activateFn();
  await vscode.commands.executeCommand('workbench.action.pinEditor');
  state.isPinned = true;
}

export async function unpin(
  metadata: BayMetadata,
  state: BayState,
  activateFn: () => Promise<void>
): Promise<void> {
  if (!state.isPinned) {
    vscode.window.showWarningMessage('This bay is not pinned');
    return;
  }
  await activateFn();
  await vscode.commands.executeCommand('workbench.action.unpinEditor');
  state.isPinned = false;
}
