import * as vscode from 'vscode';
import * as path from 'path';
import type { BayMetadata, BayState } from '../Bay';
import { BayHelpers } from '../BayHelpers';

/**
 * File manipulation actions - Duplicar, comparar, split, mover
 */

export async function duplicateFile(
  metadata: BayMetadata,
  state: BayState
): Promise<void> {
  if (!metadata.uri) {
    return;
  }
  try {
    // Read original file content
    const content = await vscode.workspace.fs.readFile(metadata.uri);

    // Generate new filename
    const dir = path.dirname(metadata.uri.fsPath);
    const ext = path.extname(metadata.uri.fsPath);
    const basename = path.basename(metadata.uri.fsPath, ext);

    // Find next available name: file-copy.ext, file-copy2.ext, etc.
    let counter = 1;
    let newName = `${basename}-copy${ext}`;
    let newPath = path.join(dir, newName);
    let newUri = vscode.Uri.file(newPath);

    while (true) {
      try {
        await vscode.workspace.fs.stat(newUri);
        // File exists, try next number
        counter++;
        newName = `${basename}-copy${counter}${ext}`;
        newPath = path.join(dir, newName);
        newUri = vscode.Uri.file(newPath);
      } catch {
        // File doesn't exist, use this name
        break;
      }
    }

    // Create the duplicate
    await vscode.workspace.fs.writeFile(newUri, content);

    // Open in the same view column as the original
    await vscode.window.showTextDocument(newUri, {
      viewColumn: state.viewColumn,
      preserveFocus: false,
    });

    vscode.window.showInformationMessage(vscode.l10n.t('File duplicated: {0}', newName));
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to duplicate file: {0}', String(err)));
  }
}

export async function compareWithActive(
  metadata: BayMetadata,
  _state: BayState
): Promise<void> {
  if (!metadata.uri) {
    return;
  }
  const active = vscode.window.activeTextEditor;
  if (!active) {
    return;
  }
  await vscode.commands.executeCommand(
    'vscode.diff',
    active.document.uri,
    metadata.uri,
    `${path.basename(active.document.fileName)} ↔ ${metadata.label}`
  );
}

export async function openChanges(metadata: BayMetadata, _state: BayState): Promise<void> {
  if (!metadata.uri) {
    return;
  }
  await vscode.commands.executeCommand('git.openChange', metadata.uri);
}

export async function splitRight(metadata: BayMetadata, _state: BayState): Promise<void> {
  if (!metadata.uri) {
    return;
  }
  await vscode.commands.executeCommand('vscode.open', metadata.uri, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: false,
  });
}

export async function moveToNewWindow(
  metadata: BayMetadata,
  _state: BayState
): Promise<void> {
  if (!metadata.uri) {
    return;
  }
  await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
}

export async function moveToGroup(
  metadata: BayMetadata,
  state: BayState,
  target: vscode.ViewColumn,
  closeFn: () => Promise<void>
): Promise<void> {
  // Webview bays (Claude Code, Simple Browser, Settings…) have no URI to reopen,
  // so close+reopen is impossible. Move the live tab instead: focus it, then run
  // the native "move editor to group N" command. Preserves the webview's state
  // (no teardown) and relocates it to the target group.
  if (!metadata.uri) {
    await BayHelpers.activateByNativeTab(metadata, state);
    await BayHelpers.moveActiveEditorToGroup(target);
    return;
  }
  await closeFn();
  await vscode.commands.executeCommand('vscode.open', metadata.uri, {
    viewColumn: target,
    preview: state.isPreview,
  });
}
