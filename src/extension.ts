import * as vscode from 'vscode';
import { BaysWebviewProvider     } from './providers/BaysWebviewProvider';
import { BayStateService         } from './services/core/BayStateService';
import { BaySyncService          } from './services/core/BaySyncService';
import { BayDragDropService      } from './services/ui/BayDragDropService';
import { FileActionRegistry      } from './services/registry/FileActionRegistry';
import { BayIconManager          } from './services/ui/BayIconManager';
import { ThemeService            } from './services/ui/ThemeService';
import { CopilotService          } from './services/integration/CopilotService';
import { registerBayCommands     } from './commands/bayCommands';
import { registerCopilotCommands } from './commands/copilotCommands';
import { Logger                  } from './utils/logger';

export async function activate(context: vscode.ExtensionContext) {
  Logger.initialize();
  Logger.log('Activating Bays…');

  try {
    // Core services
    const stateService       = new BayStateService();
    const syncService        = new BaySyncService(stateService);
    const dragDropService    = new BayDragDropService(stateService);
    const fileActionRegistry = new FileActionRegistry();
    const iconManager        = new BayIconManager();
    const themeService       = new ThemeService();
    const copilotService     = new CopilotService();

    // Initialise icon manager (loads icon map). Do NOT block activation on the
    // theme-JSON disk read: the first render shows placeholder icons and patches
    // real ones in as they resolve, and onDidInitialize triggers a refresh once
    // the map is ready. The config listener inside initialize() is registered
    // synchronously, so theme-change handling is wired up immediately.
    void iconManager.initialize(context);

    // WebviewView provider
    const provider = new BaysWebviewProvider(
      context.extensionUri,
      stateService,
      syncService,
      copilotService,
      iconManager,
      context,
      dragDropService,
      fileActionRegistry,
    );

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        BaysWebviewProvider.viewType,
        provider,
      ),
    );

    //· Configuration reload
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('bays')) { provider.refresh(); }
      }),
    );

    //· Activate services
    syncService.activate(context);
    themeService.activate(context);

    //· Preload icons for all open bays in background
    iconManager.preloadIconsInBackground(context);

    //· Register commands
    registerBayCommands(context, stateService);
    registerCopilotCommands(context, copilotService, stateService);

    context.subscriptions.push(
      vscode.commands.registerCommand('bays.refresh', () => provider.refresh()),
    );

    //· Refresh on theme change
    themeService.onDidChangeTheme(() => provider.refresh());

    //· Refresh when icons are reloaded (e.g., theme change)
    iconManager.onDidInitialize(() => provider.refresh());

    Logger.log('Bays activated successfully');
  } catch (error) {
    Logger.error('Activation failed', error);
    throw error;
  }
}
