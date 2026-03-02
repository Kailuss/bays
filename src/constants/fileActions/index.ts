// ───────────────────────────── Exports ──────────────────────────────

export * from './types';
export * from './matchers';

// ───────────────────────────── Builtin Actions ──────────────────────────────

import type { FileAction, DynamicFileAction } from './types';
import { MEDIA_ACTIONS } from './media';
import { WEB_ACTIONS, MARKDOWN_TOGGLE_ACTION } from './web';
import { DEVELOPMENT_ACTIONS } from './development';
import { CONFIGURATION_ACTIONS } from './configuration';
import { DATA_ACTIONS } from './data';
import { DOCKER_ACTIONS } from './docker';

/**
 * Acciones dinámicas que se resuelven según el contexto de la bay.
 * Tienen prioridad sobre las acciones estáticas.
 */
export const DYNAMIC_ACTIONS: DynamicFileAction[] = [
  MARKDOWN_TOGGLE_ACTION,
];

/**
 * Array de todas las acciones predefinidas (estáticas).
 * 
 * El orden determina precedencia: si múltiples acciones coinciden con un archivo,
 * se usa la primera del array. Orden actual por frecuencia de uso:
 * 
 * 1. Media (imágenes, documentos, archivos externos)
 * 2. Web (HTML, CSS, REST - Markdown is handled dynamically)
 * 3. Development (tests, scripts, Python, notebooks)
 * 4. Configuration (package.json, .env, LICENSE, prettier)
 * 5. Data (JSON, CSV, YAML, lock files)
 * 6. Docker (Dockerfile)
 */
export const BUILTIN_ACTIONS: FileAction[] = [
  ...MEDIA_ACTIONS,
  ...WEB_ACTIONS,
  ...DEVELOPMENT_ACTIONS,
  ...CONFIGURATION_ACTIONS,
  ...DATA_ACTIONS,
  ...DOCKER_ACTIONS,
];
