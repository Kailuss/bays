import * as vscode from 'vscode';
import type { BayMetadata, BayState } from '../Bay';

/**
 * Reveal actions - Revelar archivos en exploradores
 */

export async function revealInExplorer(
  metadata: BayMetadata,
  state: BayState
): Promise<void> {
  if (!state.capabilities.canRevealInExplorer) {
    vscode.window.showWarningMessage(vscode.l10n.t('This bay has no file to reveal'));
    return;
  }
  if (metadata.uri) {
    await vscode.commands.executeCommand('revealInExplorer', metadata.uri);
  }
}

export async function revealInFileExplorer(
  metadata: BayMetadata,
  _state: BayState
): Promise<void> {
  if (metadata.uri) {
    await vscode.commands.executeCommand('revealFileInOS', metadata.uri);
  }
}

export async function openTimeline(
  metadata: BayMetadata,
  _state: BayState,
  activateFn: () => Promise<void>
): Promise<void> {
  if (!metadata.uri) {
    return;
  }
  await vscode.commands.executeCommand('timeline.focus');
  await activateFn();
}
