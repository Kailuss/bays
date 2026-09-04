import * as vscode from 'vscode';
import { splitPathParts } from '../utils/pathParts';
import type { PathPartsOptions, PathParts } from '../utils/pathParts';

export type { PathPartsOptions as PathFormatterOptions } from '../utils/pathParts';

/**
 * Adaptador sobre `asRelativePath`: lo ÚNICO de formatear una ruta que necesita
 * el API de VS Code.
 *
 * La regla vive en `utils/pathParts.ts`, que es puro y tiene tests; aquí solo se
 * resuelve lo que la regla pide. Es la misma división por la que `utils/` no
 * importa `vscode` en ningún fichero: lo que decide algo se puede probar sin
 * levantar un extension host.
 *
 * `parts` es lo que el cliente usa para truncar la ruta a lo ancho de la fila
 * (`webview/pathTruncation.ts`).
 */
export function formatFilePathWithParts(
  uri: vscode.Uri | undefined,
  options: PathPartsOptions = {},
): PathParts {
  if (!uri) {
    return { formatted: '', parts: [] };
  }

  return splitPathParts(
    { relativePath: vscode.workspace.asRelativePath(uri, false), fsPath: uri.fsPath },
    options,
  );
}
