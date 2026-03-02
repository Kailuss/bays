/**
 * Barrel export for all models in Bays extension.
 * Provides centralized access to data structures and helper functions.
 */

// SideTab - Tab representation and actions
export { SideTab, Bay } from './SideTab';
export { SideTabActions } from './SideTabActions';
export { SideTabHelpers } from './SideTabHelpers';
export type {
  SideTabType,
  BayType,
  SideTabMetadata,
  BayMetadata,
  SideTabState,
  BayState,
  SideTabCapabilities,
  BayCapabilities,
  GitStatus,
  TabViewMode,
  EditMode,
  DiffType,
  DiffStats,
  ActionContext,
  OperationState,
  TabPermissions,
  TabIntegrations,
  CustomTabAction,
  TabShortcuts,
} from './SideTab';

// SideTabGroup - Tab grouping
export { createTabGroup } from './SideTabGroup';
export type { SideTabGroup } from './SideTabGroup';

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
  associateChildTab,
  dissociateChildTab,
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
