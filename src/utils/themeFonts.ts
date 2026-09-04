// El `fonts[]` de un tema de iconos, y el `@font-face` en el que se convierte.
//
// Todo lo de aquí es PURO: lo que recibe es el JSON tal y como se leyó y lo que
// devuelve es una descripción y una cadena. Resolver una ruta relativa contra el
// directorio del tema y leer el fichero son cosa del llamante, que es el único
// que sabe qué tema tiene en la mano.

/**
 * Los tres valores de fuente que acaban interpolados en un bloque `<style>` del
 * `<head>` del webview.
 *
 * Salen del JSON de un tema de TERCEROS, así que cada uno se compara con una
 * lista blanca y cae al valor por defecto cuando no encaja: un valor que llevara
 * `</style>` cerraría el elemento y lo que viniera detrás se parsearía como
 * markup. La CSP no lo salva: bloquea el script, no la deformación de la página.
 *
 * Es el mismo trato que `utils/iconHtml.ts` le da al color, al tamaño y al
 * codepoint, y por la misma razón: los valores no son nuestros.
 */
const SAFE_FONT_FORMAT = /^(woff2|woff|truetype|opentype|embedded-opentype|svg)$/;
const SAFE_FONT_WEIGHT = /^(normal|bold|lighter|bolder|[1-9]00)$/;
const SAFE_FONT_STYLE  = /^(normal|italic|oblique)$/;

/** Una fuente tal y como la DECLARA el tema: `src` sigue siendo la ruta que escribió. */
export type FontDecl = {
  id     : string;
  src    : string;
  format : string;
  weight : string;
  style  : string;
};

/** Se queda con `value` solo si es una cadena que la lista blanca admite. */
function safeFontValue(value: unknown, allowed: RegExp, fallback: string): string {
  return typeof value === 'string' && allowed.test(value) ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

/**
 * El `fonts[]` del tema, endurecido. De cada fuente se toma el primer `src` que
 * declara una ruta: un tema puede ofrecer la misma cara en varios formatos, y a
 * un `@font-face` le basta con uno.
 *
 * Una fuente sin `src` utilizable se DESCARTA en vez de quedarse con la ruta
 * vacía: lo que produciría es un `@font-face` apuntando a nada, que pinta como
 * un cuadro vacío cada glifo que la nombre.
 */
export function parseFontDecls(declared: unknown): FontDecl[] {
  if (!Array.isArray(declared)) { return []; }

  const fonts: FontDecl[] = [];
  for (const entry of declared) {
    const font = asRecord(entry);
    if (!font) { continue; }

    const sources = Array.isArray(font.src) ? font.src : [];
    const source  = asRecord(sources.find(s => typeof asRecord(s)?.path === 'string'));
    if (!source) { continue; }

    fonts.push({
      id     : typeof font.id === 'string' ? font.id : '',
      src    : String(source.path),
      format : safeFontValue(source.format, SAFE_FONT_FORMAT, 'woff'),
      weight : safeFontValue(font.weight, SAFE_FONT_WEIGHT, 'normal'),
      style  : safeFontValue(font.style, SAFE_FONT_STYLE, 'normal'),
    });
  }
  return fonts;
}

/**
 * Una `font-family` construida desde el id de una fuente de un tema, segura de
 * interpolar: solo sobrevive `[A-Za-z0-9_-]`.
 *
 * El PREFIJO es del llamante, y tiene que serlo: los dos temas —el de FICHEROS y
 * el de PRODUCTO— se leen por separado y nada impide que los dos declaren una
 * fuente llamada `icons`. Un prefijo para los dos haría que el segundo
 * `@font-face` ganara, y pintaría los glifos de un tema con la fuente del otro.
 */
export function fontFamily(prefix: string, fontId: string): string {
  return `${prefix}${fontId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** El MIME apropiado para incrustar un fichero de fuente como `data:` URI. */
export function fontMimeType(fontPath: string): string {
  const dot = fontPath.lastIndexOf('.');
  switch (dot < 0 ? '' : fontPath.slice(dot).toLowerCase()) {
    case '.woff2' : return 'font/woff2';
    case '.woff'  : return 'font/woff';
    case '.ttf'   : return 'font/ttf';
    case '.otf'   : return 'font/otf';
    case '.eot'   : return 'application/vnd.ms-fontobject';
    case '.svg'   : return 'image/svg+xml';
    default       : return 'font/woff';
  }
}

/**
 * Un `@font-face`, con el fichero ya incrustado como `data:` URI: la fuente vive
 * fuera de `localResourceRoots`, así que no hay ninguna url desde la que el
 * webview pudiera pedirla.
 */
export function fontFaceBlock(family: string, dataUri: string, font: FontDecl): string {
  return `@font-face{font-family:"${family}";`
    + `src:url("${dataUri}") format("${font.format}");`
    + `font-weight:${font.weight};font-style:${font.style};}`;
}
