/**
 * Bay/ Folder - Specialized Services for Bay Synchronization
 * 
 * Post-refactoring March 2026: TabSyncService split into specialized services
 * for better maintainability, testability, and separation of concerns.
 * 
 * Services:
 * - BayEventService: Event listener registration and handling
 * - BayHeadService: Parent placeholder management and auto-opening
 * - ActiveStateService: Active state synchronization and orphan cleanup
 * 
 * These services are composed together by BaySyncService as a thin orchestrator.
 * 
 * @see src/services/core/AGENT.md#refactoring-march-2026
 */

export { BayEventService } from './BayEventService';
export { BayHeadService } from './BayHeadService';
export { ActiveStateService } from './ActiveStateService';
