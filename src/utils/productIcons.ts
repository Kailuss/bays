// Lo que un tema de iconos de PRODUCTO redefine, como CSS que el webview puede
// aplicar por encima de `codicon.css`.
//
// Un product icon theme (`workbench.productIconTheme`) es una fuente más un mapa
// de id de codicon → codepoint, así que redibuja los glifos del propio workbench
// y nada más: los iconos de fichero son del OTRO tema (`workbench.iconTheme`).
// Dentro del panel, esto es la diferencia entre una vista dibujada con las
// marcas que lleva el resto del editor y una que se quedó en los codicons que la
// extensión trae.
//
// El REPLIEGUE sale gratis y es lo que hace la feature expresable: un tema
// redefine POR ID, así que un id del que no diga nada se queda con la regla que
// `codicon.css` ya tiene cargada — siempre que lo que se escribe aquí vaya
// DESPUÉS de ella en el documento. Eso lo garantiza el orden de los elementos
// del shell (`BaysHtmlBuilder.buildShell`), y es lo único de esto que no se
// puede comprobar desde aquí.

import type { FontDecl } from './themeFonts';

/** Prefijo de las font-family que declara este tema; ver `fontFamily`. */
export const PRODUCT_FONT_PREFIX = 'bays-product-';

/**
 * Un id de codicon, que es lo que una clave de `iconDefinitions` es. Va a un
 * SELECTOR de clase, así que cualquier otra cosa o no casaría con nada o lo
 * cerraría: la lista blanca es la forma que el propio codicon usa y nada más
 * ancha.
 */
const SAFE_ICON_ID = /^[a-z0-9-]+$/;

/**
 * Un `fontCharacter` tal y como lo escribe el tema: una barra y hasta seis
 * dígitos hexadecimales. Se interpola en una cadena de `content`, así que el
 * escape tiene que ser uno que el CSS pueda leer de vuelta — la misma
 * comprobación que `utils/iconHtml.ts` le hace al codepoint que mete en un
 * `&#x…;`.
 */
const SAFE_FONT_CHARACTER = /^\\([0-9a-fA-F]{1,6})$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Una regla por cada icono que el tema redefine. Los `@font-face` los construye
 * el llamante, y hacen falta las dos mitades para que nada se dibuje: la regla
 * nombra una familia y la familia tiene que existir.
 *
 * Una definición se DESCARTA, nunca se adivina, cuando su id o su codepoint no
 * encajan: un id que esto no sepa deletrear sería en el mejor de los casos un
 * selector que no casa con nada, y lo que cuesta un icono descartado es el
 * codicon que la extensión trae, que es lo que la vista llevaba antes de todo
 * esto.
 */
export function productIconRules(iconDefinitions: unknown, fonts: readonly FontDecl[]): string {
  const definitions = asRecord(iconDefinitions);
  if (!definitions || fonts.length === 0) { return ''; }

  // Una definición puede nombrar de qué fuente salió; la mayoría no nombran
  // ninguna, y entonces es la PRIMERA declarada, que es como lo lee VS Code.
  const declared = new Set(fonts.map(font => font.id));
  const rules: string[] = [];

  for (const [id, value] of Object.entries(definitions)) {
    if (!SAFE_ICON_ID.test(id)) { continue; }

    const definition = asRecord(value);
    const raw = definition?.fontCharacter;
    const character = typeof raw === 'string' ? SAFE_FONT_CHARACTER.exec(raw) : null;
    if (!character) { continue; }

    // Un `fontId` desconocido cae en la primera fuente en vez de descartar el
    // icono: el codepoint sigue siendo de este tema, y un tema que tecleó mal un
    // id es mucho más probable que tenga una sola fuente a que quisiera decir
    // otra.
    const fontId = definition?.fontId;
    const named  = typeof fontId === 'string' && declared.has(fontId) ? fontId : fonts[0].id;
    const family = `${PRODUCT_FONT_PREFIX}${named.replace(/[^a-zA-Z0-9_-]/g, '')}`;

    // El ELEMENTO lleva `font-family: codicon` de `codicon.css`, así que la regla
    // tiene que decir la familia en el pseudoelemento en el que dibuja. El
    // TAMAÑO no se toca a propósito: cómo de grande se dibuja un glifo es una
    // respuesta de esta vista y no del tema.
    rules.push(`.codicon-${id}::before{content:"\\${character[1]}";font-family:"${family}"}`);
  }

  return rules.join('\n');
}
