import * as path from 'path';

/**
 * Qué se pinta en la fila de ruta de una bay, como REGLA PURA.
 *
 * Vive aquí y no junto a `platform/pathFormatters.ts` porque el único trozo de
 * esto que necesita VS Code es resolver la ruta relativa al workspace; todo lo
 * demás es aritmética de cadenas, y separada se puede fijar con tests que corren
 * en milisegundos en vez de dentro de un extension host.
 *
 * De ahí la forma: la regla RECIBE lo que la plataforma resuelve
 * (`relativePath`, `fsPath`) en vez de importarlo.
 */

export interface PathPartsOptions {
  /** Ruta relativa al workspace; si es false, solo el directorio padre. */
  useWorkspaceRelative?: boolean;
  /** Ruta absoluta completa, como una sola parte. Gana sobre la anterior. */
  useFullPath?: boolean;
  /** Separador con el que se unen las partes. */
  separator?: string;
  /** Incluir el nombre del fichero como última parte. */
  includeFileName?: boolean;
}

export interface PathParts {
  formatted: string;
  parts: string[];
}

/** El separador por defecto de la fila de ruta. Se declara UNA vez. */
export const PATH_SEPARATOR = ' • ';

/**
 * @param resolved.relativePath lo que `asRelativePath` haya contestado. OJO: solo
 *   devuelve una ruta con '/' cuando el fichero está DENTRO de una carpeta del
 *   workspace. Si no lo está —o si no hay ninguna abierta, como en el Extension
 *   Development Host lanzado sin `--folder-uri`— devuelve el fsPath tal cual, que
 *   en Windows va con '\'. Partir solo por '/' dejaba entonces un único trozo que
 *   el pop() de abajo se comía entero: `parts` quedaba vacío, `detailLabel` salía
 *   '' y la fila de ruta desaparecía de TODAS las bays. Por eso se parte por los
 *   dos separadores.
 * @param resolved.fsPath la ruta absoluta, para los dos modos que no son relativos.
 */
export function splitPathParts(
  resolved: { relativePath: string; fsPath: string },
  options: PathPartsOptions = {},
): PathParts {
  const {
    useWorkspaceRelative = true,
    useFullPath = false,
    separator = PATH_SEPARATOR,
    includeFileName = false,
  } = options;

  if (useFullPath) {
    return { formatted: resolved.fsPath, parts: [resolved.fsPath] };
  }

  if (useWorkspaceRelative) {
    let parts = resolved.relativePath.split(/[\\/]/);

    if (!includeFileName && parts.length > 0) {
      parts.pop();
    }

    parts = parts.filter(p => p && p.trim() !== '');

    // Un fichero en la raíz no tiene directorios que enseñar: la fila de ruta
    // no se dibuja en vez de dibujarse vacía.
    if (parts.length === 0) {
      return { formatted: '', parts: [] };
    }

    return { formatted: parts.join(separator), parts };
  }

  const dirName  = path.dirname(resolved.fsPath);
  const baseName = path.basename(dirName);
  const formatted = baseName || dirName;
  return { formatted, parts: [formatted] };
}
