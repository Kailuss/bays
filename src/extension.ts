import * as vscode from 'vscode';
import { BaysWebviewProvider     } from './providers/BaysWebviewProvider';
import { GroupActions            } from './providers/GroupActions';
import { BayStateService         } from './services/core/BayStateService';
import { BaySyncService          } from './services/core/BaySyncService';
import { BayDragDropService      } from './services/ui/BayDragDropService';
import { FileActionRegistry      } from './services/registry/FileActionRegistry';
import { BayIconManager          } from './services/ui/BayIconManager';
import { GroupCustomizationService } from './services/ui/GroupCustomizationService';
import { ViewPrefs               } from './services/ui/ViewPrefs';
import { ProductIconService      } from './services/ui/ProductIconService';
import { ThemeService            } from './services/ui/ThemeService';
import { CopilotService          } from './services/integration/CopilotService';
import { ClaudeConversationService } from './services/integration/ClaudeConversationService';
import { registerBayCommands     } from './commands/bayCommands';
import { registerGroupCommands   } from './commands/groupCommands';
import { registerCopilotCommands } from './commands/copilotCommands';
import { activateLanguageRegistry } from './platform/languageRegistry';
import { preloadWebviewExtensionIcons } from './platform/webviewExtensionIcons';
import { Logger                  } from './platform/logger';

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
    context.subscriptions.push(stateService);

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

    // Lo que la vista conmuta desde un control propio se guarda POR PROYECTO en
    // vez de escribir el settings.json del usuario (ver ViewPrefs).
    const viewPrefs          = new ViewPrefs(context);
    context.subscriptions.push(viewPrefs);

    // Los glifos del panel siguen al pack de `workbench.productIconTheme`, como
    // el resto del workbench. Apagado (`bays.followProductIconTheme`) no lee
    // nada del disco.
    const productIcons       = new ProductIconService();
    context.subscriptions.push(productIcons);

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
      copilotService,
      iconManager,
      context,
      dragDropService,
      fileActionRegistry,
      groupActions,
      viewPrefs,
      productIcons,
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
        // Lo PRIMERO: un ajuste editado a mano tira lo guardado para esa clave,
        // así que el repintado que va detrás lee ya lo que gobierna.
        viewPrefs.forgetConfigured(e);
        if (e.affectsConfiguration('bays')) { provider.refresh(); }
      }),
    );

    //· Rebuild when the extension set changes: the Copilot button del webview
    //  se re-evalúa en cada build (copilotReady), y puede haberse instalado una
    //  extensión cuyo icono de webview renderizamos.
    context.subscriptions.push(
      vscode.extensions.onDidChange(() => {
        void preloadWebviewExtensionIcons().then(() => provider.refresh());
      }),
    );

    //· Unsaved-changes context key (gates the always-visible "Save All" toolbar
    //  button). Read from native tabs so it also covers custom editors/notebooks,
    //  and re-evaluated on every tab change — dirty toggles arrive in the event's
    //  `changed` array, closing the last dirty tab in `closed`.
    const hasUnsavedBays = () =>
      vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.isDirty));
    const syncUnsavedContext = () =>
      void vscode.commands.executeCommand('setContext', 'bays.hasUnsavedBays', hasUnsavedBays());
    syncUnsavedContext();
    context.subscriptions.push(
      vscode.window.tabGroups.onDidChangeTabs(syncUnsavedContext),
    );

    //· Activate services
    syncService.activate(context);
    themeService.activate(context);

    //· Preload icons for all open bays in background
    void iconManager.preloadIconsInBackground(context);

    //· Preload extension-owned webview icons (Claude Code, …) then repaint so the
    //  real brand logo replaces the placeholder codicon. Non-blocking.
    void preloadWebviewExtensionIcons().then(() => provider.refresh());

    //· Claude Code chat tabs: replace the 24-char native tab title with the full
    //  conversation title read from Claude's transcripts. Enrich on load, on
    //  structural changes (a chat tab opened), and whenever a transcript is written
    //  (the title updates as the conversation evolves). Coalesced to one run at a
    //  time; each resolved label is patched in place (no full rebuild).
    const claudeConversation = new ClaudeConversationService();
    context.subscriptions.push({ dispose: () => claudeConversation.dispose() });

    let enriching = false, enrichAgain = false;
    const enrichClaudeTitles = async () => {
      if (enriching) { enrichAgain = true; return; }
      enriching = true;
      try {
        do {
          enrichAgain = false;
          const bays = stateService.getAllBays()
            .filter(b => ClaudeConversationService.isClaudeConversationBay(b));
          if (bays.length > 0) {
            for (const id of await claudeConversation.enrichLabels(bays)) {
              stateService.notifyBayLabelChange(id);
            }
          }
        } while (enrichAgain);
      } finally {
        enriching = false;
      }
    };
    context.subscriptions.push(
      stateService.onDidChangeState(() => void enrichClaudeTitles()),
    );
    claudeConversation.watch(() => void enrichClaudeTitles());
    void enrichClaudeTitles();

    //· Register commands
    registerBayCommands(context, stateService, viewPrefs);
    context.subscriptions.push(viewPrefs.onDidChange(() => provider.refresh()));
    registerGroupCommands(context, stateService, groupActions);
    registerCopilotCommands(context, copilotService, stateService);

    context.subscriptions.push(
      vscode.commands.registerCommand('bays.refresh', () => provider.refresh()),
    );

    //· Refresh on theme change
    context.subscriptions.push(
      themeService.onDidChangeTheme(() => provider.refresh()),
    );

    //· Refresh when icons are reloaded (e.g., theme change)
    context.subscriptions.push(
      iconManager.onDidInitialize(() => provider.refreshTheme()),
    );

    //· El pack de iconos de producto: lo unico que se mueve es una hoja de
    //  estilo, y cada glifo que nombra ya esta en pantalla con el id contra el
    //  que casa esa regla. Asi que no se vuelve a componer ninguna lista.
    context.subscriptions.push(
      productIcons.onDidChange(() => void provider.sendProductIcons()),
    );

    Logger.log('Bays activated successfully');
  } catch (error) {
    Logger.error('Activation failed', error);
    throw error;
  }
}
