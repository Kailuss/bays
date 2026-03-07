import type { BayState, ActionContext, BayIntegrations } from '../Bay';

/**
 * State management actions - Operaciones, contexto, integraciones
 */

//- Operations State

export function startOperation(
  state: BayState,
  operationName: string,
  canCancel: boolean = false
): void {
  state.operationState = {
    isProcessing    : true,
    currentOperation: operationName,
    canCancel,
    progress        : 0,
  };
}

export function updateOperationProgress(state: BayState, progress: number): void {
  if (state.operationState.isProcessing) {
    state.operationState.progress = Math.max(0, Math.min(100, progress));
  }
}

export function finishOperation(state: BayState): void {
  state.operationState = {
    isProcessing    : false,
    canCancel       : false,
  };
}

//- Action Context

export function updateActionContext(
  state: BayState,
  context: Partial<ActionContext>
): void {
  state.actionContext = {
    ...state.actionContext,
    ...context,
  };
}

export function isActionRestricted(state: BayState, actionId: string): boolean {
  return state.permissions.restrictedActions?.includes(actionId) || false;
}

//- Integrations

export function addToCopilotContext(state: BayState): void {
  state.integrations.copilot = {
    inContext    : true,
    lastAddedTime: Date.now(),
  };
}

export function removeFromCopilotContext(state: BayState): void {
  state.integrations.copilot = {
    inContext    : false,
  };
}

export function updateGitIntegration(
  state: BayState,
  gitInfo: Partial<BayIntegrations['git']>
): void {
  state.integrations.git = {
    hasUncommittedChanges: false, // Default
    ...state.integrations.git,
    ...gitInfo,
  };
}
