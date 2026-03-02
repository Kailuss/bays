import * as vscode from 'vscode';
import type { FileAction } from '../types';
import { byExtension, byPattern } from '../matchers';

export const DATA_ACTIONS: FileAction[] = [

  //· Lock files: abrir npm scripts / audit
  {
    id      : 'openLockFile',
    icon    : 'unlock',
    tooltip : 'Show in Explorer & Outline',
    match   : byPattern(/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|poetry\.lock|Cargo\.lock|composer\.lock)$/i),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      // Fuerza el panel Outline para navegar dependencias visualmente
      await vscode.commands.executeCommand('outline.focus');
    },
  },

  //· JSON / JSONC: formatear documento
  {
    id      : 'formatJson',
    icon    : 'bracket',
    tooltip : 'Format Document',
    match   : byExtension('.json', '.jsonc', '.json5'),
    execute : async (uri) => {
      //await vscode.commands.executeCommand('vscode.open', uri);
      //await vscode.commands.executeCommand('editor.action.formatDocument');
    },
  },

  //· CSV / TSV: abrir como tabla (extensión Data Preview o similar)
  {
    id      : 'previewData',
    icon    : 'table',
    tooltip : 'Preview as Table',
    match   : byExtension('.csv', '.tsv'),
    execute : async (uri) => {
      try {
        await vscode.commands.executeCommand('csv.preview', uri);
      } catch {
        await vscode.commands.executeCommand('vscode.open', uri);
      }
    },
  },

  //· YAML: validar (con extensión YAML de Red Hat)
  {
    id      : 'validateYaml',
    icon    : 'check-all',
    tooltip : 'Validate YAML',
    match   : byExtension('.yml', '.yaml'),
    execute : async (uri) => {
      await vscode.commands.executeCommand('vscode.open', uri);
      await vscode.commands.executeCommand('editor.action.formatDocument');
    },
  },

];
