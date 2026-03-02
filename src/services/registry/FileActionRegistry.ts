import * as vscode from 'vscode';
import { Logger }  from '../../utils/logger';
import { 
  FileAction, 
  DynamicFileAction,
  ResolvedFileAction, 
  FileActionContext,
  BUILTIN_ACTIONS,
  DYNAMIC_ACTIONS 
} from '../../constants/fileActions/index';

// Re-export for consumers that import from this module
export type { FileAction, ResolvedFileAction, FileActionContext } from '../../constants/fileActions/index';

// ──────────────────────────────── Registry ─────────────────────────────────────

/**
 * Registro extensible de acciones contextuales por tipo de archivo.
 *
 * **Cómo añadir una acción nueva:**
 * ```ts
 * registry.register({
 *   id      : 'myAction',
 *   icon    : 'codicon-name',
 *   tooltip : 'Do something cool',
 *   match   : (name, uri) => name.endsWith('.xyz'),
 *   execute : async (uri) => { ... },
 * });
 * ```
 *
 * Las acciones se evalúan en orden de registro; la primera cuyo `match`
 * devuelva `true` gana.  Las acciones registradas manualmente tienen
 * prioridad sobre las built-in.
 * 
 * **Acciones dinámicas:** Para acciones que dependen del estado de la bay
 * (como toggle preview/source), se usa `DynamicFileAction` que resuelve
 * icono y tooltip según el contexto.
 */
export class FileActionRegistry {

  /** Acciones añadidas por el usuario / otros módulos (mayor prioridad). */
  private custom: FileAction[] = [];

  /** Acciones predefinidas estáticas (menor prioridad). */
  private builtin: FileAction[] = [...BUILTIN_ACTIONS];

  /** Acciones dinámicas que se resuelven según contexto (mayor prioridad que estáticas). */
  private dynamic: DynamicFileAction[] = [...DYNAMIC_ACTIONS];

  /** Registra una acción personalizada (se evalúa antes que las built-in). */
  register(action: FileAction): void {
    this.custom.push(action);
  }

  /** Elimina una acción por su id. */
  unregister(id: string): void {
    this.custom  = this.custom.filter(a => a.id !== id);
    this.builtin = this.builtin.filter(a => a.id !== id);
    this.dynamic = this.dynamic.filter(a => a.id !== id);
  }

  /**
   * Resuelve la acción contextual para un archivo.
   * Devuelve la primera acción cuyo `match` sea `true`, o `null` si
   * ninguna aplica (el botón no se mostrará).
   * 
   * @param fileName - Nombre del archivo (basename)
   * @param uri - URI completa del archivo
   * @param context - Contexto opcional de la bay (viewMode, etc.)
   */
  resolve(fileName: string, uri: vscode.Uri, context?: FileActionContext): ResolvedFileAction | null {
    // Dynamic actions first (they depend on bay state)
    for (const action of this.dynamic) {
      if (action.match(fileName, uri)) {
        const resolved = action.resolve(context);
        return { 
          id: resolved.actionId, 
          icon: resolved.icon, 
          tooltip: resolved.tooltip,
          setFocus: action.setFocus ?? false,
        };
      }
    }
    // Custom static actions
    for (const action of this.custom) {
      if (action.match(fileName, uri)) {
        return { 
          id: action.id, 
          icon: action.icon, 
          tooltip: action.tooltip,
          setFocus: action.setFocus ?? true,
        };
      }
    }
    // Then built-in static
    for (const action of this.builtin) {
      if (action.match(fileName, uri)) {
        return { 
          id: action.id, 
          icon: action.icon, 
          tooltip: action.tooltip,
          setFocus: action.setFocus ?? false,
        };
      }
    }
    return null;
  }

  /**
   * Ejecuta la acción asociada a un archivo (buscada por id).
   * Devuelve `true` si se ejecutó, `false` si no se encontró.
   * 
   * @param actionId - ID de la acción a ejecutar
   * @param uri - URI del archivo
   * @param context - Contexto opcional de la bay
   */
  async execute(actionId: string, uri: vscode.Uri, context?: FileActionContext): Promise<boolean> {
    // Check dynamic actions first (they have context-aware execute)
    for (const action of this.dynamic) {
      const resolved = action.resolve(context);
      if (resolved.actionId === actionId) {
        try {
          await action.execute(uri, context);
          return true;
        } catch (error) {
          Logger.error(`[FileAction] Failed to execute dynamic "${actionId}":`, error);
          return false;
        }
      }
    }

    // Static actions
    const action =
      this.custom.find(a => a.id === actionId) ??
      this.builtin.find(a => a.id === actionId);

    if (!action) { return false; }

    try {
      await action.execute(uri);
      return true;
    } catch (error) {
      Logger.error(`[FileAction] Failed to execute "${actionId}":`, error);
      return false;
    }
  }

  /** Devuelve todas las acciones registradas (para depuración). */
  getAll(): ReadonlyArray<FileAction> {
    return [...this.custom, ...this.builtin];
  }

  /**
   * Devuelve si una acción debe hacer focus o no.
   * @param actionId - ID de la acción
   * @returns true si debe hacer focus, false si no (default)
   */
  shouldSetFocus(actionId: string): boolean {
    // Check dynamic actions
    const dynamicAction = this.dynamic.find(a => a.id === actionId);
    if (dynamicAction) {
      return dynamicAction.setFocus ?? false;
    }

    // Check static actions
    const action = this.custom.find(a => a.id === actionId) ?? this.builtin.find(a => a.id === actionId);
    return action?.setFocus ?? false;
  }
}
