import * as vscode from 'vscode';
import * as path from 'path';
import type { FileQuickAction } from '../types';
import { byPattern } from '../matchers';

export const DOCKER_ACTIONS: FileQuickAction[] = [

  //· Dockerfile: build
  {
    id      : 'dockerBuild',
    icon    : 'package',
    tooltip : 'Build Image',
    match   : byPattern(/^Dockerfile/i),
    execute : async (uri) => {
      const folder = path.dirname(uri.fsPath);
      const terminal = vscode.window.createTerminal({ name: 'Docker Build', cwd: folder });
      terminal.show();
      terminal.sendText(`docker build -t ${path.basename(folder).toLowerCase()} .`);
    },
  },

];
