/**
 * Los vocabularios de la bay que no necesitan `vscode`.
 *
 * Viven aparte de `models/Bay.ts` porque las reglas puras de `utils/` los usan,
 * y esa carpeta no puede importar nada que arrastre el API del editor: es su
 * definición entera y lo que la mantiene testeable sin un extension host.
 * `Bay.ts` los reexporta, así que nada más se entera de la partición.
 */

/** Qué CLASE de tab nativa hay detrás de una bay. */
export type BayType = 'file' | 'webview' | 'custom' | 'notebook';

/** Qué clase de comparación es una variante. */
export type DiffType =
  | 'working-tree' | 'staged' | 'snapshot' | 'commit' | 'edit'
  | 'merge-conflict' | 'incoming' | 'current' | 'incoming-current'
  | 'preview' | 'unknown';

/** Estado de git de un fichero, tal y como lo decora la vista. */
export type GitStatus =
  | 'modified' | 'added' | 'deleted' | 'untracked' | 'ignored' | 'conflict' | null;
