/**
 * Tipos compartidos para el sistema de renderizado HTML del webview.
 */

import * as vscode from 'vscode';
import { Bay } from '../../models/Bay';
import { BayGroup } from '../../models/BayGroup';

//= OPCIONES DE RENDERIZADO

/** Icono de archivo genérico de fallback (Seti \E023 en gris) */
export const FALLBACK_FILE_ICON = 'font-icon:\\E023:#d4d7d6';

/** Opciones para construir el HTML del webview */
export type BuildHtmlOptions = {
  webview: vscode.Webview;
  groups: BayGroup[];
  getBaysInGroup: (groupId: number) => Bay[];
  workspaceName: string;
  compactMode: boolean;
  showPath: boolean;
  copilotReady: boolean;
  enableDragDrop?: boolean;
  initialLoad?: boolean;
};

/** Opciones para renderizar una bay individual */
export type RenderBayOptions = {
  bay: Bay;
  showPath: boolean;
  copilotReady: boolean;
  enableDragDrop?: boolean;
};

//= ICONOS

/** Marcador para iconos basados en fuente (vs-seti) */
export type FontIconMarker = {
  type: 'font';
  hexCode: string;
  color: string;
};

/** Icono en formato base64 */
export type Base64Icon = {
  type: 'base64';
  data: string;
};

/** Icono codicon de VS Code */
export type CodiconIcon = {
  type: 'codicon';
  name: string;
  color?: string;
};

/** Icono SVG inline */
export type SvgIcon = {
  type: 'svg';
  content: string;
};

/** Unión de todos los tipos de icono */
export type IconData = FontIconMarker | Base64Icon | CodiconIcon | SvgIcon;

/** Icono pendiente de resolución diferida (cache miss en el primer pintado) */
export type PendingIcon = {
  bayId: string;
  fileName: string;
  languageId?: string;
};

/** Resultado de construir el HTML: markup + iconos a resolver en paralelo después */
export type BuildHtmlResult = {
  html: string;
  pendingIcons: PendingIcon[];
};

//= URIS DE RECURSOS

/** URIs de recursos para el webview */
export type WebviewResourceUris = {
  codiconCss: vscode.Uri;
  webviewCss: vscode.Uri;
  webviewScript: vscode.Uri;
  pathTruncationScript: vscode.Uri;
  dragDropScript: vscode.Uri | null;
};

//= ESTADO DE BAY

/** Indicador visual de estado de bay */
export type StateIndicator = {
  html: string;
  nameClass: string;
};

//= CONFIGURACIÓN DE ESTILOS

/** Configuración de tamaños para iconos */
export type IconSizeConfig = {
  width: number;
  height: number;
  fontSize: number;
};

/** Configuración por defecto de iconos */
export const DEFAULT_ICON_SIZE: IconSizeConfig = {
  width: 16,
  height: 16,
  fontSize: 16,
};

/** Configuración de iconos Seti (más grandes para mejor visualización) */
export const SETI_ICON_SIZE: IconSizeConfig = {
  width: 22,
  height: 22,
  fontSize: 22,
};
