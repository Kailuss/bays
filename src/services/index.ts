// Core services - Estado y sincronización fundamentales
export { BayStateService } from './core/BayStateService';
export { BaySyncService } from './core/BaySyncService';
export { BayHierarchyService } from './core/BayHierarchyService';
export type { TabTreeNode, BayTreeNode } from './core/BayHierarchyService';
export { DocumentManager } from './core/DocumentManager';
export type { DocumentManagerOptions } from './core/DocumentManager';

// Bay services - Specialized synchronization services (post-refactoring)
export { BayEventService, BayHeadService, ActiveStateService } from './core/bay';

// UI services - Presentación e interacción visual
export { ThemeService } from './ui/ThemeService';
export { BayIconManager } from './ui/BayIconManager';
export { BayDragDropService } from './ui/BayDragDropService';

// Integration services - Conexiones con APIs externas
export { GitSyncService } from './integration/GitSyncService';
export { CopilotService } from './integration/CopilotService';

// Registry services - Extensibilidad
export { FileActionRegistry } from './registry/FileActionRegistry';
export type { FileAction, ResolvedFileAction } from './registry/FileActionRegistry';
