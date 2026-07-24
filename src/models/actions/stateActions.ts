import type { BayState } from '../Bay';

/**
 * State management actions - Integraciones externas
 */

//- Integrations

export function addToCopilotContext(state: BayState): void {
  state.integrations.copilot = {
    inContext    : true,
    lastAddedTime: Date.now(),
  };
}
