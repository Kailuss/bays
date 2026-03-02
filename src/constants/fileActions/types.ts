import * as vscode from 'vscode';
import type { BayViewMode, EditMode } from '../../models/Bay';

/**
 * Contexto adicional para resolver acciones dinámicamente.
 * Usado para acciones que dependen del estado de la tab (ej: toggle preview).
 */
export type FileActionContext = {
  viewMode?: BayViewMode;          // Current view mode: 'source' | 'preview' | 'split'
  editMode?: EditMode;             // Edit capability state
  splitOrientation?: 'horizontal' | 'vertical';  // Split view orientation
  compareMode?: boolean;           // In diff/compare mode
  debugMode?: boolean;             // In debug mode
}

/**
 * Descripción de una acción contextual asociada a un tipo de archivo.
 *
 * Para añadir una nueva acción basta con registrar un `FileAction` en
 * `FileActionRegistry.register()` — no es necesario tocar otros archivos.
 */
export type FileAction = {
  id: string;      // Identificador único de la acción (se envía como mensaje al webview).
  icon: string;    // Codicon que se muestra en el botón de la tab (sin el prefijo `codicon-`).
  tooltip: string; // Tooltip del botón.
  setFocus?: boolean; // Si debe hacer focus en la tab al ejecutar (default: false).

  /**
   * Función que decide si esta acción aplica a un archivo dado.
   * Recibe el nombre del archivo (`basename`) y la URI completa.
   * La primera acción cuyo `match` devuelva `true` gana.
   */
  match: (fileName: string, uri: vscode.Uri) => boolean;

  /**
   * Función que ejecuta la acción.
   * Recibe la URI del archivo afectado.
   */
  execute: (uri: vscode.Uri) => Promise<void>;
}

/**
 * Acción con resolución dinámica basada en contexto de la tab.
 * Usado para acciones toggle como Markdown preview/source.
 */
export type DynamicFileAction = {
  id: string;
  setFocus?: boolean; // Si debe hacer focus en la tab al ejecutar (default: false).
  /**
   * Función que decide si esta acción aplica a un archivo dado.
   */
  match: (fileName: string, uri: vscode.Uri) => boolean;
  /**
   * Resuelve el icono y tooltip dinámicamente según el contexto.
   * Si no se proporciona contexto, devuelve los valores por defecto.
   */
  resolve: (context?: FileActionContext) => { icon: string; tooltip: string; actionId: string };
  /**
   * Ejecuta la acción con contexto opcional.
   */
  execute: (uri: vscode.Uri, context?: FileActionContext) => Promise<void>;
}

/**
 * Resultado resuelto para un archivo concreto (lo que el HTML builder necesita).
 */
export type ResolvedFileAction = {
  id      : string;
  icon    : string;
  tooltip : string;
  setFocus?: boolean; // Si debe hacer focus al ejecutar
}
