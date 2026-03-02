import * as vscode from 'vscode';
import type { BayMetadata, BayState, ActionContext, BayIntegrations, CustomBayAction } from './Bay';
import * as actions from './actions';

/**
 * SideTabActions
 * Compositional class that delegates to modular action functions.
 *
 * All actions receive `metadata` (immutable) and mutate `state` in place.
 */
export abstract class SideTabActions {
  abstract readonly metadata: BayMetadata;
  abstract state: BayState;

  //- CLOSE ACTIONS

  async close(): Promise<void> {
    return actions.close(this.metadata, this.state);
  }

  async closeOthers(): Promise<void> {
    return actions.closeOthers(this.metadata, this.state, () => this.activate());
  }

  async closeGroup(): Promise<void> {
    return actions.closeGroup(this.metadata, this.state);
  }

  async closeToRight(): Promise<void> {
    return actions.closeToRight(this.metadata, this.state);
  }

  //- PIN ACTIONS

  async pin(): Promise<void> {
    return actions.pin(this.metadata, this.state, () => this.activate());
  }

  async unpin(): Promise<void> {
    return actions.unpin(this.metadata, this.state, () => this.activate());
  }

  //- REVEAL ACTIONS

  async revealInExplorer(): Promise<void> {
    return actions.revealInExplorer(this.metadata, this.state);
  }

  async revealInExplorerView(): Promise<void> {
    return actions.revealInExplorerView(this.metadata, this.state);
  }

  async revealInFileExplorer(): Promise<void> {
    return actions.revealInFileExplorer(this.metadata, this.state);
  }

  async openTimeline(): Promise<void> {
    return actions.openTimeline(this.metadata, this.state, () => this.activate());
  }

  //- COPY ACTIONS

  async copyRelativePath(): Promise<void> {
    return actions.copyRelativePath(this.metadata, this.state);
  }

  async copyPath(): Promise<void> {
    return actions.copyPath(this.metadata, this.state);
  }

  async copyFileContents(): Promise<void> {
    return actions.copyFileContents(this.metadata, this.state);
  }

  //- FILE ACTIONS

  async duplicateFile(): Promise<void> {
    return actions.duplicateFile(this.metadata, this.state);
  }

  async compareWithActive(): Promise<void> {
    return actions.compareWithActive(this.metadata, this.state);
  }

  async openChanges(): Promise<void> {
    return actions.openChanges(this.metadata, this.state);
  }

  async splitRight(): Promise<void> {
    return actions.splitRight(this.metadata, this.state);
  }

  async moveToNewWindow(): Promise<void> {
    return actions.moveToNewWindow(this.metadata, this.state);
  }

  async moveToGroup(target: vscode.ViewColumn): Promise<void> {
    return actions.moveToGroup(this.metadata, this.state, target, () => this.close());
  }

  //- ACTIVATION ACTIONS

  async activate(): Promise<void> {
    return actions.activate(this.metadata, this.state);
  }

  //- STATE MANAGEMENT ACTIONS

  startOperation(operationName: string, canCancel: boolean = false): void {
    actions.startOperation(this.state, operationName, canCancel);
  }

  updateOperationProgress(progress: number): void {
    actions.updateOperationProgress(this.state, progress);
  }

  finishOperation(): void {
    actions.finishOperation(this.state);
  }

  updateActionContext(context: Partial<ActionContext>): void {
    actions.updateActionContext(this.state, context);
  }

  isActionRestricted(actionId: string): boolean {
    return actions.isActionRestricted(this.state, actionId);
  }

  addToCopilotContext(): void {
    actions.addToCopilotContext(this.state);
  }

  removeFromCopilotContext(): void {
    actions.removeFromCopilotContext(this.state);
  }

  updateGitIntegration(gitInfo: Partial<BayIntegrations['git']>): void {
    actions.updateGitIntegration(this.state, gitInfo);
  }

  //- CUSTOM ACTIONS

  addCustomAction(action: CustomBayAction): void {
    actions.addCustomAction(this.state, action);
  }

  async executeCustomAction(actionId: string): Promise<void> {
    return actions.executeCustomAction(this.metadata, this.state, actionId);
  }

  removeCustomAction(actionId: string): void {
    actions.removeCustomAction(this.state, actionId);
  }
}
