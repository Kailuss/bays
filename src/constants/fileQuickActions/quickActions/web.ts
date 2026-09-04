import * as vscode from 'vscode';
import * as path from 'path';
import type { FileQuickAction } from '../types';
import { byExtension } from '../matchers';

export const WEB_ACTIONS: FileQuickAction[] = [

  {
    id      : 'previewHtml',
    icon    : 'globe',
    tooltip : 'Open in Browser',
    match   : byExtension('.html', '.htm'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('simpleBrowser.api.open', uri.toString());
    },
  },

  {
    id      : 'formatCss',
    icon    : 'symbol-ruler',
    tooltip : 'Format Stylesheet',
    match   : byExtension('.css'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      await vscode.commands.executeCommand('editor.action.formatDocument');
    },
  },

  {
    id      : 'compileCss',
    icon    : 'symbol-color',
    tooltip : 'Compile to CSS',
    match   : byExtension('.scss', '.less', '.sass'),
    execute : async (uri) => {
      const terminal = vscode.window.createTerminal({ name: 'Compile CSS' });
      terminal.show();
      const ext = path.extname(uri.fsPath);
      if (ext === '.scss' || ext === '.sass') {
        terminal.sendText(`sass "${uri.fsPath}" "${uri.fsPath.replace(/\.s[ac]ss$/, '.css')}"`);
      } else if (ext === '.less') {
        terminal.sendText(`lessc "${uri.fsPath}" "${uri.fsPath.replace(/\.less$/, '.css')}"`);
      }
    },
  },

  {
    id      : 'sendRequest',
    icon    : 'send',
    tooltip : 'Send HTTP Request',
    match   : byExtension('.http', '.rest'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      try {
        await vscode.commands.executeCommand('rest-client.request');
      } catch {
        vscode.window.showWarningMessage(vscode.l10n.t('Install REST Client extension to send requests'));
      }
    },
  },

];
