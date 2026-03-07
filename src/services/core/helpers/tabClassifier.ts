import * as vscode from 'vscode';
import type { DiffType } from '../../../models/Bay';

/**
 * Clasifica un bay diff según su label y URIs.
 * Detecta working-tree, staged, snapshot, commit, edit, merge-conflict y unknown.
 */
export function classifyDiffType(
  label: string,
  originalUri?: vscode.Uri,
  modifiedUri?: vscode.Uri
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
    const modifiedQuery = modifiedUri?.query || '';

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

/**
 * Determina el parentId para un bay diff.
 * Snapshots/working-tree/staged → parent es archivo actual.
 * Compare diferentes archivos → sin parent.
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

  if (diffType === 'snapshot' || 
      diffType === 'commit' ||
      diffType === 'edit' ||
      diffType === 'working-tree' || 
      diffType === 'staged' || 
      diffType === 'merge-conflict') {
    let parentUri = uri;

    if (uri.scheme === 'chat-editing-snapshot-text-model' || 
        uri.scheme === 'git' || 
        uri.scheme === 'timeline' || 
        uri.scheme.startsWith('vscode-timeline')) {
      parentUri = vscode.Uri.file(uri.path);
    }

    return `${parentUri.toString()}-${viewColumn}`;
  }

  if (diffType === 'unknown') {
    if (originalUri && modifiedUri) {
      if (originalUri.path === modifiedUri.path) {
        return `${uri.toString()}-${viewColumn}`;
      } else {
        return `${originalUri.toString()}-${viewColumn}`;
      }
    }
    return undefined;
  }

  if (diffType === 'incoming' || diffType === 'current' || diffType === 'incoming-current') {
    return `${uri.toString()}-${viewColumn}`;
  }

  return undefined;
}
