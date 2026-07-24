/**
 * Constantes para comandos de VS Code.
 * Centraliza los strings de comandos hardcodeados.
 */

export const VSCODE_COMMANDS = {
  // Editor actions
  CLOSE_ALL_EDITORS: 'workbench.action.closeAllEditors',
  OPEN_EDITOR_AT_INDEX: 'workbench.action.openEditorAtIndex',

  // Markdown
  MARKDOWN_SHOW_PREVIEW: 'markdown.showPreview',

  // General
  VSCODE_OPEN: 'vscode.open',
} as const;
