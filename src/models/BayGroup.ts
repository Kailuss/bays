import { Bay } from './Bay';
import * as vscode from 'vscode';

/** Represents an editor group containing multiple bays. */
export type BayGroup = {
  id         : number;
  viewColumn : vscode.ViewColumn;
  isActive   : boolean;
  bays       : Bay[];
  label      : string;
};

/**
 * Creates a BayGroup from a VS Code TabGroup.
 * Tabs are populated separately by the sync service.
 */
export function createTabGroup(group: vscode.TabGroup): BayGroup {
  return {
    id         : group.viewColumn,
    viewColumn : group.viewColumn,
    isActive   : group.isActive,
    bays       : [],
    label      : `Group ${group.viewColumn}`,
  };
}
