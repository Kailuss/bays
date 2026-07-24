import * as vscode from 'vscode';

/**
 * Updates cursor position in an open editor.
 *
 * @param uri Document URI
 * @param line Line (1-based)
 * @param column Column (1-based)
 */
export async function updateEditorCursor(uri: vscode.Uri, line: number, column: number): Promise<void> {
  // Find editor matching the URI
  const editor = vscode.window.visibleTextEditors.find(
    e => e.document.uri.toString() === uri.toString()
  );

  if (!editor) {
    return; // Editor not visible, can't update
  }

  // Convert to 0-based for VS Code API
  const position = new vscode.Position(line - 1, column - 1);
  const selection = new vscode.Selection(position, position);

  // Update selection without changing focus
  editor.selection = selection;

  // Reveal position in center (optional)
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  );
}
