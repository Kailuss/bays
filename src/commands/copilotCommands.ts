import * as vscode from 'vscode';
import { CopilotService } from '../services/integration/CopilotService';
import { BayStateService } from '../services/core/BayStateService';

/**
 ** Registra comandos para añadir archivos al contexto de GitHub Copilot Chat.
 */
export function registerCopilotCommands(
  context: vscode.ExtensionContext,
  copilotService: CopilotService,
  stateService: BayStateService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('bays.addToCopilotChat', async (bayId: string) => {
      const bay = typeof bayId === 'string' ? stateService.getBayById(bayId) : undefined;
      if (bay) {
        await copilotService.addFileToChat(bay);
      }
    }),

    vscode.commands.registerCommand('bays.addMultipleToCopilotChat', async () => {
      const allBays = stateService.getAllBays();
      if (allBays.length === 0) {
        vscode.window.showInformationMessage('No bays open');
        return;
      }
      await copilotService.addMultipleFiles(allBays);
    }),
  );
}
