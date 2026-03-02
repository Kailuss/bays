/**
 * Mapa de extensiones de archivo a iconos de codicon.
 * Usado como opción de reserva cuando el tema de iconos no proporciona uno.
 */
export const fileIconMap: Record<string, string> = {
  // JavaScript/TypeScript
  ts     : 'file-code',
  tsx    : 'file-code',
  js     : 'file-code',
  jsx    : 'file-code',
  mjs    : 'file-code',
  cjs    : 'file-code',

  // Web
  html   : 'file-code',
  htm    : 'file-code',
  css    : 'file-code',
  scss   : 'file-code',
  sass   : 'file-code',
  less   : 'file-code',
  vue    : 'file-code',
  svelte : 'file-code',
  
  // Data/Config
  json   : 'json',
  jsonc  : 'json',
  json5  : 'json',
  yaml   : 'file-code',
  yml    : 'file-code',
  toml   : 'file-code',
  xml    : 'file-code',
  ini    : 'file-code',
  env    : 'file-code',
  
  // Documentation
  md     : 'markdown',
  mdx    : 'markdown',
  txt    : 'file',
  rst    : 'file-code',
  
  // Programming Languages
  py     : 'file-code',
  java   : 'file-code',
  c      : 'file-code',
  cpp    : 'file-code',
  cc     : 'file-code',
  cxx    : 'file-code',
  h      : 'file-code',
  hpp    : 'file-code',
  cs     : 'file-code',
  go     : 'file-code',
  rs     : 'file-code',
  rb     : 'file-code',
  php    : 'file-code',
  swift  : 'file-code',
  kt     : 'file-code',
  scala  : 'file-code',
  r      : 'file-code',
  lua    : 'file-code',
  
  // Shell/Scripts
  sh     : 'terminal',
  bash   : 'terminal',
  zsh    : 'terminal',
  ps1    : 'terminal',
  bat    : 'terminal',
  cmd    : 'terminal',
  
  // Database
  sql    : 'database',
  sqlite : 'database',
  db     : 'database',
  
  // Build/Config Files
  gradle : 'file-code',
  cmake  : 'file-code',
  make   : 'file-code',
  
  // Images
  png    : 'file-media',
  jpg    : 'file-media',
  jpeg   : 'file-media',
  gif    : 'file-media',
  svg    : 'file-media',
  ico    : 'file-media',
  webp   : 'file-media',
  
  // Binary/Archive
  zip    : 'file-zip',
  tar    : 'file-zip',
  gz     : 'file-zip',
  rar    : 'file-zip',
  '7z'   : 'file-zip',
  exe    : 'file-binary',
  dll    : 'file-binary',
  so     : 'file-binary',
  
  // Others
  pdf    : 'file-pdf',
  log    : 'output',
  lock   : 'lock',
};
