import * as vscode from 'vscode';
import { BaysWebviewProvider     } from './providers/BaysWebviewProvider';
import { GroupActions            } from './providers/GroupActions';
import { BayStateService         } from './services/core/BayStateService';
import { BaySyncService          } from './services/core/BaySyncService';
import { BayDragDropService      } from './services/ui/BayDragDropService';
import { FileActionRegistry      } from './services/registry/FileActionRegistry';
import { BayIconManager          } from './services/ui/BayIconManager';
import { GroupCustomizationService } from './services/ui/GroupCustomizationService';
import { ThemeService            } from './services/ui/ThemeService';
import { CopilotService          } from './services/integration/CopilotService';
import { registerBayCommands     } from './commands/bayCommands';
import { registerGroupCommands   } from './commands/groupCommands';
import { registerCopilotCommands } from './commands/copilotCommands';
import { activateLanguageRegistry } from './utils/languageRegistry';
import { Logger                  } from './utils/logger';

export async function activate(context: vscode.ExtensionContext) {
  Logger.initialize();
  Logger.log('Activating Bays…');

  try {
    // Mapa nombre-de-archivo → languageId a partir de `contributes.languages`.
    // Debe existir ANTES de convertir tabs o resolver iconos: los temas que
    // indexan por lenguaje (p.ej. .sh vía `languageIds.shellscript`) dependen
    // de él para no caer al icono por defecto.
    activateLanguageRegistry(context);

    // Core services
    const stateService       = new BayStateService();

    // Group name/colour/lock, persisted per workspace. Debe inyectarse ANTES de
    // que syncService haga su primer sync: `setGroups` reconstruye los grupos
    // desde la API nativa y es donde se reaplica la personalización guardada.
    const groupCustomization = new GroupCustomizationService(context);
    stateService.setGroupCustomizationService(groupCustomization);

    const syncService        = new BaySyncService(stateService);
    const dragDropService    = new BayDragDropService(stateService);
    const fileActionRegistry = new FileActionRegistry();
    const iconManager        = new BayIconManager();
    const themeService       = new ThemeService();
    const copilotService     = new CopilotService();
    const groupActions       = new GroupActions(groupCustomization);

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
      groupActions,
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

    //· Copilot availability context key (gates the "Add Files to Copilot Chat…"
    //  toolbar button). Re-evaluated when extensions change so installing or
    //  disabling Copilot Chat mid-session updates the UI without a reload.
    const syncCopilotContext = () =>
      void vscode.commands.executeCommand('setContext', 'bays.copilotAvailable', copilotService.isAvailable());
    syncCopilotContext();
    context.subscriptions.push(
      vscode.extensions.onDidChange(() => {
        syncCopilotContext();
        provider.refresh();
      }),
    );

    //· Activate services
    syncService.activate(context);
    themeService.activate(context);

    //· Preload icons for all open bays in background
    iconManager.preloadIconsInBackground(context);

    //· Register commands
    registerBayCommands(context, stateService);
    registerGroupCommands(context, stateService, groupActions);
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
