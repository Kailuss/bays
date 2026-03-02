import * as vscode from 'vscode';
import { BayActions } from './BayActions';

//: Bay type - 4 core types according to Bay architecture
export type BayType = 'file' | 'webview' | 'custom' | 'notebook';

//: Git decoration status for a file
export type GitStatus   = 'modified' | 'added' | 'deleted' | 'untracked' | 'ignored' | 'conflict' | null;
//: View mode for bays that support multiple visualizations
export type BayViewMode = 'source' | 'preview' | 'split';
//: Edit mode for bays
export type EditMode = 'readonly' | 'editable';
//: Diff type for child bays (diff visualizations)
export type DiffType = 'working-tree' | 'staged' | 'snapshot' | 'commit' | 'edit' | 'merge-conflict' | 'incoming' | 'current' | 'incoming-current' | 'unknown';

/**
 * Diff statistics for child bays
 */
export type DiffStats = {
  linesAdded?: number;      // Lines added (for working tree, staged)
  linesRemoved?: number;    // Lines removed (for working tree, staged)
  timestamp?: number;       // Snapshot timestamp
  snapshotName?: string;    // Snapshot label/name
  conflictSections?: number; // Number of conflict sections
};

/**
 * Contexto de acción dinámico para tabs.
 * Define el estado actual de visualización y edición.
 */
export type ActionContext = {
  viewMode?: BayViewMode;                        // How the bay is visualized
  editMode?: EditMode;                           // Edit capability state
  splitOrientation?: 'horizontal' | 'vertical';  // Split view orientation
  compareMode?: boolean;                         // In diff/compare mode
  debugMode?: boolean;                           // In debug mode
}

/**
 * Estado de operaciones asíncronas en progreso.
 */
export type OperationState = {
  isProcessing: boolean;           // Operation in progress
  currentOperation?: string;       // Operation name (close, save, etc)
  canCancel: boolean;              // Can be cancelled
  progress?: number;               // Progress 0-100 (if applicable)
}

/**
 * Permisos granulares para operaciones de archivo.
 * Más específico que capabilities - define qué está permitido.
 */
export type BayPermissions = {
  canRename: boolean;              // Can rename file
  canDelete: boolean;              // Can delete file
  canMove: boolean;                // Can move to other location
  canShare: boolean;               // Can share (copy link, etc)
  canExport: boolean;              // Can export to other format
  restrictedActions?: string[];    // IDs of blocked actions
}

/**
 * Estado de integración con servicios externos.
 */
export type BayIntegrations = {
  copilot?: {
    inContext: boolean;            // In Copilot chat context
    lastAddedTime?: number;        // When added to context
  };
  git?: {
    hasUncommittedChanges: boolean;
    branch?: string;               // Current branch
    ahead?: number;                // Commits ahead of remote
    behind?: number;               // Commits behind remote
  };
}

/**
 * Acción personalizada definida por usuario o extensión.
 */
export type CustomBayAction = {
  id: string;
  label: string;
  icon: string;
  tooltip: string;
  keybinding?: string;
  execute: (metadata: BayMetadata, state: BayState) => Promise<void>;
}

/**
 * Atajos de teclado personalizados para acciones.
 */
export type BayShortcuts = {
  quickPin?: string;               // Quick pin/unpin
  quickClose?: string;             // Quick close
  quickDuplicate?: string;         // Quick duplicate
  quickReveal?: string;            // Quick reveal in explorer
}

/**
 * Immutable metadata describing a bay.
 * Computed once at creation and should not change during bay lifetime.
 */
export type BayMetadata = {
  //: IDENTITY
  id            : string;        // Unique identifier (uri-based for file tabs, label-based for webview tabs).
  parentId?     : string;        // ID of parent bay (for diff tabs that belong to a file bay).
  bayType       : BayType;   // What kind of VS Code bay input this wraps.
  diffType?     : DiffType;      // Type of diff (for child tabs only)
  
  //: DOCUMENT LINK (NEW)
  documentId?   : string;        // ID of associated DocumentModel (for complex document metadata)

  //: FILE INFORMATION
  uri?          : vscode.Uri;    // File URI. Only present for file / custom / notebook tabs.
  fileName?     : string;        // Base file name with extension (e.g. "Bays.ts")
  baseName?     : string;        // File name without extension (e.g. "Bays")
  fileExtension : string;        // File extension with dot (e.g. ".ts"). Empty for non-file tabs.
  dirPath?      : string;        // Parent directory path (for reveal/terminal actions)

  //: URI CHARACTERISTICS (cached for performance)
  scheme?       : string;        // URI scheme: file, untitled, vscode-remote, etc.
  isRemote?     : boolean;       // Is remote file (SSH, WSL, containers)
  isUntitled?   : boolean;       // Is unsaved new file

  //: DISPLAY
  label         : string;        // Display name shown in the sidebar.
  detailLabel?  : string;        // Relative path (description line).
  tooltipText?  : string;        // Tooltip text (can be enriched with size, date, etc.)

  //: VISUAL IDENTITY
  iconId?       : string;        // Cached icon ID from FileActionRegistry (performance)
  category?     : string;        // Semantic category: config, test, doc, component, style, etc.

  //: LANGUAGE & EDITOR
  languageId?   : string;        // VS Code language ID (typescript, markdown, python...)
  viewType?     : string;        // Webview / custom editor viewType (for icon mapping).

  //: FILE CHARACTERISTICS
  isReadOnly?   : boolean;       // File is read-only (permissions or remote)
  isBinary?     : boolean;       // Binary file (images, PDFs, etc.)
  isSymlink?    : boolean;       // File is symbolic link
  fileSize?     : number;        // File size in bytes (useful for large file warnings)

  //: RELATIONSHIPS
  relatedTabIds?: string[];      // Related tabs (diff pair, preview pair, etc.)
  originalUri?  : vscode.Uri;    // Original URI before rename/move (for tracking)

  //: EXTENSIBILITY
  customData?   : Record<string, any>;  // Extension-specific metadata
}

/**
 * Bay capabilities - Simplified to 5 core capabilities.
 * Other capabilities computed on-demand from state/metadata.
 * 
 * @see services/core/AGENT.md for capability computation patterns
 */
export type BayCapabilities = {
  canClose            : boolean; // Can be closed
  canPin              : boolean; // Can be pinned
  canRevealInExplorer : boolean; // Has physical file to reveal
  canTogglePreview    : boolean; // Can toggle source ↔ preview (MD, SVG...)
  canHaveChildren     : boolean; // Can have child tabs (variants)
};

//: Mutable runtime state of a bay.
export type BayState = {
  //: VS CODE NATIVE STATE (synchronized)
  isActive           : boolean;
  isDirty            : boolean;
  isPinned           : boolean;
  isPreview          : boolean;  // VS Code preview bay (italic, replaceable)

  //: LOCATION
  groupId            : number;
  viewColumn         : vscode.ViewColumn;
  indexInGroup       : number;

  //: VISUALIZATION MODE
  viewMode           : BayViewMode;  // How the bay is visualized: source | preview | split

  //: DIFF INFORMATION (for child tabs)
  diffStats?         : DiffStats;    // Diff statistics (lines added/removed, etc.)

  //: ACTION CONTEXT (NEW)
  actionContext      : ActionContext;        // Dynamic action context
  operationState     : OperationState;       // Async operations state

  //: CAPABILITIES & PERMISSIONS
  capabilities       : BayCapabilities;  // What actions can be performed
  permissions        : BayPermissions;       // Granular permissions
  //: HIERARCHY
  hasChildren        : boolean;   // Has child tabs (diffs, previews)
  isChild            : boolean;   // Is a child bay of another
  childrenCount      : number;    // Number of child tabs (for badge display)

  //: UI STATE
  isLoading          : boolean;   // Loading content (large files, remote)
  hasError           : boolean;   // Error loading/syncing
  errorMessage?      : string;    // Error description
  isHighlighted      : boolean;   // Temporarily highlighted (search, navigation)

  //: TRACKING
  lastAccessTime     : number;    // Timestamp of last access
  syncVersion        : number;    // Sync version (prevent stale updates)

  //: CURSOR POSITION (for parent-child sync)
  cursorLine?        : number;    // Current cursor line (1-based)
  cursorColumn?      : number;    // Current cursor column (1-based)

  //: DECORATIONS
  gitStatus          : GitStatus;  // Git decoration state
  diagnosticSeverity : vscode.DiagnosticSeverity | null;  // Highest severity (error > warning)

  //: PROTECTION
  isTransient        : boolean;   // Closes automatically (like VS Code preview)
  isProtected        : boolean;   // Requires confirmation to close

  //: INTEGRATIONS (NEW)
  integrations       : BayIntegrations;      // External service states

  //: CUSTOMIZATION (NEW)
  customActions?     : CustomBayAction[];    // User-defined actions
  shortcuts?         : BayShortcuts;         // Custom keybindings
}

/**
 * Representa una pestaña en la barra lateral de Bays.
 * En pocas palabras: guarda la información que mostramos (nombre, ruta, icono)
 * y ofrece métodos para las acciones que el usuario puede realizar (abrir, cerrar, pinear...).
 * Los métodos de acción están definidos en BayActions (herencia).
 * 
 * @remarks
 * ARQUITECTURA: Bay es responsable de la representación visual y estado de UI.
 * Para gestión compleja de metadata de documentos y versiones (diffs, snapshots),
 * Bay delega a DocumentModel a través del campo `metadata.documentId`.
 * 
 * Relación con DocumentModel:
 * - Parent bays con URI: pueden tener un DocumentModel asociado
 * - Child bays (diffs): su metadata está en VersionMetadata del DocumentModel parent
 * - DocumentManager gestiona el ciclo de vida y búsqueda de DocumentModels
 * 
 * @see DocumentModel for complete document metadata
 * @see DocumentManager for document lifecycle management
 */
export class Bay extends BayActions {
  constructor(
    public readonly metadata: BayMetadata,
    public state: BayState,
  ) {
    super();
  }
}
