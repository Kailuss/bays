import * as vscode from 'vscode';
import type { DiffType } from '../../../models/Bay';

/**
 * Clasifica un bay diff basándose en su label y URIs.
 * Retorna el tipo específico de diff para mostrar el icono y stats apropiados.
 * 
 * Tipos soportados:
 * - working-tree: Cambios en Git working tree (sin guardar)
 * - staged: Cambios en Git staged (añadidos al índice)
 * - snapshot: Snapshots de Timeline/Local History
 * - merge-conflict: Resolución de conflictos de merge
 * - incoming: Cambios entrantes (pull/merge)
 * - current: Cambios actuales (tu rama)
 * - incoming-current: Vista de merge de 3 vías
 * - unknown: Comparación genérica
 * 
 * @param label Label del bay diff
 * @param originalUri URI original (lado izquierdo del diff)
 * @param modifiedUri URI modificado (lado derecho del diff)
 * @returns Tipo de diff clasificado
 */
export function classifyDiffType(
  label: string,
  originalUri?: vscode.Uri,
  modifiedUri?: vscode.Uri
): DiffType {
  const lower = label.toLowerCase();
  
  // Tipos de diff de Git (más comunes)
  if (lower.includes('working tree') || lower === 'working tree') {
    return 'working-tree';
  }
  if (lower.includes('staged') || lower.includes('index')) {
    return 'staged';
  }
  
  // Detectar ediciones de Copilot/AI (patrón +X-Y indica líneas añadidas/eliminadas)
  // Ejemplo: "BaiaState.cs+6-6" o "file.ts +10-3"
  const editPattern = /[+]\d+[-]\d+/;
  if (editPattern.test(label)) {
    return 'edit';
  }
  
  // Detectar ediciones de Copilot por esquema (si ambos lados son chat-editing pero NO es snapshot)
  if (originalUri?.scheme === 'chat-editing-snapshot-text-model' && 
      modifiedUri?.scheme === 'chat-editing-snapshot-text-model') {
    // Si el label NO contiene "(Snapshot)", es una edición activa
    if (!lower.includes('snapshot')) {
      return 'edit';
    }
  }
  
  // Detección de Timeline/Snapshot (de extensión Local History o VS Code Timeline)
  // Los snapshots de Timeline típicamente tienen URIs con esquemas como 'git', 'file', o esquemas personalizados
  // y labels como "file.ts (Snapshot)" o solo labels de timestamp
  if (lower.includes('snapshot') || 
      lower.includes('timeline') || 
      lower.includes('local history') ||
      lower.includes('history:')) {
    return 'snapshot';
  }
  
  // Detectar commits de git (tienen hash en el label o vienen de timeline)
  // Patrón: "file.ts (abc1234)" o labels con fecha/hora del commit
  const commitHashPattern = /\b[a-f0-9]{7,40}\b/i;
  if (commitHashPattern.test(label)) {
    return 'commit';
  }
  
  // Detectar por patrones de fecha/hora (pueden ser snapshot o commit)
  if (/\d{4}-\d{2}-\d{2}/.test(label) || // Patrón de fecha YYYY-MM-DD
      /\d{1,2}:\d{2}/.test(label)) {     // Patrón de hora HH:MM
    return 'snapshot';
  }
  
  // Verificar esquemas de URI para detección de snapshot/commit
  if (originalUri || modifiedUri) {
    const originalScheme = originalUri?.scheme;
    const modifiedScheme = modifiedUri?.scheme;
    const originalQuery = originalUri?.query || '';
    const modifiedQuery = modifiedUri?.query || '';
    
    // Git scheme con ref específico = commit
    if (originalScheme === 'git' && (originalQuery.includes('ref=') || commitHashPattern.test(originalQuery))) {
      return 'commit';
    }
    
    // Timeline/Copilot/Git usa esquemas especiales
    if (originalScheme === 'git' || 
        originalScheme === 'timeline' ||
        originalScheme === 'chat-editing-snapshot-text-model' ||
        originalScheme?.startsWith('vscode-timeline') ||
        modifiedScheme === 'timeline' ||
        modifiedScheme === 'chat-editing-snapshot-text-model' ||
        modifiedScheme?.startsWith('vscode-timeline')) {
      return 'snapshot';
    }
  }
  
  // Tipos de conflicto de merge
  if (lower.includes('merge conflict') || lower.includes('conflict')) {
    return 'merge-conflict';
  }
  if (lower.includes('incoming')) {
    if (lower.includes('current')) {
      return 'incoming-current';
    }
    return 'incoming';
  }
  if (lower.includes('current')) {
    return 'current';
  }
  
  // Vistas de comparación (comparación manual de archivos)
  // Típicamente tienen "↔" o "vs" en el label
  if (lower.includes('↔') || 
      lower.includes(' vs ') || 
      lower.includes('compare') ||
      lower.includes('comparing')) {
    // Si se comparan dos archivos diferentes (no el mismo archivo en diferentes momentos),
    // esto es una comparación genérica, no un snapshot
    if (originalUri && modifiedUri && 
        originalUri.path !== modifiedUri.path) {
      return 'unknown'; // Comparación genérica entre archivos diferentes
    }
    return 'snapshot'; // Mismo archivo, versiones diferentes
  }
  
  return 'unknown';
}

/**
 * Determina el parentId para un bay diff.
 * 
 * Reglas:
 * - Snapshots/working-tree/staged/merge-conflict: parent es el archivo actual
 * - Compare del mismo archivo: parent es el archivo actual
 * - Compare de archivos diferentes: sin parent (tabs independientes)
 * - Incoming/current/incoming-current: parent es el archivo siendo mergeado
 * 
 * @param diffType Tipo de diff clasificado
 * @param uri URI del archivo (modificado/derecho)
 * @param viewColumn Columna del bay
 * @param originalUri URI original (lado izquierdo del diff)
 * @param modifiedUri URI modificado (lado derecho del diff)
 * @returns ID del parent, o undefined si es bay independiente
 */
export function determineParentId(
  diffType: DiffType,
  uri: vscode.Uri | undefined,
  viewColumn: vscode.ViewColumn,
  originalUri?: vscode.Uri,
  modifiedUri?: vscode.Uri
): string | undefined {
  if (!uri) {
    return undefined;
  }

  // Para snapshots/timeline/commits/ediciones comparando el mismo archivo en diferentes momentos,
  // el parent es la versión actual de ese archivo
  if (diffType === 'snapshot' || 
      diffType === 'commit' ||
      diffType === 'edit' ||
      diffType === 'working-tree' || 
      diffType === 'staged' || 
      diffType === 'merge-conflict') {
    // Si el URI es de un esquema especial (snapshot, git, timeline),
    // necesitamos convertirlo al URI del archivo real
    let parentUri = uri;
    
    if (uri.scheme === 'chat-editing-snapshot-text-model' || 
        uri.scheme === 'git' || 
        uri.scheme === 'timeline' || 
        uri.scheme.startsWith('vscode-timeline')) {
      // Convertir a file:// URI usando el path
      parentUri = vscode.Uri.file(uri.path);
    }
    
    // Parent es el bay del archivo con el mismo URI en el mismo grupo
    return `${parentUri.toString()}-${viewColumn}`;
  }
  
  if (diffType === 'unknown') {
    // Comparación genérica - verificar si es el mismo archivo
    if (originalUri && modifiedUri) {
      if (originalUri.path === modifiedUri.path) {
        // Mismo archivo, versiones diferentes (ej., comparación remota)
        return `${uri.toString()}-${viewColumn}`;
      } else {
        // Comparación entre archivos diferentes (Compare with Active Editor)
        // Parent es el archivo original (izquierdo) que estaba activo cuando se inició la comparación
        return `${originalUri.toString()}-${viewColumn}`;
      }
    }
    // Sin URIs suficientes, dejar sin parent
    return undefined;
  }
  
  // Para incoming/current/incoming-current, vincular al archivo siendo mergeado
  if (diffType === 'incoming' || diffType === 'current' || diffType === 'incoming-current') {
    return `${uri.toString()}-${viewColumn}`;
  }
  
  return undefined;
}
