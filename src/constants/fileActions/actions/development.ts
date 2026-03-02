import * as vscode from 'vscode';
import * as path from 'path';
import type { FileAction } from '../types';
import { byExtension, byPattern } from '../matchers';

export const DEVELOPMENT_ACTIONS: FileAction[] = [

  //· Tests: ejecutar archivo de test
  {
    id      : 'runTest',
    icon    : 'beaker',
    tooltip : 'Run Tests',
    match   : byPattern(/\.(test|spec)\.(ts|js|tsx|jsx|mjs|cjs)$/i),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      await vscode.commands.executeCommand('testing.runCurrentFile');
    },
  },

  //· TypeScript / JavaScript: ejecutar con node/ts-node
  {
    id      : 'runFile',
    icon    : 'play',
    tooltip : 'Run File',
    match   : byExtension('.ts', '.js', '.mjs', '.cjs'),
    execute : async (uri) => {
      const ext = path.extname(uri.fsPath).toLowerCase();
      const terminal = vscode.window.createTerminal({ name: 'Run File' });
      terminal.show();
      if (ext === '.ts') {
        terminal.sendText(`npx ts-node "${uri.fsPath}"`);
      } else {
        terminal.sendText(`node "${uri.fsPath}"`);
      }
    },
  },

  //· Python: ejecutar archivo
  {
    id      : 'runPython',
    icon    : 'play',
    tooltip : 'Run Python File',
    match   : byExtension('.py'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      await vscode.commands.executeCommand('python.execInTerminal');
    },
  },

  //· Jupyter Notebooks: abrir en modo interactivo
  {
    id      : 'openNotebook',
    icon    : 'notebook',
    tooltip : 'Open as Notebook',
    match   : byExtension('.ipynb'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.openWith', uri, 'jupyter-notebook');
    },
  },

  //· Shell scripts: ejecutar en terminal
  {
    id      : 'runScript',
    icon    : 'terminal',
    tooltip : 'Run in Terminal',
    match   : byExtension('.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      await vscode.commands.executeCommand('workbench.action.terminal.runActiveFile');
    },
  },

];
