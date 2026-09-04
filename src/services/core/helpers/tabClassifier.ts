import * as vscode from 'vscode';
import type { DiffType } from '../../../models/Bay';
import { fileBayId } from '../../../utils/idRules';
import { classifyDiff } from '../../../utils/diffRules';

/**
 * Clasifica un bay diff según su label y URIs.
 * Detecta working-tree, staged, snapshot, commit, edit, merge-conflict y unknown.
 */
export function classifyDiffType(
  label: string,
  originalUri?: vscode.Uri,
  modifiedUri?: vscode.Uri
): DiffType {
  // La regla vive en `utils/diffRules.ts` y es pura: de una URI solo mira su
  // esquema, su query y su path, así que aquí se le entregan como cadenas.
  return classifyDiff(label, originalUri, modifiedUri);
}

/**
 * Normaliza la URI de una variante a la URI del ARCHIVO REAL que hace de parent.
 *
 * Los diffs de git, timeline y snapshots de chat exponen URIs con esquema propio
 * (`git:`, `timeline:`, `chat-editing-snapshot-text-model:`) cuyo `path` sí es la
 * ruta del archivo. Usar la URI tal cual rompe dos cosas: el id del parent no
 * coincide con el de la bay del archivo (la variante queda huérfana y se dibuja
 * como fila de parent) y abrirla crea una pestaña fantasma con el contenido del
 * índice/snapshot en vez del archivo.
 */
export function resolveSourceUri(uri: vscode.Uri): vscode.Uri {
  if (uri.scheme === 'chat-editing-snapshot-text-model' ||
      uri.scheme === 'git' ||
      uri.scheme === 'timeline' ||
      uri.scheme.startsWith('vscode-timeline')) {
    return vscode.Uri.file(uri.path);
  }
  return uri;
}

/**
 * Determina la URI del parent de un bay diff.
 * Snapshots/working-tree/staged → parent es el archivo actual.
 * Compare de dos archivos distintos → parent es el archivo original.
 */
export function determineParentUri(
  diffType: DiffType,
  uri: vscode.Uri | undefined,
  originalUri?: vscode.Uri,
  modifiedUri?: vscode.Uri
): vscode.Uri | undefined {
  if (!uri) {
    return undefined;
  }

  if (diffType === 'snapshot' ||
      diffType === 'commit' ||
      diffType === 'edit' ||
      diffType === 'working-tree' ||
      diffType === 'staged' ||
      diffType === 'merge-conflict') {
    return resolveSourceUri(uri);
  }

  if (diffType === 'unknown') {
    if (originalUri && modifiedUri) {
      return originalUri.path === modifiedUri.path
        ? resolveSourceUri(uri)
        : resolveSourceUri(originalUri);
    }
    return undefined;
  }

  if (diffType === 'incoming' || diffType === 'current' || diffType === 'incoming-current') {
    return resolveSourceUri(uri);
  }

  return undefined;
}

/**
 * Determina el parentId para un bay diff.
 * Deriva de `determineParentUri` para que el id apunte SIEMPRE a la misma URI
 * que después se busca/abre al garantizar el parent.
 */
export function determineParentId(
  diffType: DiffType,
  uri: vscode.Uri | undefined,
  viewColumn: vscode.ViewColumn,
  originalUri?: vscode.Uri,
  modifiedUri?: vscode.Uri
): string | undefined {
  const parentUri = determineParentUri(diffType, uri, originalUri, modifiedUri);
  return parentUri ? fileBayId(parentUri.toString(), viewColumn) : undefined;
}
