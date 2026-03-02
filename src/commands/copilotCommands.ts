import * as vscode from 'vscode';
import { CopilotService } from '../services/integration/CopilotService';
import { BayStateService } from '../services/core/BayStateService';

/**
 * Registra comandos para añadir archivos al contexto de GitHub Copilot Chat.
 */
export function registerCopilotCommands(
  context: vscode.ExtensionContext,
  copilotService: CopilotService,
  stateService: BayStateService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('bays.addToCopilotChat', async (bayId: string) => {
      const tab = typeof bayId === 'string' ? stateService.getTab(bayId) : undefined;
      if (tab) {
        await copilotService.addFileToChat(tab.metadata.uri);
      }
    }),

    vscode.commands.registerCommand('bays.addMultipleToCopilotChat', async () => {
      const allTabs = stateService.getAllTabs();
      if (allTabs.length === 0) {
        vscode.window.showInformationMessage('No tabs open');
        return;
      }
      await copilotService.addMultipleFiles(allTabs);
    }),
  );
}
