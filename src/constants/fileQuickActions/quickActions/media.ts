import * as vscode from 'vscode';
import * as path from 'path';
import type { FileQuickAction } from '../types';
import { byExtension } from '../matchers';

export const MEDIA_ACTIONS: FileQuickAction[] = [

  //· Abrir con app externa por defecto
  {
    id      : 'openExternal',
    icon    : 'link-external',
    tooltip : 'Open with Default App',
    match   : byExtension(
      //! Imágenes vectoriales y especializadas
      '.svg', '.ai', '.eps', '.psd', '.sketch', '.fig', '.xd',
      //! Documentos
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
      //! Audio
      '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma',
      //! Video
      '.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v',
      //! Archivos comprimidos
      '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
      //! Ejecutables y binarios
      '.exe', '.dmg', '.app', '.msi', '.deb', '.rpm',
      //! Bases de datos
      '.db', '.sqlite', '.sqlite3', '.mdb', '.accdb',
      //! Diseño 3D y CAD
      '.blend', '.obj', '.fbx', '.stl', '.dwg', '.dxf',
      //! Fuentes
      '.ttf', '.otf', '.woff', '.woff2', '.eot'
    ),
    execute : async (uri) => {
      await vscode.env.openExternal(uri);
    },
  },

  //· SVG: optimizar con SVGO
  {
    id      : 'optimizeSvg',
    icon    : 'sparkle',
    tooltip : 'Optimize SVG',
    match   : byExtension('.svg'),
    execute : async (uri) => {
      const terminal = vscode.window.createTerminal({ name: 'Optimize SVG' });
      terminal.show();
      terminal.sendText(`npx svgo "${uri.fsPath}" -o "${uri.fsPath}"`);
    },
  },

  //· Imágenes/Archivos: copiar como Base64
  {
    id      : 'copyAsBase64',
    icon    : 'copy',
    tooltip : 'Copy as Base64',
    match   : byExtension('.png', '.jpg', '.jpeg', '.svg', '.woff2', '.ico', '.gif'),
    execute : async (uri) => {
      const fs = await import('fs/promises');
      const buffer = await fs.readFile(uri.fsPath);
      const base64 = buffer.toString('base64');
      const mimeTypes: Record<string, string> = {
        '.png'   : 'image/png',
        '.jpg'   : 'image/jpeg',
        '.jpeg'  : 'image/jpeg',
        '.svg'   : 'image/svg+xml',
        '.gif'   : 'image/gif',
        '.woff2' : 'font/woff2',
        '.ico'   : 'image/x-icon'
      };
      const ext = path.extname(uri.fsPath).toLowerCase();
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      const dataUri = `data:${mimeType};base64,${base64}`;
      await vscode.env.clipboard.writeText(dataUri);
      vscode.window.showInformationMessage('✓ Copied as Base64 data URI');
    },
  },

];
