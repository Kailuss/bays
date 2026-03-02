import { SideTab } from '../models/Bay';

/**
 * Builds the state indicator HTML + CSS class for a bay.
 * Priority: diagnostic error > diagnostic warning > git status > dirty > clean.
 */
export function getStateIndicator(bay: SideTab): { html: string; nameClass: string } {

  // ── Diagnósticos ────────────────────────────────────────────────────────────
  if (bay.state.diagnosticSeverity === 0) {
    return {
      html      : '<span class="bay-state state-error" title="Error"><span class="codicon codicon-error"></span></span>',
      nameClass : ' error',
    };
  }
  if (bay.state.diagnosticSeverity === 1) {
    return {
      html      : '<span class="bay-state state-warning" title="Warning"><span class="codicon codicon-warning"></span></span>',
      nameClass : ' warning',
    };
  }

  // ── Estado Git ───────────────────────────────────────────────────────────────
  switch (bay.state.gitStatus) {
    case 'modified':
      return {
        html      : '<span class="bay-state state-modified" title="Modified"><span class="codicon codicon-diff-modified"></span></span>',
        nameClass : ' modified',
      };
    case 'added':
      return {
        html      : '<span class="bay-state state-added" title="Added (Staged)"><span class="codicon codicon-diff-added"></span></span>',
        nameClass : ' added',
      };
    case 'deleted':
      return {
        html      : '<span class="bay-state state-deleted" title="Deleted"><span class="codicon codicon-diff-removed"></span></span>',
        nameClass : ' deleted',
      };
    case 'untracked':
      return {
        html      : '<span class="bay-state state-untracked" title="Untracked"><span class="codicon codicon-diff-added"></span></span>',
        nameClass : ' untracked',
      };
    case 'ignored':
      return {
        html      : '<span class="bay-state state-ignored" title="Ignored"><span class="codicon codicon-circle-slash"></span></span>',
        nameClass : ' ignored',
      };
    case 'conflict':
      return {
        html      : '<span class="bay-state state-conflict" title="Conflict"><span class="codicon codicon-diff-ignored"></span></span>',
        nameClass : ' conflict',
      };
  }

  // ── Dirty (sin contexto git) ─────────────────────────────────────────────────
  if (bay.state.isDirty) {
    return {
      html      : '<span class="bay-state state-dirty" title="Unsaved"><span class="codicon codicon-close-dirty"></span></span>',
      nameClass : ' modified',
    };
  }

  // ── Clean ────────────────────────────────────────────────────────────────────
  return {
    html      : '<span class="bay-state clean"></span>',
    nameClass : '',
  };
}
