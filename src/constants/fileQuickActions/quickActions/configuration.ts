import * as vscode from 'vscode';
import type { FileQuickAction } from '../types';
import { byName, byPattern } from '../matchers';

export const CONFIGURATION_ACTIONS: FileQuickAction[] = [

  //· package.json: ejecutar scripts
  {
    id      : 'npmScripts',
    icon    : 'play',
    tooltip : 'Show npm Scripts',
    match   : byName('package.json'),
    execute : async (_uri) => {
      await vscode.commands.executeCommand('workbench.action.tasks.runTask');
    },
  },

  //· .env: encriptar/desencriptar secretos
  {
    id      : 'encryptEnv',
    icon    : 'lock',
    tooltip : 'Encrypt/Decrypt Secrets',
    match   : byPattern(/\.env(\.\w+)?$/),
    execute : async (_uri) => {
      const action = await vscode.window.showQuickPick(
        ['Encrypt', 'Decrypt'],
        { placeHolder: 'Choose action for .env file' }
      );

      if (!action) {
        return;
      }

      const terminal = vscode.window.createTerminal({ name: 'dotenv-vault' });
      terminal.show();

      if (action === 'Encrypt') {
        terminal.sendText('npx dotenv-vault encrypt');
      } else {
        terminal.sendText('npx dotenv-vault decrypt');
      }
    },
  },

  //· LICENSE: ver resumen de permisos
  {
    id      : 'showLicense',
    icon    : 'law',
    tooltip : 'View License Summary',
    match   : byName('LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      const choice = await vscode.window.showInformationMessage(
        'View full license details at choosealicense.com',
        'Open Site'
      );
      if (choice) {
        vscode.env.openExternal(vscode.Uri.parse('https://choosealicense.com'));
      }
    },
  },

  //· Prettier config: formatear todo el workspace
  {
    id      : 'formatWorkspace',
    icon    : 'wand',
    tooltip : 'Format All Files',
    match   : byName('.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js', '.prettierrc.yml'),
    execute : async (_uri) => {
      const confirm = await vscode.window.showWarningMessage(
        'Format all files in workspace with Prettier?',
        { modal: true },
        'Yes, Format All'
      );

      if (!confirm) {
        return;
      }

      const terminal = vscode.window.createTerminal({ name: 'Format Workspace' });
      terminal.show();
      terminal.sendText('npx prettier --write .');
    },
  },
];
