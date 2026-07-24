// Contrato de los "marcadores" de icono que BayIconManager guarda en caché y que
// IconRenderer convierte en HTML. Vive aquí (utils) y no en providers/html para
// que el servicio no tenga que importar de la capa de vista.
//
// Formatos:
//   "data:image/svg+xml;base64,…"        → icono SVG/PNG del tema
//   "font-icon:<char>:<color>:<fontId>:<fontSize>"  → tema basado en fuente
//   "default-file"                       → sin icono utilizable; el renderer
//                                          dibuja su SVG genérico

/** Marcador de "no hay icono del tema; usa el SVG genérico del renderer". */
export const DEFAULT_FILE_ICON = 'default-file';

const FONT_ICON_PREFIX = 'font-icon:';

/** Prefijo de las font-family que se declaran vía @font-face para el tema activo. */
export function iconFontFamily(fontId: string): string {
  return `bays-icon-${fontId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/**
 * Serializa un icono basado en fuente.
 * `fontCharacter` llega del tema como "\\E023" y no contiene ':', igual que el
 * color (#rrggbb) y el tamaño ("150%"), así que separar por ':' es seguro.
 */
export function buildFontIconMarker(
  fontCharacter : string,
  fontColor     : string,
  fontId        : string,
  fontSize      : string,
): string {
  return `${FONT_ICON_PREFIX}${fontCharacter}:${fontColor}:${fontId}:${fontSize}`;
}

export type ParsedFontIcon = {
  hexCode  : string;
  color    : string;
  fontId   : string;
  fontSize : string;
};

/** Devuelve los campos de un marcador de fuente, o null si no lo es. */
export function parseFontIconMarker(marker: string): ParsedFontIcon | null {
  if (!marker.startsWith(FONT_ICON_PREFIX)) { return null; }

  const parts = marker.split(':');
  return {
    // El tema escribe el codepoint como "\E023"; el HTML lo necesita sin barra.
    hexCode  : (parts[1] || '').replace(/\\/g, ''),
    color    : parts[2] || '#cccccc',
    fontId   : parts[3] || '',
    fontSize : parts[4] || '',
  };
}
