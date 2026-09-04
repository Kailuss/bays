import type { BayType } from '../models/BayTypes';

/**
 * Cómo se compone el id de una bay, como REGLA PURA.
 *
 * Es el contrato más delicado del proyecto: el mismo id tiene que poder
 * RECONSTRUIRSE desde la tab nativa, o los caminos de abrir, cerrar y sincronizar
 * el activo dejan de encontrarse. Vive aquí, en un solo sitio y sin `vscode`
 * delante, por dos razones:
 *
 *  - se puede fijar con tests que corren en milisegundos, y
 *  - no se puede volver a deletrear por accidente. Estaba escrito en tres sitios
 *    —`generateId`, `generateVariantId` y una plantilla suelta en
 *    `findPreviewSource`— y tres copias de un contrato son tres respuestas
 *    esperando a discrepar.
 *
 * El adaptador que convierte una `vscode.Uri` y un `ViewColumn` en las cadenas y
 * los números que esto pide vive en `services/core/helpers/tabConverter.ts`.
 */

/**
 * Id de una bay con URI: la uri serializada y la columna. El mismo fichero
 * abierto en dos grupos son dos bays distintas, que es lo que la columna dice.
 */
export function fileBayId(uriString: string, viewColumn: number): string {
  return `${uriString}-${viewColumn}`;
}

/**
 * Id de una bay SIN uri (un webview).
 *
 * Se compone del `viewType`, que es fijo durante la vida del panel, y nunca del
 * label: algunos webviews reescriben su título en runtime —la pestaña de chat de
 * Claude Code enseña el nombre de la sesión— así que un id derivado del label
 * deriva con cada cambio de título, huerfaniza la bay y rompe el marcado de
 * activa y el cierre. Sin `viewType` no queda otra que el label.
 */
export function webviewBayId(
  label: string,
  viewColumn: number,
  bayType: BayType,
  viewType?: string,
): string {
  const key = (viewType || label).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  return `${bayType}:${key}-${viewColumn}`;
}

/**
 * Id de una variante (un diff, un snapshot).
 *
 * Derivado SOLO de las uris modificada y original y de la columna, que son las
 * tres cosas disponibles en la tab nativa: así el camino que la abre y los que la
 * cierran o sincronizan coinciden en el mismo id. Incluir la original desambigua
 * además dos diffs distintos del mismo fichero en un mismo grupo.
 */
export function variantBayId(
  modifiedUriString: string,
  originalUriString: string | undefined,
  viewColumn: number,
): string {
  return `diff:${modifiedUriString}::${originalUriString ?? ''}-${viewColumn}`;
}
