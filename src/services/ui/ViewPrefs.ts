import * as vscode from 'vscode';
import { Logger } from '../../platform/logger';

/**
 * Lo que la vista CONMUTA desde un control propio, guardado POR PROYECTO.
 *
 * Un ajuste no puede ser las dos cosas a la vez. Sin valor de carpeta ni de
 * workspace, `config.update` acaba en el settings.json del USUARIO, así que
 * activar el modo compacto en una ventana lo activaba en todas; y los dos
 * ámbitos que sí son por proyecto son ficheros —`.vscode/settings.json`, un
 * `.code-workspace`— que acaban en el repositorio de alguien, donde pulsar un
 * botón de una barra no tiene nada que escribir.
 *
 * `workspaceState` es lo único que cumple las dos condiciones: lo guarda VS Code
 * en su propio almacenamiento, indexado por workspace.
 *
 * El AJUSTE sigue vivo y sigue significando algo: es lo que gobierna mientras no
 * haya nada guardado, o sea con qué arranca un proyecto que no ha tocado el
 * control. Y manda el ÚLTIMO que escribe: un cambio hecho desde la UI de
 * settings TIRA lo guardado para esa clave, o aquélla se quedaría mintiendo sin
 * forma de volver a ponerlos de acuerdo.
 */

const STORE_KEY = 'bays.viewPrefs';

/** Las claves que la vista conmuta, con el ajuste del que caen y su defecto. */
export const VIEW_PREFS = {
  compactMode  : { setting: 'compactMode',  fallback: false },
  showFilePath : { setting: 'showFilePath', fallback: true  },
} as const;

export type ViewPrefKey = keyof typeof VIEW_PREFS;

export class ViewPrefs {
  private readonly _onDidChange = new vscode.EventEmitter<ViewPrefKey>();
  /** Se dispara con la clave que de verdad se ha movido. */
  readonly onDidChange = this._onDidChange.event;

  // En memoria además de en el memento: estas claves se preguntan en cada
  // render, y `Memento.update` es asíncrono mientras que `forgetConfigured`
  // tiene que valer antes del repintado que va detrás de él en el mismo listener.
  private stored: Partial<Record<ViewPrefKey, boolean>>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.stored = { ...context.workspaceState.get<Partial<Record<ViewPrefKey, boolean>>>(STORE_KEY, {}) };
  }

  /**
   * Lo guardado si lo hay, y el ajuste si no.
   *
   * Se pregunta por `undefined` y no por lo falsy: las dos claves tienen `false`
   * como valor con significado, así que un guardado en `false` que cayera al
   * ajuste volvería a encender el control solo.
   */
  get(key: ViewPrefKey): boolean {
    const saved = this.stored[key];
    if (saved !== undefined) { return saved; }
    const { setting, fallback } = VIEW_PREFS[key];
    return vscode.workspace.getConfiguration('bays').get<boolean>(setting, fallback);
  }

  async set(key: ViewPrefKey, value: boolean): Promise<void> {
    if (this.get(key) === value) { return; }
    this.stored[key] = value;
    await this.context.workspaceState.update(STORE_KEY, this.stored);
    this._onDidChange.fire(key);
  }

  async toggle(key: ViewPrefKey): Promise<void> {
    await this.set(key, !this.get(key));
  }

  /**
   * El ajuste se ha movido desde la UI de settings: lo guardado para esa clave
   * se TIRA, y manda lo que el usuario acaba de escribir.
   */
  forgetConfigured(event: vscode.ConfigurationChangeEvent): void {
    for (const key of Object.keys(VIEW_PREFS) as ViewPrefKey[]) {
      const { setting } = VIEW_PREFS[key];
      if (!event.affectsConfiguration(`bays.${setting}`)) { continue; }
      if (this.stored[key] === undefined) { continue; }
      delete this.stored[key];
      void this.context.workspaceState.update(STORE_KEY, this.stored);
      Logger.log(`[ViewPrefs] bays.${setting} was edited in settings: the per-project value is dropped`);
      this._onDidChange.fire(key);
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
