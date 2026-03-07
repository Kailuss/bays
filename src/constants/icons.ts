import * as vscode from 'vscode';

/**
 * Iconos "de producto" utilizados por la extensión.
 * Referencian los `codicons` integrados de VS Code (p. ej. pin, close, refresh).
 */
export const PRODUCT_ICONS = {
  // File states
  modified: new vscode.ThemeIcon('circle-filled'),
  saved: new vscode.ThemeIcon('circle-outline'),

  // Bay states
  pinned: new vscode.ThemeIcon('pinned'),
  close: new vscode.ThemeIcon('close'),

  // Actions
  addToContext: new vscode.ThemeIcon('add'),
  copilotEdited: new vscode.ThemeIcon('sparkle'),
  refresh: new vscode.ThemeIcon('refresh'),

  // Git status
  gitModified: new vscode.ThemeIcon('git-commit'),
  gitUntracked: new vscode.ThemeIcon('diff-added'),
  gitStaged: new vscode.ThemeIcon('check'),

  // Groups
  splitHorizontal: new vscode.ThemeIcon('split-horizontal'),
  splitVertical: new vscode.ThemeIcon('split-vertical'),
  group: new vscode.ThemeIcon('window'),
} as const;
