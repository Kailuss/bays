/**
 * Barrel export for all models in Bays extension.
 * Provides centralized access to data structures and helper functions.
 */

// SideTab - Bay representation and actions
export { Bay } from './Bay';
export { BayActions as SideTabActions } from './BayActions';
export { BayHelpers as SideTabHelpers } from './BayHelpers';
export type {
  BayType as SideTabType,
  BayType,
  BayMetadata as SideTabMetadata,
  BayMetadata,
  BayState as SideTabState,
  BayState,
  BayCapabilities as SideTabCapabilities,
  BayCapabilities,
  GitStatus,
  BayViewMode as TabViewMode,
  EditMode,
  DiffType,
  DiffStats,
  ActionContext,
  OperationState,
  BayPermissions as TabPermissions,
  BayIntegrations as TabIntegrations,
  CustomBayAction as CustomTabAction,
  BayShortcuts as TabShortcuts,
} from './Bay';

// SideTabGroup - Bay grouping
export { createTabGroup } from './BayGroup';
export type { BayGroup as SideTabGroup } from './BayGroup';

// DocumentModel - Document metadata management
export {
  createDocumentModel,
  registerVersion,
  getVersion,
  getVersionsByType,
  getActiveVersion,
  setActiveVersion,
  removeVersion,
  updateVersionStats,
  associateVariant,
  dissociateVariant,
  getAggregatedStats,
  canBeCleanedUp,
  touchDocument,
  getDocumentSummary,
} from './DocumentModel';
export type {
  DocumentModel,
  VersionMetadata,
  CreateDocumentModelOptions,
  RegisterVersionOptions,
  VersionSearchResult,
} from './DocumentModel';

// Action modules (optional, for direct imports)
export * from './actions';
