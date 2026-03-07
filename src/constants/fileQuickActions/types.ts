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

/** Quick action shown for specific file types. */
export type FileQuickAction = {
  id: string;
  icon: string;
  tooltip: string;
  setFocus?: boolean;

  match: (fileName: string, uri: vscode.Uri) => boolean;
  execute: (uri: vscode.Uri) => Promise<void>;
}

/** Dynamic quick action - resolved based on bay context (toggle actions). */
export type DynamicFileQuickAction = {
  id: string;
  setFocus?: boolean;
  match: (fileName: string, uri: vscode.Uri) => boolean;
  resolve: (context? : FileActionContext) => { icon: string; tooltip: string; actionId: string };
  execute: (uri: vscode.Uri, context?: FileActionContext) => Promise<void>;
}

/** Resolved quick action for HTML rendering. */
export type ResolvedQuickAction = {
  id       : string;
  icon     : string;
  tooltip  : string;
  setFocus?: boolean;
}
