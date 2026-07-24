// Resuelve el languageId de VS Code a partir de un nombre de archivo, leyendo
// `contributes.languages` de TODAS las extensiones instaladas — la misma fuente
// que usa VS Code internamente.
//
// Por qué existe: un icon theme puede mapear un tipo de archivo ÚNICAMENTE a
// través de `languageIds`. Por ejemplo `bearded-icons` no tiene ninguna entrada
// `fileExtensions.sh`; los scripts de shell se resuelven vía
// `languageIds.shellscript`. Sin un puente nombre-de-archivo → languageId esos
// archivos caen al icono por defecto del tema. Lo mismo le pasa a .yaml, .yml,
// .xml, .php, .vue, .lua, .r, .py, .md, .json, .ts y .js en ese mismo tema.
//
// No sirve leer `document.languageId`: en el arranque las tabs restauradas no
// tienen documento cargado, y forzar `openTextDocument` despertaría a todas las
// extensiones de lenguaje solo para pintar un icono.

import * as vscode from 'vscode';
import { Logger } from './logger';

interface LanguagePattern {
  regex : RegExp;
  id    : string;
}

/** filename (lowercase) → languageId */
let fileNameMap: Map<string, string> = new Map();
/** dot-suffix con punto inicial (lowercase, p.ej. ".sh", ".d.ts") → languageId */
let extensionMap: Map<string, string> = new Map();
/** `filenamePatterns` compilados a regex */
let patterns: LanguagePattern[] = [];
/** Caché de resoluciones ya calculadas (null = miss confirmado) */
let resolveCache: Map<string, string | null> = new Map();

let built = false;

/**
 * Convierte un glob simple de `filenamePatterns` (solo `*` y `?`) a RegExp.
 * VS Code admite globs más ricos, pero los patrones reales contribuidos por
 * extensiones son de esta forma (`*.config.js`, `.env.*`, `tsconfig.*.json`).
 */
function globToRegExp(glob: string): RegExp | undefined {
  try {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  } catch {
    return undefined;
  }
}

/** Las extensiones integradas (`vscode.*`) se registran primero y ganan los empates. */
function isBuiltIn(ext: vscode.Extension<unknown>): boolean {
  return ext.id.startsWith('vscode.');
}

/**
 * Construye los mapas a partir de `contributes.languages` de cada extensión.
 * `packageJSON` está disponible sin activar la extensión, así que esto no
 * despierta nada.
 */
export function buildLanguageRegistry(): void {
  const names   = new Map<string, string>();
  const exts    = new Map<string, string>();
  const globs   : LanguagePattern[] = [];

  // Integradas primero: así una extensión de terceros no puede secuestrar
  // `.md` o `.json` solo por declararlos también (first-wins más abajo).
  const ordered = [...vscode.extensions.all].sort((a, b) => {
    return (isBuiltIn(b) ? 1 : 0) - (isBuiltIn(a) ? 1 : 0);
  });

  for (const extension of ordered) {
    let contributed: any[];
    try {
      contributed = extension.packageJSON?.contributes?.languages ?? [];
    } catch {
      continue;
    }
    if (!Array.isArray(contributed)) { continue; }

    for (const language of contributed) {
      const id = language?.id;
      if (typeof id !== 'string' || !id) { continue; }

      for (const fileName of language.filenames ?? []) {
        if (typeof fileName !== 'string') { continue; }
        const key = fileName.toLowerCase();
        if (!names.has(key)) { names.set(key, id); }
      }

      for (const fileExt of language.extensions ?? []) {
        if (typeof fileExt !== 'string' || !fileExt) { continue; }
        // Las contribuciones las declaran con punto inicial (".sh"); normalizar
        // por si alguna extensión lo omite.
        const key = (fileExt.startsWith('.') ? fileExt : `.${fileExt}`).toLowerCase();
        if (!exts.has(key)) { exts.set(key, id); }
      }

      for (const pattern of language.filenamePatterns ?? []) {
        if (typeof pattern !== 'string') { continue; }
        const regex = globToRegExp(pattern);
        if (regex) { globs.push({ regex, id }); }
      }
    }
  }

  fileNameMap  = names;
  extensionMap = exts;
  patterns     = globs;
  resolveCache = new Map();
  built        = true;

  Logger.log(
    `[LanguageRegistry] Built: ${names.size} file names, ${exts.size} extensions, ${globs.length} patterns`
  );
}

/**
 * Registra la reconstrucción del registro cuando se instalan/desinstalan
 * extensiones (pueden aportar o retirar lenguajes).
 */
export function activateLanguageRegistry(context: vscode.ExtensionContext): void {
  buildLanguageRegistry();
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      Logger.log('[LanguageRegistry] Extensions changed, rebuilding...');
      buildLanguageRegistry();
    })
  );
}

/**
 * Todos los sufijos con punto de un nombre, del más específico al más genérico.
 * `foo.d.ts` → ['.d.ts', '.ts'];  `.bashrc` → ['.bashrc'].
 */
function dotSuffixes(fileNameLower: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < fileNameLower.length; i++) {
    if (fileNameLower[i] === '.') {
      result.push(fileNameLower.substring(i));
    }
  }
  return result;
}

/**
 * Resuelve el languageId de un nombre de archivo.
 * Orden (el mismo que VS Code): nombre exacto → patrón → sufijo más específico.
 * Devuelve `undefined` si ninguna extensión instalada reclama ese archivo.
 */
export function resolveLanguageId(fileName: string): string | undefined {
  if (!fileName) { return undefined; }
  if (!built) { buildLanguageRegistry(); }

  const key = fileName.toLowerCase();

  const cached = resolveCache.get(key);
  if (cached !== undefined) { return cached ?? undefined; }

  let resolved: string | undefined;

  resolved = fileNameMap.get(key);

  if (!resolved) {
    for (const { regex, id } of patterns) {
      if (regex.test(fileName)) { resolved = id; break; }
    }
  }

  if (!resolved) {
    for (const suffix of dotSuffixes(key)) {
      const hit = extensionMap.get(suffix);
      if (hit) { resolved = hit; break; }
    }
  }

  resolveCache.set(key, resolved ?? null);
  return resolved;
}
