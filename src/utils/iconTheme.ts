// Qué se lee del JSON de un tema de iconos, y cómo se lee.
//
// Ese JSON es de una extensión de TERCEROS: no hay tipo que lo describa y no hay
// nada que garantice su forma. La respuesta NO es `any` — `any` deja que la
// comprobación falte y compile igual — sino `unknown` más narradores: un tipo
// que declara qué campos se leen y los deja todos sin forma, y tres funciones
// que solo dejan pasar lo que de verdad es del tipo que se espera.
//
// Es la misma disciplina que `utils/themeFonts.ts` aplica a `fonts[]`: aquélla
// endurece lo que acaba dentro de un `<style>`, y ésta impide que un valor de
// otra clase se cuele como si fuera una cadena.

/** Las claves del tema que esta extensión mira. Todas sin forma a propósito. */
export type IconThemeJson = {
  /** Id de la definición del icono de fichero por defecto. */
  file?           : unknown;
  fileNames?      : unknown;
  fileExtensions? : unknown;
  languageIds?    : unknown;
  fonts?          : unknown;
  iconDefinitions?: unknown;
};

/** Una definición de icono, con solo los campos que el renderer usa. */
export type IconDefinition = {
  iconPath?      : string;
  path?          : string;
  fontCharacter? : string;
  fontColor?     : string;
  fontId?        : string;
  fontSize?      : string;
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Los pares `clave → id de icono` de uno de los tres mapas del tema
 * (`fileNames`, `fileExtensions`, `languageIds`), con la clave ya en minúsculas.
 *
 * Un valor que no sea una cadena se DESCARTA en vez de castearse: el código
 * anterior hacía `value as string` sin mirar, y un tema que declarara un objeto
 * ahí metía `[object Object]` en el mapa de iconos, donde no falla nunca de
 * forma ruidosa: sencillamente ningún fichero de ese tipo encuentra su icono.
 */
export function iconIdEntries(map: unknown): [string, string][] {
  const record = asRecord(map);
  if (!record) { return []; }

  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(record)) {
    const id = asString(value);
    if (id) { out.push([key.toLowerCase(), id]); }
  }
  return out;
}

/** La definición de un icono del tema, o `null` si no la hay o no es un objeto. */
export function iconDefinition(definitions: unknown, id: string): IconDefinition | null {
  const defs = asRecord(definitions);
  if (!defs) { return null; }

  const def = asRecord(defs[id]);
  if (!def) { return null; }

  return {
    iconPath      : asString(def.iconPath),
    path          : asString(def.path),
    fontCharacter : asString(def.fontCharacter),
    fontColor     : asString(def.fontColor),
    fontId        : asString(def.fontId),
    fontSize      : asString(def.fontSize),
  };
}

/** Los ids que el tema declara en `iconDefinitions`. */
export function iconDefinitionIds(definitions: unknown): string[] {
  const defs = asRecord(definitions);
  return defs ? Object.keys(defs) : [];
}
