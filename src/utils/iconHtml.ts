// Convierte los "marcadores" de icono que guarda BayIconManager en el HTML que
// la fila pinta.
//
// Es el ÚNICO sitio que genera markup de icono, y ese HTML acaba en un
// `innerHTML` del cliente. Los valores que interpola (el color, el tamaño, el
// codepoint y la `data:` URI del propio icono) vienen del JSON de un tema de
// TERCEROS, así que se validan uno a uno: la CSP del webview ya impide que un
// script inline corra, pero un tema roto o malicioso no puede poder inyectar
// atributos.

import { DEFAULT_FILE_ICON, parseFontIconMarker, iconFontFamily } from './iconMarkers';
import { ICONS } from '../shared/icons';

/** SVG genérico de fichero, para cuando el tema no ofrece nada utilizable. */
export const FALLBACK_FILE_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M13.85 4.44l-3.29-3.3A.5.5 0 0010.21 1H3.5A1.5 1.5 0 002 2.5v11A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5V4.79a.5.5 0 00-.15-.35zM10.5 2.12L12.88 4.5H11a.5.5 0 01-.5-.5V2.12zM12.5 14h-9a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5h6v2a1.5 1.5 0 001.5 1.5h2v8a.5.5 0 01-.5.5z" fill="currentColor"/>
    </svg>`;

/** `#rgb`, `#rrggbbaa`, `red`, `rgb(…)`, `hsl(…)`. Nada más llega a `style`. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i;

/** Tamaños CSS con unidad; el tema los declara como "150%" o "16px". */
const SAFE_FONT_SIZE = /^\d+(\.\d+)?(px|em|rem|%|pt)$/;

/** Un codepoint hexadecimal y nada más: va dentro de una entidad `&#x…;`. */
const SAFE_HEX_CODE = /^[0-9a-f]{1,6}$/i;

/** data: URI de imagen en base64, exactamente como la construye el icon manager. */
const SAFE_DATA_URI = /^data:image\/(svg\+xml|png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Un codicon con un color literal.
 *
 * El nombre viene de `shared/icons.ts` o de `utils/builtinIcons.ts`, que son
 * tablas NUESTRAS, así que no se valida aquí: lo comprueba el build contra el
 * `codicon.css` que se copia al lado. El color sí, porque puede llegar de fuera.
 */
export function codiconHtml(name: string, color?: string): string {
  const style = color && SAFE_COLOR.test(color) ? ` style="color: ${color};"` : '';
  return `<span class="codicon codicon-${name}"${style}></span>`;
}

/**
 * Marcador → HTML.
 *
 * Formatos: `data:` URI (un `img`), `font-icon` (un `span` con la fuente del
 * tema) y `default-file` (el repliegue neutro). Cualquier valor que no pase su
 * validación cae en el SVG genérico: lo que cuesta un icono descartado es el
 * icono por defecto, y lo que costaría honrarlo es markup ajeno en la fila.
 */
export function iconMarkerToHtml(marker: string): string {
  if (marker === DEFAULT_FILE_ICON) { return FALLBACK_FILE_SVG; }

  const font = parseFontIconMarker(marker);
  if (font) {
    // Sin fontId no hay `@font-face` al que apuntar: el glifo se pintaría con la
    // fuente de la UI, o sea un cuadro vacío. Mejor caer al SVG genérico.
    if (!font.fontId) { return FALLBACK_FILE_SVG; }
    if (!SAFE_HEX_CODE.test(font.hexCode)) { return FALLBACK_FILE_SVG; }

    // `iconFontFamily` ya deja solo [A-Za-z0-9_-], así que la familia es segura.
    const family = iconFontFamily(font.fontId);
    const color  = SAFE_COLOR.test(font.color) ? font.color : '#cccccc';
    // El `size` que declara el tema es relativo a SU contenedor (seti usa 150%);
    // aquí la caja del icono es fija (16px vía .seti-icon), así que solo se
    // aplica el de la definición concreta cuando lo trae.
    const size   = SAFE_FONT_SIZE.test(font.fontSize) ? `font-size: ${font.fontSize};` : '';

    return `<span class="seti-icon" style="font-family: '${family}'; color: ${color};${size}">&#x${font.hexCode};</span>`;
  }

  if (SAFE_DATA_URI.test(marker)) {
    return `<img src="${marker}" alt="" />`;
  }

  return FALLBACK_FILE_SVG;
}

/** El icono con el que se pinta una fila mientras el suyo se resuelve. */
export function placeholderIconHtml(): string {
  return FALLBACK_FILE_SVG;
}

/** El codicon de fichero genérico, para lo que no es una ruta del sistema. */
export const GENERIC_FILE_ICON = ICONS.theme.file;
