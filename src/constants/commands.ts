/**
 * Constantes para comandos de VS Code.
 * Centraliza los strings de comandos hardcodeados.
 */

export const VSCODE_COMMANDS = {
  // Editor actions
  CLOSE_ALL_EDITORS: 'workbench.action.closeAllEditors',
  CLOSE_EDITORS_IN_GROUP: 'workbench.action.closeEditorsInGroup',
  OPEN_EDITOR_AT_INDEX: 'workbench.action.openEditorAtIndex',
  
  // File operations
  REVEAL_IN_EXPLORER: 'revealFileInOS',
  REVEAL_IN_SIDEBAR: 'revealInExplorer',
  COPY_PATH: 'copyFilePath',
  COPY_RELATIVE_PATH: 'copyRelativeFilePath',
  
  // Markdown
  MARKDOWN_SHOW_PREVIEW: 'markdown.showPreview',
  MARKDOWN_SHOW_SOURCE: 'markdown.showSource',
  
  // Built-in views
  WORKBENCH_SETTINGS: 'workbench.action.openSettings',
  WORKBENCH_KEYBOARD_SHORTCUTS: 'workbench.action.openGlobalKeybindings',
  WORKBENCH_EXTENSIONS: 'workbench.extensions.action.showInstalledExtensions',
  
  // General
  VSCODE_OPEN: 'vscode.open',
} as const;

export type VsCodeCommand = typeof VSCODE_COMMANDS[keyof typeof VSCODE_COMMANDS];
