/**
 * Tipos compartidos para el sistema de renderizado HTML del webview.
 */

import * as vscode from 'vscode';
import { Bay } from '../../models/Bay';
import { BayGroup } from '../../models/BayGroup';
import type { GroupSection } from '../../shared/protocol';

//= OPCIONES DE RENDERIZADO

/** Lo que hace falta para componer la lista. */
export type BuildSectionsOptions = {
  groups: BayGroup[];
  getBaysInGroup: (groupId: number) => Bay[];
  /**
   * La ruta se pide AQUÍ y el modo compacto no: aquélla decide si el dato
   * VIAJA —una ruta que no se dibuja es carga en cada render— y el compacto solo
   * decide cómo se coloca lo que ya ha viajado, que es del cliente.
   */
  showPath: boolean;
  copilotReady: boolean;
  enableHoverActions?: boolean;
};

//= ICONOS

// Los tipos intermedios de icono (FontIconMarker / Base64Icon / FallbackIcon /
// IconData) se fueron con `IconRenderer.parseIconString`: hoy el camino va del
// MARCADOR al HTML en un paso, dentro de `utils/iconHtml.ts`, que es el único
// sitio que valida lo que un tema ajeno mete en un atributo.

/**
 * Petición de icono que falló la caché en el pintado síncrono, sin la bay a la
 * que pertenece: `file` se resuelve contra el icon theme por nombre de archivo;
 * `webview` lee del disco el icono de la extensión dueña de la tab.
 */
export type PendingIconRequest =
  | { kind: 'file'; fileName: string; languageId?: string }
  | { kind: 'webview'; viewType?: string; label: string };

/** Icono pendiente de resolución diferida (cache miss en el primer pintado) */
export type PendingIcon = PendingIconRequest & { bayId: string };

/** La lista como datos, su diccionario de iconos, y lo que faltó de la caché. */
export type BuildSectionsResult = {
  sections: GroupSection[];
  icons: Record<string, string>;
  pendingIcons: PendingIcon[];
};

//= URIS DE RECURSOS

/** URIs de recursos para el webview */
export type WebviewResourceUris = {
  codiconCss: vscode.Uri;
  webviewCss: vscode.Uri;
  /** Bundle único del cliente (dist/webview/main.js, generado por esbuild). */
  webviewScript: vscode.Uri;
};

//= ESTADO DE BAY

// El indicador de estado ya no es un tipo de esta capa: el host manda un CÓDIGO
// (`BayStateCode`, en el protocolo) y quien lo dibuja es el cliente, con la tabla
// de `shared/bayState.ts`.

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
