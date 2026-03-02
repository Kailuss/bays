/**
 * Bay/ Folder - Specialized Services for Bay Synchronization
 *
 * Services:
 * - BayEventService: Event listener registration and handling
 * - BayHeadService: Parent placeholder management and auto-opening
 * - ActiveStateService: Active state synchronization and orphan cleanup
 *
 * These services are composed together by BaySyncService as a thin orchestrator.
 *
 * @see src/services/core/AGENT.md
 */

export { BayEventService    } from './BayEventService';
export { BayHeadService     } from './BayHeadService';
export { ActiveStateService } from './ActiveStateService';
