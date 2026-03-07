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
 * Formatea la ruta de un archivo para mostrar en la UI de tabs.
 * Por defecto:
 * - Usa ' • ' como separador entre directorios
 * - NO incluye el nombre del archivo (solo directorios)
 * - El directorio root se marca con ● sin • después
 * 
 * @param uri - URI del archivo a formatear
 * @param options - Opciones de formateo
 * @returns Ruta formateada como string
 * 
 * @example
 * ```ts
 * // Ruta de directorios con ' • ' como separador
 * formatFilePath(uri)
 * // => "● • src • services"
 * 
 * // Con nombre de archivo incluido
 * formatFilePath(uri, { includeFileName: true })
 * // => "● • src • services • TabSyncService.ts"
 * 
 * // Solo directorio padre
 * formatFilePath(uri, { useWorkspaceRelative: false })
 * // => "services"
 * ```
 */
export function formatFilePath(
  uri: vscode.Uri | undefined,
  options: PathFormatterOptions = {}
): string {
  const result = formatFilePathWithParts(uri, options);
  return result.formatted;
}

/**
 * Similar a formatFilePath pero devuelve también las partes del path.
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
    // Ruta relativa al workspace
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    // Normalizar separadores: asRelativePath usa '/' en todas las plataformas
    parts = relativePath.split('/');
    
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

/**
 * Obtiene el directorio padre de un archivo.
 * 
 * @param uri - URI del archivo
 * @param levels - Número de niveles hacia arriba (1 = padre directo, 2 = abuelo, etc.)
 * @returns Nombre del directorio o ruta completa
 * 
 * @example
 * ```ts
 * getParentDirectory(uri, 1) // => "services"
 * getParentDirectory(uri, 2) // => "src"
 * ```
 */
export function getParentDirectory(
  uri: vscode.Uri | undefined,
  levels: number = 1
): string {
  if (!uri) {
    return '';
  }

  let dirPath = path.dirname(uri.fsPath);
  
  for (let i = 1; i < levels; i++) {
    dirPath = path.dirname(dirPath);
  }

  return path.basename(dirPath) || dirPath;
}

/**
 * Obtiene la ruta relativa al workspace con formato personalizado.
 * 
 * @param uri - URI del archivo
 * @param style - Estilo de formato: 'full', 'compact', 'minimal'
 * @returns Ruta formateada
 * 
 * @example
 * ```ts
 * // 'full': muestra toda la ruta relativa
 * getWorkspaceRelativePath(uri, 'full')
 * // => "src/services/TabSyncService.ts"
 * 
 * // 'compact': muestra directorio + archivo
 * getWorkspaceRelativePath(uri, 'compact')
 * // => "services/TabSyncService.ts"
 * 
 * // 'minimal': solo directorio
 * getWorkspaceRelativePath(uri, 'minimal')
 * // => "services"
 * ```
 */
export function getWorkspaceRelativePath(
  uri: vscode.Uri | undefined,
  style: 'full' | 'compact' | 'minimal' = 'full'
): string {
  if (!uri) {
    return '';
  }

  const relativePath = vscode.workspace.asRelativePath(uri, false);
  
  switch (style) {
    case 'full':
      return relativePath;
    
    case 'compact': {
      const parts = relativePath.split(path.sep);
      if (parts.length <= 2) {
        return relativePath;
      }
      // Retorna solo las últimas 2 partes (directorio + archivo)
      return parts.slice(-2).join(path.sep);
    }
    
    case 'minimal':
      return getParentDirectory(uri, 1);
    
    default:
      return relativePath;
  }
}
