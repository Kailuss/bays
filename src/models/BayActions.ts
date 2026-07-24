import * as vscode from 'vscode';
import type { BayMetadata, BayState } from './Bay';
import * as actions from './actions';

/**
 * BayActions
 * Compositional class that delegates to modular action functions.
 *
 * All actions receive `metadata` (immutable) and mutate `state` in place.
 */
export abstract class BayActions {
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

  addToCopilotContext(): void {
    actions.addToCopilotContext(this.state);
  }
}
