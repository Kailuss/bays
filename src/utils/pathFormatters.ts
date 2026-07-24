import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Opciones de formateo para rutas de archivo.
 */
export interface PathFormatterOptions {
  /** Si true, muestra la ruta relativa al workspace; si false, muestra solo el directorio padre */
  useWorkspaceRelative?: boolean;
  /** Si true, muestra el path completo (fsPath); si false, usa lógica relativa */
  useFullPath?: boolean;
  /** Separador personalizado (por defecto ' • ') */
  separator?: string;
  /** Si true, incluye el nombre del archivo en la ruta; si false, solo directorios */
  includeFileName?: boolean;
}

/**
 * Formatea la ruta de un archivo y devuelve también las partes del path.
 * Útil para truncado dinámico en el frontend (ver webview/pathTruncation.js).
 *
 * @param uri - URI del archivo a formatear
 * @param options - Opciones de formateo
 * @returns Objeto con path formateado y array de partes individuales
 */
export function formatFilePathWithParts(
  uri: vscode.Uri | undefined,
  options: PathFormatterOptions = {}
): { formatted: string; parts: string[] } {
  if (!uri) {
    return { formatted: '', parts: [] };
  }

  const {
    useWorkspaceRelative = true,
    useFullPath = false,
    separator = ' • ',
    includeFileName = false,
  } = options;

  let formattedPath: string;
  let parts: string[] = [];

  if (useFullPath) {
    formattedPath = uri.fsPath;
    parts = [uri.fsPath];
  } else if (useWorkspaceRelative) {
    // Ruta relativa al workspace.
    // OJO: asRelativePath solo devuelve una ruta con '/' cuando el archivo está
    // DENTRO de una carpeta del workspace. Si no lo está —o si no hay carpeta
    // abierta, como en el Extension Development Host lanzado sin --folder-uri—
    // devuelve el fsPath tal cual, que en Windows va con '\'. Partir solo por
    // '/' dejaba entonces un único trozo que el pop() de abajo se comía entero:
    // parts quedaba vacío, detailLabel salía '' y la fila de ruta desaparecía
    // de TODAS las bays. Por eso se parte por ambos separadores.
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    parts = relativePath.split(/[\\/]/);

    // Si NO queremos el nombre del archivo, lo quitamos
    if (!includeFileName && parts.length > 0) {
      parts.pop(); // Eliminar el nombre del archivo
    }

    // Filtrar partes vacías
    parts = parts.filter(p => p && p.trim() !== '');

    // Si no quedan directorios (archivo en root), no mostrar nada
    if (parts.length === 0) {
      return { formatted: '', parts: [] };
    }

    // Construir la ruta: directorios separados por •
    formattedPath = parts.join(separator);
  } else {
    // Solo el directorio padre
    const fullPath = uri.fsPath;
    const dirName  = path.dirname(fullPath);
    const baseName = path.basename(dirName);
    formattedPath  = baseName || dirName;
    parts = [formattedPath];
  }

  return { formatted: formattedPath, parts };
}
