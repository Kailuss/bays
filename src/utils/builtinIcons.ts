/** Codicon names for built-in webview / unknown-input tabs, keyed by viewType. */
const BUILTIN_ICON_MAP: Record<string, string> = {

  // Por viewType
  'releaseNotes'                       : 'info',
  'simpleBrowser.view'                 : 'globe',
  'markdown.preview'                   : 'open-preview',
  'vscode.markdown.preview.editor'     : 'open-preview',
  'mainThreadWebview-markdown.preview' : 'open-preview',

  // Por label exacto (editores built-in sin URI)
  // TODO los íconos de estas pestañas deben variar según el tema y el idioma
  'Settings'                           : 'settings-gear',
  'Keyboard Shortcuts'                 : 'keyboard',
  'Welcome'                            : 'star-empty',
  'Getting Started'                    : 'star-empty',
  'Editor Playground'                  : 'education',
  'Running Extensions'                 : 'extensions',
  'Process Explorer'                   : 'server-process',
  'Language Models'                    : 'hubot',

};

/** Label prefixes for built-in tabs whose title is dynamic. */
const BUILTIN_PREFIX_MAP: [string, string][] = [
  ['Extension:',     'extensions' ],
  ['Walkthrough:',   'star-empty' ],
  ['Release Notes:', 'info'       ],
  ['Preview ',       'open-preview'],
  ['[Preview] ',     'open-preview'],
];

/**
 * Resolves a codicon name for a built-in (non-file) bay.
 * Search order: viewType → exact label → label prefix → generic fallback.
 */
export function resolveBuiltInCodicon(label: string, viewType?: string): string {
  if (viewType && BUILTIN_ICON_MAP[viewType]) {
    return BUILTIN_ICON_MAP[viewType];
  }

  if (BUILTIN_ICON_MAP[label]) {
    return BUILTIN_ICON_MAP[label];
  }

  for (const [prefix, icon] of BUILTIN_PREFIX_MAP) {
    if (label.startsWith(prefix)) {
      return icon;
    }
  }
  return 'preview';
}
