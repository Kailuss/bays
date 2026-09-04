import * as vscode from 'vscode';
import type { BayMetadata, BayState } from '../Bay';

/**
 * Copy actions - Copiar paths y contenido
 */

export async function copyRelativePath(
  metadata: BayMetadata,
  _state: BayState
): Promise<void> {
  if (!metadata.uri) {
    vscode.window.showWarningMessage(vscode.l10n.t('This bay has no path to copy'));
    return;
  }
  if (!metadata.uri) {
    return;
  }
  const rel = vscode.workspace.asRelativePath(metadata.uri);
  await vscode.env.clipboard.writeText(rel);
  vscode.window.showInformationMessage(vscode.l10n.t('Copied: {0}', rel));
}

export async function copyPath(metadata: BayMetadata, _state: BayState): Promise<void> {
  if (!metadata.uri) {
    vscode.window.showWarningMessage(vscode.l10n.t('This bay has no path to copy'));
    return;
  }
  if (!metadata.uri) {
    return;
  }
  await vscode.env.clipboard.writeText(metadata.uri.fsPath);
  vscode.window.showInformationMessage(vscode.l10n.t('Copied: {0}', metadata.uri.fsPath));
}

export async function copyFileContents(
  metadata: BayMetadata,
  _state: BayState
): Promise<void> {
  if (!metadata.uri) {
    return;
  }
  try {
    const doc = await vscode.workspace.openTextDocument(metadata.uri);
    await vscode.env.clipboard.writeText(doc.getText());
    vscode.window.showInformationMessage(vscode.l10n.t('File contents copied to clipboard'));
  } catch {
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to copy file contents'));
  }
}
