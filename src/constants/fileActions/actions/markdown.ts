import * as vscode from 'vscode';
import { VSCODE_COMMANDS } from '../../commands';
import type { DynamicFileAction } from '../types';
import { byExtension } from '../matchers';

/**
 * Acción dinámica para Markdown: toggle entre preview y source.
 */
export const MARKDOWN_TOGGLE_ACTION: DynamicFileAction = {
  id: 'toggleMarkdownPreview',
  setFocus: true,
  match: byExtension('.md', '.mdx', '.markdown'),
  resolve: (context) => {
    const isPreview = context?.viewMode === 'preview';

    if (isPreview) {
      return {
        icon: 'edit-code',
        tooltip: 'Edit Source',
        actionId: 'editMarkdownSource',
      };
    }
    return {
      icon: 'preview',
      tooltip: 'Open Preview',
      actionId: 'openMarkdownPreview',
    };
  },
  execute: async (uri, context) => {
    const isPreview = context?.viewMode === 'preview';

    if (isPreview) {
      await vscode.commands.executeCommand(VSCODE_COMMANDS.VSCODE_OPEN, uri);
    } else {
      await vscode.commands.executeCommand(VSCODE_COMMANDS.MARKDOWN_SHOW_PREVIEW, uri);
    }
  },
};
