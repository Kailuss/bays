/**
 * Configuración de visualización para cada tipo de diff (child bay).
 * 
 * Define iconos codicon y labels descriptivos para cada tipo.
 */

import type { DiffType } from '../models/Bay';

/**
 * Información de visualización para un tipo de diff
 */
export type DiffTypeDisplayInfo = {
  icon     : string; // Codicon icon name (sin prefijo 'codicon-')
  label    : string; // Label descriptivo del tipo
  tooltip? : string; // Tooltip extendido (opcional)
  cssClass?: string; // Clase CSS adicional (opcional)
}

/**
 * Mapa de DiffType a su información de visualización.
 * 
 * Iconos disponibles: https://microsoft.github.io/vscode-codicons/dist/codicon.html
 */
/**
 * Display configuration for different types of file diffs in the version control system.
 * 
 * Maps each {@link DiffType} to its visual representation and metadata, including:
 * - **icon**: VS Code codicon identifier for visual representation
 * - **label**: Human-readable short name
 * - **tooltip**: Detailed description shown on hover
 * - **cssClass**: CSS class for styling
 * 
 * @remarks
 * Supported diff types include:
 * - `working-tree`: Uncommitted local changes
 * - `staged`: Changes added to staging area
 * - `snapshot`: Point-in-time file state
 * - `commit`: File state at specific commit
 * - `edit`: AI/Copilot generated changes
 * - `merge-conflict`: Files with unresolved conflicts
 * - `incoming`: Changes from remote (fetch/pull)
 * - `current`: Local branch changes
 * - `incoming-current`: Merge comparison view
 * - `unknown`: Generic file comparison
 * 
 * @example
 * ```typescript
 * const workingTreeInfo = DIFF_TYPE_DISPLAY['working-tree'];
 * // { icon: 'diff', label: 'Working Tree', ... }
 * ```
 * 
 * @see {@link DiffType} for the union type of all diff types
 * @see {@link DiffTypeDisplayInfo} for the structure of display information
 */
export const DIFF_TYPE_DISPLAY: Record<DiffType, DiffTypeDisplayInfo> = {
  'working-tree':{
    // TODO: El Icono debería ser 'Workingtree' pero no FunctionBreakpoint.
    icon     :'worktree',
    label    :'Working Tree',
    tooltip  :'Uncommitted changes in working tree',
    cssClass :'diff-working-tree',
  },
  'staged':{
    icon     :'check',
    label    :'Staged',
    tooltip  :'Staged changes ready to commit',
    cssClass :'diff-staged',
  },
  'snapshot':{
    icon     :'screen-full',
    label    :'Snapshot',
    tooltip  :'Point-in-time snapshot of file',
    cssClass :'diff-snapshot',
  },
  'commit':{
    icon     :'git-commit',
    label    :'Commit',
    tooltip  :'File at specific commit',
    cssClass :'diff-commit',
  },
  'edit':{
    icon     :'sparkle-filled',
    label    :'Edit',
    tooltip  :'AI/Copilot edit',
    cssClass :'diff-edit',
  },
  'merge-conflict':{
    icon     :'git-branch-conflicts',
    label    :'Conflict',
    tooltip  :'Merge conflict - requires resolution',
    cssClass :'diff-conflict',
  },
  'incoming':{
    icon     :'git-fetch',
    label    :'Incoming',
    tooltip  :'Incoming changes from remote',
    cssClass :'diff-incoming',
  },
  'current':{
    icon     :'arrow-up',
    label    :'Current',
    tooltip  :'Current local changes',
    cssClass :'diff-current',
  },
  'incoming-current':{
    icon     :'git-pull-request',
    label    :'Merge',
    tooltip  :'Comparing incoming and current changes',
    cssClass :'diff-merge',
  },
  'unknown':{
    icon     :'diff',
    label    :'Compare',
    tooltip  :'File comparison',
    cssClass :'diff-compare',
  },
};

/**
 * Obtiene la información de visualización para un tipo de diff.
 * 
 * @param diffType Tipo de diff (puede ser undefined)
 * @param tabLabel Label completo de la native tab (para extraer info adicional como commit hash)
 * @returns Información de visualización, o null si no hay diffType
 */
export function getDiffTypeDisplay(
  diffType: DiffType | undefined,
  tabLabel?: string,
): DiffTypeDisplayInfo | null {
  if (!diffType) {
    return null;
  }
  
  const info = DIFF_TYPE_DISPLAY[diffType];
  
  // Para commits, extraer el hash y formatear como "Commit abc1234"
  if (diffType === 'commit' && tabLabel) {
    const hashMatch = tabLabel.match(/\b([a-f0-9]{7,8})\b/i);
    if (hashMatch) {
      return {
        ...info,
        label: `Commit ${hashMatch[1]}`,
        tooltip: `File at commit ${hashMatch[1]}`,
      };
    }
  }
  
  // Para ediciones de Copilot, mantener label genérico "Edit"
  if (diffType === 'edit' && tabLabel) {
    return {
      ...info,
      label: 'Edit',
      tooltip: 'Copilot/AI edit',
    };
  }
  
  // Para 'unknown' (compare genérico), formatear como "Compare to {file}"
  if (diffType === 'unknown' && tabLabel) {
    // Extraer nombre de archivo del label si está en formato "file1 ↔ file2"
    const parts = tabLabel.split('↔').map(s => s.trim());
    if (parts.length === 2 && parts[0] !== parts[1]) {
      // Usar solo el nombre del archivo, no la ruta completa
      const fileName = parts[0].split(/[/\\]/).pop() || parts[0];
      return {
        ...info,
        label: `Compare to ${fileName}`,
        tooltip: `Comparing with ${fileName}`,
      };
    }
  }
  
  return info;
}

/**
 * Genera HTML del icono codicon para un tipo de diff.
 */
export function getDiffTypeIconHtml(diffType: DiffType | undefined): string {
  const info = getDiffTypeDisplay(diffType);
  if (!info) {
    return '';
  }
  return `<span class="codicon codicon-${info.icon}" title="${info.tooltip || info.label}"></span>`;
}

/**
 * Genera HTML completo del badge de tipo (icono + label).
 */
export function getDiffTypeBadgeHtml(
  diffType: DiffType | undefined,
  compareFileName?: string,
): string {
  const info = getDiffTypeDisplay(diffType, compareFileName);
  if (!info) {
    return '';
  }
  
  const cssClass = info.cssClass ? ` ${info.cssClass}` : '';
  const tooltip = info.tooltip || info.label;
  
  return `<span class="diff-type-badge${cssClass}" title="${tooltip}">
    <span class="codicon codicon-${info.icon}"></span>
    <span class="diff-type-label">${info.label}</span>
  </span>`;
}
