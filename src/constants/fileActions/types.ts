import * as vscode from 'vscode';
import type { BayViewMode, EditMode } from '../../models/Bay';

/**
 * Contexto para resolver acciones dinámicamente según estado de la bay.
 */
export type FileActionContext = {
  viewMode?: BayViewMode;
  editMode?: EditMode;
  splitOrientation?: 'horizontal' | 'vertical';
  compareMode?: boolean;
  debugMode?: boolean;
}

/**
 * Acción contextual asociada a un tipo de archivo.
 * Para añadir una nueva acción, registrarla en FileActionRegistry.register().
 */
export type FileAction = {
  id: string;
  icon: string;
  tooltip: string;
  setFocus?: boolean;

  match: (fileName: string, uri: vscode.Uri) => boolean;
  execute: (uri: vscode.Uri) => Promise<void>;
}

/**
 * Acción con resolución dinámica según contexto.
 * Usado para acciones toggle como Markdown preview/source.
 */
export type DynamicFileAction = {
  id: string;
  setFocus?: boolean;
  match: (fileName: string, uri: vscode.Uri) => boolean;
  resolve: (context?: FileActionContext) => { icon: string; tooltip: string; actionId: string };
  execute: (uri: vscode.Uri, context?: FileActionContext) => Promise<void>;
}

/**
 * Resultado resuelto para renderizado HTML.
 */
export type ResolvedFileAction = {
  id       : string;
  icon     : string;
  tooltip  : string;
  setFocus?: boolean;
}
