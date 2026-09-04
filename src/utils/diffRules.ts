import type { DiffType } from '../models/BayTypes';

/**
 * Qué CLASE de comparación es una variante, como REGLA PURA.
 *
 * Todo lo que mira de una URI son tres cadenas (`scheme`, `query`, `path`), así
 * que la regla las recibe en vez de recibir una `vscode.Uri`: es un montón de
 * casos con orden entre ellos —lo escrito en el label gana a lo deducido del
 * esquema, y un patrón de edición gana a un hash que casualmente case— y esa
 * clase de cosa se fija con tests o se rompe sin que nadie lo note.
 *
 * El adaptador que le pasa una `vscode.Uri` vive en
 * `services/core/helpers/tabClassifier.ts`.
 */

/** Lo único que la clasificación necesita de una URI. */
export type UriFacts = {
  scheme : string;
  query? : string;
  path?  : string;
};

export function classifyDiff(
  label: string,
  originalUri?: UriFacts,
  modifiedUri?: UriFacts,
): DiffType {
  const lower = label.toLowerCase();

  if (lower.includes('working tree') || lower === 'working tree') {
    return 'working-tree';
  }
  if (lower.includes('staged') || lower.includes('index')) {
    return 'staged';
  }

  // Copilot/AI edits: pattern +X-Y (added/removed lines)
  const editPattern = /[+]\d+[-]\d+/;
  if (editPattern.test(label)) {
    return 'edit';
  }

  if (originalUri?.scheme === 'chat-editing-snapshot-text-model' && 
      modifiedUri?.scheme === 'chat-editing-snapshot-text-model') {
    if (!lower.includes('snapshot')) {
      return 'edit';
    }
  }

  if (lower.includes('snapshot') || 
      lower.includes('timeline') || 
      lower.includes('local history') ||
      lower.includes('history:')) {
    return 'snapshot';
  }

  const commitHashPattern = /\b[a-f0-9]{7,40}\b/i;
  if (commitHashPattern.test(label)) {
    return 'commit';
  }

  if (/\d{4}-\d{2}-\d{2}/.test(label) ||
      /\d{1,2}:\d{2}/.test(label)) {
    return 'snapshot';
  }

  if (originalUri || modifiedUri) {
    const originalScheme = originalUri?.scheme;
    const modifiedScheme = modifiedUri?.scheme;
    const originalQuery = originalUri?.query || '';

    if (originalScheme === 'git' && (originalQuery.includes('ref=') || commitHashPattern.test(originalQuery))) {
      return 'commit';
    }

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

  if (lower.includes('↔') || 
      lower.includes(' vs ') || 
      lower.includes('compare') ||
      lower.includes('comparing')) {
    if (originalUri && modifiedUri && 
        originalUri.path !== modifiedUri.path) {
      return 'unknown';
    }
    return 'snapshot';
  }

  return 'unknown';
}
