/**
 * Constantes de timing para debouncing, retries y delays.
 * Centraliza valores hardcodeados de tiempo.
 */

export const TIMINGS = {
  // Debounce intervals (ms)
  WEBVIEW_REFRESH_DEBOUNCE: 30,
  ICON_THEME_CHANGE_DEBOUNCE: 100,
  
  // Retry delays (ms)
  ACTIVATION_RETRY_DELAY: 50,
  ACTIVATION_MAX_RETRIES: 3,
  
  // Sync delays (ms)
  SYNC_PROPAGATION_DELAY: 5, // Tiempo para que VS Code propague el estado de bays
  
  // Cache TTL (ms)
  ICON_CACHE_TTL: 300000, // 5 minutos
} as const;
