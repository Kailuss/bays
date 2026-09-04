// Solo gestiona datos y la lógica de mapeo — no devuelve rutas absolutas ni HTML.
// Construye y expone un `iconMap` (solo datos) que el webview usa para resolver iconos.

import * as vscode from 'vscode';
import * as fsp    from 'fs/promises';
import { Logger }  from '../../platform/logger';
import * as path   from 'path';
import { resolveLanguageId } from '../../platform/languageRegistry';
import { DEFAULT_FILE_ICON, buildFontIconMarker, iconFontFamily } from '../../utils/iconMarkers';
import { parseFontDecls, fontFaceBlock, fontMimeType } from '../../utils/themeFonts';
import { asRecord, asString, iconIdEntries, iconDefinition, iconDefinitionIds } from '../../utils/iconTheme';
import type { IconThemeJson } from '../../utils/iconTheme';
import type { FontDecl } from '../../utils/themeFonts';

/**
 * Una fuente del icon theme con su ruta ya RESUELTA contra el directorio del
 * tema. Lo que la declara y endurece es `utils/themeFonts.ts`; lo único que se
 * añade aquí es la parte que solo el llamante sabe, que es dónde vive el fichero.
 */
type ThemeFont = FontDecl & { path: string };

/**
 * Resuelve y cachea iconos de archivo según el tema de iconos activo.
 * En términos sencillos: encuentra el icono adecuado (por nombre/ext/idioma)
 * y devuelve una imagen en `data:` base64 lista para el webview.
 */
export class BayIconManager {
  private _iconCache         : Map<string, string> = new Map();
  private _iconMap           : Record<string, string> | undefined;
  private _iconThemeId       : string | undefined;
  private _iconThemePath     : string | undefined;
  private _iconThemeJson     : IconThemeJson | undefined;
  private _defaultFileIconId : string | undefined;
  private _themeFonts        : ThemeFont[] = [];
  private _fontFaceCss       : string | undefined;
  private _iconPathCache     : Map<string, string> = new Map();
  private _isPreloadingIcons : boolean = false;
  private _configListener    : vscode.Disposable | undefined;
  private _initPromise       : Promise<void> | undefined;
  private _onDidInitialize   = new vscode.EventEmitter<void>();
  
  /** Evento que se dispara cuando el mapa de iconos está listo */
  public readonly onDidInitialize = this._onDidInitialize.event;

  /**
   * Inicializa el gestor de iconos y registra listeners.
   * Llamar una vez desde `activate()`; prepara la tabla de búsqueda del tema.
   * Devuelve una Promise que se resuelve cuando los iconos están listos.
   */
  public initialize(context: vscode.ExtensionContext): Promise<void> { 
    this._configListener = vscode.workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('workbench.iconTheme')) {
        Logger.log('[Bays] Icon theme changed, rebuilding map...');
        this.clearCache();
        await this.buildIconMap(context, true);
        this._onDidInitialize.fire();
      }
    });

    context.subscriptions.push(this._configListener);
    context.subscriptions.push(this._onDidInitialize);

    this._initPromise = this.buildIconMap(context)
      .then(() => {
        Logger.log(`[Bays] Icon map initialized: themeId=${this._iconThemeId}, mapSize=${this._iconMap ? Object.keys(this._iconMap).length : 0}`);
        this._onDidInitialize.fire();
      })
      .catch(err => {
        Logger.error('[Bays] Error building initial icon map:', err);
      });

    return this._initPromise;
  }

  /**
   * Construye una tabla (mapa) que permite encontrar el icono correcto
   * para un nombre o extensión según el tema activo. No carga los iconos
   * en base64 aquí; solo analiza el JSON del tema.
   */
  public async buildIconMap(
    _context: vscode.ExtensionContext,
    forceRebuild: boolean = false
  ): Promise<void> {
    try {
      const config    = vscode.workspace.getConfiguration();
      const iconTheme = config.get<string>('workbench.iconTheme');

      // Si no hay tema de iconos configurado, limpiar el mapa y salir.
      if (!iconTheme) {
        this.clearThemeState('');
        return;
      }

      // Si el tema no cambió y ya tenemos el mapa, no volver a reconstruir.
      if (this._iconThemeId === iconTheme && this._iconMap && !forceRebuild) {
        Logger.log('[Bays] Icon map already exists for theme: ' + iconTheme);
        return;
      }

      let ext               = this.findIconThemeExtension(iconTheme);
      let themeJson: IconThemeJson | undefined;
      let themePath: string = '';
      let themeId           = iconTheme;

      // Fallback a 'vs-seti' si no encontramos el tema configurado
      if (!ext) {
        Logger.log('[Bays] Theme not found, trying vs-seti fallback: ' + iconTheme);
        ext = this.findIconThemeExtension('vs-seti');
        themeId = 'vs-seti';

        if (!ext) {
          Logger.warn('[Bays] No icon theme found (not even vs-seti)');
          this.clearThemeState(iconTheme);
          return;
        }
      }

      Logger.log(`[Bays] Building icon map for theme: ${themeId}, from extension: ${ext.id}`);

      // Buscar la entrada del tema en el package.json de la extensión
      // `packageJSON` es de otra extensión: se recorre con narradores en vez de
      // castearse, que es lo que impedía notar un contributes con otra forma.
      const contributes = asRecord(asRecord(ext.packageJSON)?.contributes);
      const declared    = Array.isArray(contributes?.iconThemes) ? contributes.iconThemes : [];
      const themeContribution = declared
        .map(asRecord)
        .find(t => t !== null && asString(t.id) === themeId);
      const contributionPath  = asString(themeContribution?.path);
      if (!contributionPath) {
        Logger.warn('[Bays] Theme contribution not found in extension');
        this.clearThemeState(iconTheme);
        return;
      }

      // Resolver la ruta absoluta al archivo JSON del tema
      themePath = path.join(ext.extensionPath, contributionPath);
      Logger.log('[Bays] Theme path: ' + themePath);

      try {
        await fsp.access(themePath);
      } catch {
        Logger.warn('[Bays] Theme file not accessible: ' + themePath);
        this.clearThemeState(iconTheme);
        return;
      }

      try {
        const themeContent = await fsp.readFile(themePath, 'utf8');
        themeJson          = JSON.parse(themeContent) as IconThemeJson;
      } catch (err) {
        Logger.error('[Bays] Error parsing icon theme JSON:', err);
        this.clearThemeState(iconTheme);
        return;
      }

      this._iconThemeId = iconTheme;
      this._iconThemePath = themePath;
      this._iconThemeJson = themeJson;

      // El id del icono de archivo por defecto lo declara el propio tema en su
      // clave `file`; no siempre se llama `_file`. Guardarlo evita adivinarlo
      // buscando claves que "contengan file" en iconDefinitions.
      this._defaultFileIconId = asString(themeJson.file);

      this._themeFonts  = this.parseThemeFonts(themeJson, path.dirname(themePath));
      this._fontFaceCss = undefined;   // se regenera perezosamente por tema

      const iconMap: Record<string, string> = {};

      // Los tres mapas del tema, con el prefijo que dice por qué pregunta entró
      // cada clave. `iconIdEntries` descarta lo que no sea una cadena en vez de
      // castearlo: un valor de otra forma metía `[object Object]` en el mapa, y
      // eso no falla de manera ruidosa — sencillamente ese tipo de fichero no
      // encuentra su icono nunca.
      for (const [name, id] of iconIdEntries(themeJson.fileNames))      { iconMap[`name:${name}`] = id; }
      for (const [ext_, id] of iconIdEntries(themeJson.fileExtensions)) { iconMap[`ext:${ext_}`]  = id; }
      for (const [lang, id] of iconIdEntries(themeJson.languageIds))    { iconMap[`lang:${lang}`] = id; }

      // Log de archivos especiales mapeados para debugging
      const specialFiles = ['.vscodeignore', '.gitignore', '.npmignore', '.dockerignore'];
      specialFiles.forEach(file => {
        const key = `name:${file}`;
        if (iconMap[key]) {
          Logger.log(`[Bays] Special file mapped: ${file} → ${iconMap[key]}`);
        }
      });

      this._iconMap = iconMap;
    } catch (error) {
      Logger.error('[Bays] Error building icon map:', error);
      this._iconMap = this._iconMap || {};
    }
  }

  /**
   * Lee `fonts[]` del tema. Un tema basado en fuente (vs-seti, el tema por
   * defecto de VS Code) define cada icono como un `fontCharacter` de esa fuente;
   * sin declararla vía @font-face el webview pinta el codepoint crudo (cuadros).
   * De cada fuente se toma el primer `src` con formato conocido.
   */
  private parseThemeFonts(themeJson: unknown, themeDir: string): ThemeFont[] {
    const declared = typeof themeJson === 'object' && themeJson !== null
      ? (themeJson as { fonts?: unknown }).fonts
      : undefined;

    // El parseo y la lista blanca viven en `utils/themeFonts.ts`: los valores
    // salen del JSON de un tema ajeno y acaban dentro de un `<style>`, así que
    // un `weight` con `</style>` cerraría el elemento. Aquí solo se resuelve la
    // ruta, que es lo único que este lado sabe.
    return parseFontDecls(declared).map(font => ({
      ...font,
      path: path.resolve(
        themeDir,
        process.platform === 'win32' ? font.src.replace(/\//g, path.sep) : font.src,
      ),
    }));
  }


  /**
   * CSS `@font-face` de las fuentes del tema activo, con el fichero incrustado
   * como `data:` URI. Se incrusta en vez de servirlo por `asWebviewUri` porque la
   * fuente vive fuera de `localResourceRoots` (en el directorio de la extensión
   * del tema, o dentro del propio VS Code), donde el webview no puede leerla.
   *
   * Cadena vacía si el tema es de tipo SVG (la mayoría) o no hay fuentes.
   */
  public async getFontFaceCss(): Promise<string> {
    if (this._fontFaceCss !== undefined) { return this._fontFaceCss; }
    if (this._themeFonts.length === 0) {
      this._fontFaceCss = '';
      return this._fontFaceCss;
    }

    const blocks: string[] = [];
    for (const font of this._themeFonts) {
      try {
        const data = await fsp.readFile(font.path);
        const uri = `data:${fontMimeType(font.path)};base64,${data.toString('base64')}`;
        blocks.push(fontFaceBlock(iconFontFamily(font.id), uri, font));
      } catch (err) {
        Logger.warn(`[Bays] Could not load icon theme font ${font.path}: ${err}`);
      }
    }

    this._fontFaceCss = blocks.join('\n');
    Logger.log(`[Bays] Icon theme fonts embedded: ${blocks.length}/${this._themeFonts.length}`);
    return this._fontFaceCss;
  }

  /**
   * Busca la extensión que declara el tema de iconos activo.
   * Devuelve `undefined` si no se encuentra (usamos un fallback entonces).
   */
  private findIconThemeExtension(themeId: string): vscode.Extension<unknown> | undefined {
    return vscode.extensions.all.find(e => {
      const contributes = asRecord(asRecord(e.packageJSON)?.contributes);
      const themes      = contributes?.iconThemes;
      if (!Array.isArray(themes)) { return false; }
      return themes.some(t => asString(asRecord(t)?.id) === themeId);
    });
  }

  /**
   * Devuelve el icono para `fileName` como una URI `data:` base64 lista para `<img>`.
   * Uso: la vista inserta directamente este string en el `src` de la etiqueta.
   */
  public async getFileIconAsBase64(
    fileName: string,
    context: vscode.ExtensionContext,
    languageId?: string
  ): Promise<string | undefined> {
    try {
      if (!this._iconMap || !this._iconThemeJson) {
        if (!this._iconThemeId) {
          await this.buildIconMap(context);
        }
        if (!this._iconMap || !this._iconThemeJson) {
          return undefined;
        }
      }

      const themeJson = this._iconThemeJson;
      const fileNameLower = fileName.toLowerCase();

      const lastDotIndex = fileNameLower.lastIndexOf('.');
      const extName = lastDotIndex >= 0 ? fileNameLower.substring(lastDotIndex + 1) : '';

      // Compound extension for dotfiles/multi-dot names (e.g. ".d.ts", ".test.js")
      const firstDotIndex = fileNameLower.indexOf('.');
      const compoundExt = firstDotIndex >= 0 && firstDotIndex !== lastDotIndex
        ? fileNameLower.substring(firstDotIndex + 1)
        : '';

      // Key the cache purely on the (lowercased) file name so that the
      // background preload and the render-path lookup always agree. languageId
      // still refines resolution below, but must NOT be part of the key or the
      // preloaded entry would never be read back (cold reads on every paint).
      const cacheKey = fileNameLower;

      // Un icono ya resuelto (base64 o font-icon) se devuelve tal cual: sin esto
      // un hit en _iconPathCache seguía releyendo y re-codificando el SVG en cada
      // pintado.
      const cachedIcon = this._iconCache.get(cacheKey);
      if (cachedIcon) { return cachedIcon; }

      // Check path cache
      let iconPath = this._iconPathCache.get(cacheKey);

      if (!iconPath) {
        let iconId: string | undefined = undefined;

        // Priority: exact file name → compound ext → simple ext → language id
        if (this._iconMap[`name:${fileNameLower}`]) {
          iconId = this._iconMap[`name:${fileNameLower}`];
        } else if (compoundExt && this._iconMap[`ext:${compoundExt}`]) {
          iconId = this._iconMap[`ext:${compoundExt}`];
        } else if (extName && this._iconMap[`ext:${extName}`]) {
          iconId = this._iconMap[`ext:${extName}`];
        }

        // Resolución por lenguaje. Muchos temas mapean tipos de archivo MUY
        // comunes solo aquí y no en `fileExtensions` — bearded-icons, por
        // ejemplo, no declara `ext:sh` y resuelve los scripts vía
        // `languageIds.shellscript`. El languageId explícito (documento ya
        // abierto) manda; si no hay, se deriva del nombre con el registro de
        // lenguajes contribuidos, que funciona también para tabs restauradas
        // cuyo documento aún no está cargado.
        if (!iconId) {
          const effectiveLanguageId = languageId ?? resolveLanguageId(fileName);
          if (effectiveLanguageId) {
            iconId = this._iconMap[`lang:${effectiveLanguageId.toLowerCase()}`];
          }
        }

        // Archivos especiales: *ignore (gitignore, npmignore, dockerignore, vscodeignore)
        if (!iconId && fileNameLower.endsWith('ignore')) {
          // Buscar patrón genérico "ignore" en diferentes formas
          const gitignoreId = this._iconMap['name:.gitignore'];
          const ignoreExtId = this._iconMap['ext:ignore'];
          const ignoreLangId = this._iconMap['lang:ignore'];
          iconId = gitignoreId || ignoreLangId || ignoreExtId;
        }

        // Último recurso para la familia JS/TS, que algunos temas indexan por
        // lenguaje con nombres no estándar.
        if (!iconId && ['js', 'ts', 'jsx', 'tsx'].includes(extName)) {
          iconId = this.getJavaScriptTypeScriptIconId(fileNameLower, extName);
        }

        // Fallback al icono de archivo por defecto
        if (!iconId) {
          const declaredDefault = this._defaultFileIconId;
          const has = (id: string) => iconDefinition(themeJson.iconDefinitions, id) !== null;
          if (declaredDefault && has(declaredDefault)) {
            iconId = declaredDefault;
          } else if (has('_file')) {
            iconId = '_file';
          } else if (has('file')) {
            iconId = 'file';
          } else {
            const fileIconKey = iconDefinitionIds(themeJson.iconDefinitions).find(
              key => key.toLowerCase().includes('file') && !key.toLowerCase().includes('folder')
            );
            if (fileIconKey) {
              iconId = fileIconKey;
            } else {
              // Sin definición utilizable: el renderer dibuja su SVG genérico.
              // Antes se devolvía el glyph \E023 de la fuente Seti, que fuera de
              // ese tema (o sin @font-face) se pintaba como un cuadro vacío.
              const fallbackIcon = DEFAULT_FILE_ICON;
              this._iconCache.set(cacheKey, fallbackIcon);
              return fallbackIcon;
            }
          }
        }

        const iconDef = iconId ? iconDefinition(themeJson.iconDefinitions, iconId) : null;
        if (!iconDef) {
          // Fallback final si no se encuentra la definición del icono
          const fallbackIcon = DEFAULT_FILE_ICON;
          this._iconCache.set(cacheKey, fallbackIcon);
          return fallbackIcon;
        }

        // Check for SVG-based theme (iconPath) or font-based theme (fontCharacter)
        iconPath = iconDef.iconPath || iconDef.path;

        if (!iconPath && iconDef.fontCharacter) {
          // Tema basado en fuente (vs-seti y similares). Se arrastra el fontId
          // para que el renderer aplique la font-family correcta: un tema puede
          // declarar varias fuentes y `fonts[0]` es la de por defecto cuando la
          // definición no especifica ninguna.
          const fontId = iconDef.fontId ?? (this._themeFonts[0]?.id ?? '');
          const fontIconData = buildFontIconMarker(
            iconDef.fontCharacter,
            iconDef.fontColor ?? '#cccccc',
            fontId,
            iconDef.fontSize ?? '',
          );
          this._iconCache.set(cacheKey, fontIconData);
          return fontIconData;
        }
        if (!iconPath) {
          // iconDef exists but has neither fontCharacter nor iconPath — use generic file icon
          const fallbackIcon = DEFAULT_FILE_ICON;
          this._iconCache.set(cacheKey, fallbackIcon);
          return fallbackIcon;
        }

        this._iconPathCache.set(cacheKey, iconPath);
      }

      const iconThemeDir = path.dirname(this._iconThemePath!);

      let normalizedIconPath = iconPath;
      if (process.platform === 'win32') {
        normalizedIconPath = iconPath.replace(/\//g, path.sep);
      }

      const absIconPath = path.resolve(iconThemeDir, normalizedIconPath);

      try {
        await fsp.access(absIconPath);
      } catch {
        const altPath = path.join(iconThemeDir, normalizedIconPath);
        try {
          await fsp.access(altPath);
          const result = await this.readIconAndConvertToBase64(altPath);
          if (result) { this._iconCache.set(cacheKey, result); }
          return result;
        } catch {
          return undefined;
        }
      }

      const result = await this.readIconAndConvertToBase64(absIconPath, fileName);
      if (result) { this._iconCache.set(cacheKey, result); }
      return result;
    } catch (e) {
      Logger.error(`[Bays] Error getting icon for ${fileName}:`, e);
      return undefined;
    }
  }

  /** Specialised lookup for JS/TS family icons. */
  private getJavaScriptTypeScriptIconId(
    _fileName: string,
    ext: string
  ): string | undefined {
    if (!this._iconMap || !this._iconThemeJson) {
      return undefined;
    }

    const langMap: Record<string, string[]> = {
      js:  ['lang:javascript', 'ext:js'],
      ts:  ['lang:typescript', 'ext:ts'],
      jsx: ['lang:javascriptreact', 'ext:jsx'],
      tsx: ['lang:typescriptreact', 'ext:tsx'],
    };

    const keys = langMap[ext];
    if (!keys) {
      return undefined;
    }

    for (const key of keys) {
      if (this._iconMap[key]) {
        return this._iconMap[key];
      }
    }

    return undefined;
  }

  /**
   * Pre-loads icons for all currently open tabs in the background.
   */
  public async preloadIconsInBackground(
    context: vscode.ExtensionContext,
    forceRefresh: boolean = false
  ): Promise<void> {
    if (this._isPreloadingIcons && !forceRefresh) {
      return;
    }

    this._isPreloadingIcons = true;
    try {
      const allBays: vscode.Tab[] = [];
      for (const group of vscode.window.tabGroups.all) {
        for (const bay of group.tabs) {
          allBays.push(bay);
        }
      }

      const iconLoaders: (() => Promise<void>)[] = [];

      for (const bay of allBays) {
        if (bay.input instanceof vscode.TabInputText) {
          const input = bay.input as vscode.TabInputText;
          const fileName = input.uri.path.split('/').pop() || '';

          const loadIcon = async () => {
            try {
              // Only read languageId from documents already loaded; never force
              // openTextDocument here — at startup that would load every restored
              // tab's document into the host and wake unrelated language
              // extensions, all for a value that is merely the last-resort icon
              // fallback (filename/extension matching handles the common cases).
              const doc = vscode.workspace.textDocuments.find(
                d => d.uri.toString() === input.uri.toString()
              );
              const languageId = doc?.languageId;

              const cacheKey = fileName.toLowerCase();
              if (!this._iconCache.has(cacheKey) || forceRefresh) {
                // getFileIconAsBase64 devuelve el valor cacheado si existe, así
                // que un force refresh debe invalidar ambas cachés primero o no
                // recargaría nada.
                if (forceRefresh) {
                  this._iconCache.delete(cacheKey);
                  this._iconPathCache.delete(cacheKey);
                }
                // getFileIconAsBase64 already caches under the same key; the
                // explicit set is a harmless belt-and-suspenders.
                const iconBase64 = await this.getFileIconAsBase64(fileName, context, languageId);
                if (iconBase64) {
                  this._iconCache.set(cacheKey, iconBase64);
                }
              }
            } catch (error) {
              Logger.error(`[Bays] Error preloading icon for ${fileName}:`, error);
            }
          };

          // Push the closure UNINVOKED so the batch loop below actually throttles
          // concurrency; invoking here would start every load immediately and make
          // the batching a no-op.
          iconLoaders.push(loadIcon);
        }
      }

      // Batch execution (5 at a time)
      const batchSize = 5;
      for (let i = 0; i < iconLoaders.length; i += batchSize) {
        const batch = iconLoaders.slice(i, i + batchSize);
        await Promise.all(batch.map(fn => fn()));
      }
    } finally {
      this._isPreloadingIcons = false;
    }
  }

  /** Retrieve an icon from the in-memory cache (keyed by lowercased file name). */
  public getCachedIcon(fileName: string): string | undefined {
    return this._iconCache.get(fileName.toLowerCase());
  }

  /** Clear all icon caches. */
  public clearCache(): void {
    this._iconCache.clear();
    this._iconPathCache.clear();
  }

  /**
   * Resets every theme-derived field so no stale theme lingers after an empty or
   * failed rebuild. Without clearing `_iconThemeJson`/`_iconThemePath`, switching
   * the icon theme to "None" (or to a broken theme) leaves the previous theme's
   * JSON in place, and the default-icon fallback keeps resolving the OLD theme's
   * icons against its stale path instead of rendering the neutral fallback.
   */
  private clearThemeState(themeId: string): void {
    this._iconMap            = {};
    this._iconThemeId        = themeId;
    this._iconThemeJson      = undefined;
    this._iconThemePath      = undefined;
    this._defaultFileIconId  = undefined;
    // También las fuentes: si no, al pasar a "None" o a un tema roto seguiría
    // emitiéndose el @font-face del tema anterior.
    this._themeFonts         = [];
    this._fontFaceCss        = undefined;
  }

  /** Read an icon file from disk and return a base64 data URI. */
  private async readIconAndConvertToBase64(
    iconPath: string,
    _fileName?: string
  ): Promise<string | undefined> {
    try {
      const fileData   = await fsp.readFile(iconPath);
      const base64Data = fileData.toString('base64');
      const isSvg      = iconPath.toLowerCase().endsWith('.svg');
      const mimeType   = isSvg ? 'image/svg+xml' : 'image/png';
      return `data:${mimeType};base64,${base64Data}`;
    } catch (e) {
      Logger.error(`[Bays] Error reading icon from ${iconPath}:`, e);
      return undefined;
    }
  }
}
