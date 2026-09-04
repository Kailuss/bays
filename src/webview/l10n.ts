// El traductor del cliente.
//
// Un webview no alcanza `vscode.l10n`, así que el host inyecta el bundle cargado
// en el shell como `window.__l10n`, de forma SÍNCRONA, con nonce y antes de que
// corra `main.js`. Es deliberado: leer el bundle es una consulta que cualquier
// módulo puede hacer al importarse (las etiquetas viven en tablas de nivel de
// módulo), y un bundle que llegara por mensaje llegaría tarde a todas ellas. El
// idioma de pantalla solo cambia con una recarga de ventana, que reconstruye el
// shell, así que la instantánea no caduca.
//
// Para el idioma por defecto el bundle está vacío y `t` deja pasar el mensaje,
// que es también por lo que los mensajes SON las cadenas inglesas y no claves
// simbólicas: el camino sin traducir no necesita bundle ninguno, y esa misma
// cadena es la clave con la que `vscode.l10n.t` busca del lado del host.

import { interpolate } from '../shared/l10n';

declare global {
  interface Window {
    /** Lo inyecta el shell (ver `BaysHtmlBuilder.buildShell`). Vacío en inglés. */
    __l10n?: Record<string, string>;
  }
}

/** El `vscode.l10n.t` del cliente: consulta al bundle y luego interpolación. */
export function t(message: string, ...args: Array<string | number>): string {
  const translated = window.__l10n?.[message] ?? message;
  return interpolate(translated, ...args);
}
