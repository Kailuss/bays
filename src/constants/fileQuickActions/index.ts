export * from './types';
export * from './matchers';

import type { FileQuickAction, DynamicFileQuickAction } from './types';
import {
  MEDIA_ACTIONS,
  WEB_ACTIONS,
  MARKDOWN_TOGGLE_ACTION,
  DEVELOPMENT_ACTIONS,
  CONFIGURATION_ACTIONS,
  DATA_ACTIONS,
  DOCKER_ACTIONS,
} from './quickActions';

/** Acciones dinámicas (prioridad sobre estáticas). */
export const DYNAMIC_ACTIONS: DynamicFileQuickAction[] = [
  MARKDOWN_TOGGLE_ACTION,
];

/** Order determines precedence: first match wins. */
export const BUILTIN_ACTIONS: FileQuickAction[] = [
  ...MEDIA_ACTIONS,
  ...WEB_ACTIONS,
  ...DEVELOPMENT_ACTIONS,
  ...CONFIGURATION_ACTIONS,
  ...DATA_ACTIONS,
  ...DOCKER_ACTIONS,
];
