// El tema de iconos de PRODUCTO activo, como CSS para el webview.
//
// `workbench.productIconTheme` redibuja los glifos del propio workbench, y hasta
// que esto existió el panel era la única superficie a la que no llegaba: la vista
// carga el `codicon.ttf` que `esbuild.js` copia a `dist/`, así que un pack
// elegido en el editor cambiaba todo lo de alrededor del panel y nada de dentro.
//
// Llega por el mismo camino que la fuente del tema de FICHEROS: se lee el JSON
// del pack, se empotra su fuente como `data:` URI y el conjunto viaja como una
// cadena para un `<style>` que el shell manda vacío. Lo NUEVO es solo lo que esa
// cadena dice: una regla por cada codicon que el pack redefine
// (`utils/productIcons.ts`).
//
// Nada de aquí está en el camino de un render. Se lee una vez por tema, se
// cachea, y se relee solo cuando el ajuste se mueve.
//
// Y se le puede decir que se quede fuera (`bays.followProductIconTheme`):
// apagado, el panel se queda con los codicons que la extensión trae. Es una
// preferencia de verdad y no un apaño — un pack redibuja el workbench para quien
// lo eligió, y se puede querer el cromo del editor redibujado y esta vista en
// paz. Se contesta AQUÍ y no deshaciendo nada en el cliente: apagarlo es
// entregar la cadena vacía, que es exactamente lo que manda un tema devuelto al
// defecto, así que el cliente ya sabe qué hacer con ella — y apagado no se lee
// nada del disco.

import * as vscode from 'vscode';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Logger } from '../../platform/logger';
import { fontFaceBlock, fontFamily, fontMimeType, parseFontDecls } from '../../utils/themeFonts';
import type { FontDecl } from '../../utils/themeFonts';
import { PRODUCT_FONT_PREFIX, productIconRules } from '../../utils/productIcons';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export class ProductIconService implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Se dispara cuando el CSS se ha MOVIDO, para que quien lo tenga lo reenvíe. */
  public readonly onDidChange = this._onDidChange.event;

  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  /**
   * Lo que se leyó, y para qué tema.
   *
   * `undefined` es "todavía no leído" y la cadena vacía es una respuesta de
   * verdad: sin tema, con uno ilegible, o con uno que no redefine nada. Se
   * distinguen por lo mismo que `BayIconManager` distingue "ya se ha intentado":
   * un valor falsy que significa "no hay nada que construir" es indistinguible
   * de uno que significa "vuelve a preguntar", y una guarda escrita contra el
   * segundo relee el JSON del tema lo que dure la ventana.
   */
  private css: string | undefined;
  private themeId: string | undefined;
  /** Una lectura ya en marcha, compartida en vez de arrancada otra vez. */
  private reading: Promise<void> | undefined;

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        // Nuestro interruptor cuenta como un cambio de tema, porque decide la
        // misma respuesta: apagado, la hoja es la cadena vacía diga lo que diga
        // el pack, así que moverlo tiene que tirar la caché igual que moverlo a
        // él. Se escucha aquí y no en `extension.ts` por lo mismo que el pack:
        // lo que produce no es un valor que meter en un mensaje sino una hoja
        // leída del disco, y esto es lo único que la lee.
        if (!e.affectsConfiguration('workbench.productIconTheme')
          && !e.affectsConfiguration('bays.followProductIconTheme')) { return; }
        // La respuesta se tira en vez de releerse aquí: quien la pide es un
        // cliente, y puede no haberlo.
        this.css     = undefined;
        this.themeId = undefined;
        this.reading = undefined;
        this._onDidChange.fire();
      }),
    );
  }

  /**
   * El CSS del tema en vigor: los `@font-face` que declara y una regla por cada
   * codicon que redefine. La cadena vacía cuando no hay nada que decir, que es
   * lo que el cliente usa para vaciar su elemento — un tema devuelto al defecto
   * tiene que llevarse sus glifos con él.
   */
  public async getCss(): Promise<string> {
    // Se pregunta ANTES de leer nada, que es todo lo que el interruptor cuesta:
    // apagado, esto es una lectura de configuración y cero disco.
    if (!this.follows()) { return ''; }

    const theme = vscode.workspace.getConfiguration().get<string>('workbench.productIconTheme') ?? '';
    if (this.css !== undefined && this.themeId === theme) { return this.css; }

    // Compartida en vez de arrancada otra vez: un cliente naciendo y un cambio
    // de tema aterrizando juntos leerían y codificarían la misma fuente dos
    // veces.
    this.reading ??= this.read(theme);
    await this.reading;
    return this.css ?? '';
  }

  /**
   * Si el panel sigue al pack del usuario.
   *
   * Falla ENCENDIDO: solo un `false` de verdad lo para, que es como se lee
   * cualquier otra bandera de aquí — un valor ilegible tiene que dejar el panel
   * haciendo lo que hace quien nunca tocó el ajuste, y eso es seguirlo.
   */
  private follows(): boolean {
    return vscode.workspace.getConfiguration('bays').get('followProductIconTheme') !== false;
  }

  private async read(theme: string): Promise<void> {
    try {
      this.css = await this.build(theme);
    } catch (err) {
      Logger.warn(`[ProductIconService] Could not read ${theme}: ${err}`);
      this.css = '';
    }
    this.themeId = theme;
    this.reading = undefined;
  }

  private async build(theme: string): Promise<string> {
    // El tema de producto por DEFECTO es la cadena vacía, y es el propio
    // codicon, que el webview ya tiene. No hay nada que sobreescribir.
    if (!theme) { return ''; }

    const found = this.findTheme(theme);
    if (!found) {
      Logger.log(`[ProductIconService] ${theme} is not readable here, keeping the built-in codicons`);
      return '';
    }

    const json  = asRecord(JSON.parse(await fsp.readFile(found, 'utf8')));
    const fonts = parseFontDecls(json?.fonts);
    const rules = productIconRules(json?.iconDefinitions, fonts);
    if (!rules) { return ''; }

    const faces = await this.fontFaces(fonts, path.dirname(found));
    // Reglas sin `@font-face` pintan una caja vacía en cada icono que nombran,
    // que es peor que los codicons a los que sustituían: una fuente de menos y
    // el tema entero se descarta.
    if (faces === null) { return ''; }

    return `${faces}\n${rules}`;
  }

  /**
   * Todas las fuentes declaradas, empotradas, o `null` donde CUALQUIERA de ellas
   * no se pudo leer.
   *
   * Todas, y saltarse la que falló es lo que esto no puede hacer: una regla que
   * nombra una familia sin `@font-face` pinta una caja vacía, y una definición
   * que nombra una fuente que no está no llega ni a eso — `productIconRules`
   * manda un `fontId` desconocido a la PRIMERA declarada, que es la respuesta
   * correcta para un tema que tecleó mal un id y la equivocada para uno al que
   * le falta el fichero. Así que un pack a medias no es un pack más pequeño: es
   * uno dibujando el glifo que no era en los huecos.
   *
   * Entero o nada, y nada cuesta exactamente los codicons que la extensión trae.
   * Ese trato es del pack de producto y de nadie más: un tema de ICONOS se
   * descarta fuente a fuente a propósito, porque allí lo que queda debajo es el
   * glifo genérico de fichero y perder el icono de todas las filas por una
   * fuente que falta sería la pérdida mayor.
   */
  private async fontFaces(fonts: readonly FontDecl[], themeDir: string): Promise<string | null> {
    const blocks: string[] = [];
    for (const font of fonts) {
      const relative = process.platform === 'win32' ? font.src.replace(/\//g, path.sep) : font.src;
      const file     = path.resolve(themeDir, relative);
      try {
        const data = await fsp.readFile(file);
        const uri  = `data:${fontMimeType(file)};base64,${data.toString('base64')}`;
        blocks.push(fontFaceBlock(fontFamily(PRODUCT_FONT_PREFIX, font.id), uri, font));
      } catch (err) {
        Logger.warn(`[ProductIconService] Could not load product icon font ${file}: ${err}`);
        return null;
      }
    }
    return blocks.join('\n');
  }

  /**
   * La ruta del JSON del tema, o `null` donde nada declara ese id — que cubre
   * tanto "no instalado" como una ventana remota, donde los packs se quedan
   * instalados en la máquina local y su `extensionPath` nombra un disco que este
   * host no ve. Las dos respuestas son la misma para quien pregunta: la vista se
   * queda con los codicons que trae.
   */
  private findTheme(themeId: string): string | null {
    for (const ext of vscode.extensions.all) {
      const contributes = asRecord(asRecord(ext.packageJSON)?.contributes);
      const themes = contributes?.productIconThemes;
      if (!Array.isArray(themes)) { continue; }

      for (const entry of themes) {
        const theme = asRecord(entry);
        if (asString(theme?.id) !== themeId) { continue; }
        const relative = asString(theme?.path);
        if (relative) { return path.join(ext.extensionPath, relative); }
      }
    }
    return null;
  }

  public dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this._onDidChange.dispose();
  }
}
