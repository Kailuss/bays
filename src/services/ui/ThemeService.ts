import * as vscode from 'vscode';

/**
 * Listens for icon-theme, color-theme, and product-icon-theme changes
 * so the tree view can refresh its icons accordingly.
 */
export class ThemeService {
  private _onDidChangeTheme = new vscode.EventEmitter<void>();
  readonly onDidChangeTheme = this._onDidChangeTheme.event;

  /**
   * Registra listeners de configuración relacionados con temas e iconos.
   * Llamar una vez durante la activación de la extensión.
   */
  activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        // NOTE: workbench.iconTheme is intentionally NOT handled here.
        // BayIconManager owns icon-theme changes: it rebuilds the icon map and
        // fires onDidInitialize → provider.refresh() ONCE, with the new icons
        // ready. Firing here too would cause a second (early, stale) rebuild —
        // the visible double-flash on icon-theme switch.
        if (
          e.affectsConfiguration('workbench.productIconTheme') ||
          e.affectsConfiguration('workbench.colorTheme')
        ) {
          this._onDidChangeTheme.fire();
        }
      })
    );
  }

  getCurrentIconTheme(): string | undefined {
    return vscode.workspace.getConfiguration('workbench').get('iconTheme');
  }

  getCurrentColorTheme(): string | undefined {
    return vscode.workspace.getConfiguration('workbench').get('colorTheme');
  }
}
