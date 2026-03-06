import { Bay } from '../../models/Bay';
import type { StateIndicator } from '../html';

type BayRowRenderOptions = {
  bay: Bay;
  showPath: boolean;
  compactMode: boolean;
  activeClass: string;
  iconHtml: string;
  stateIndicator: StateIndicator;
  pinBadge: string;
  versionBadge: string;
  fileActionBtn: string;
  chatBtn: string;
  closeBtn: string;
  esc: (value: string) => string;
};

export class BayRowRenderer {
  static render(options: BayRowRenderOptions): string {
    const {
      bay,
      showPath,
      compactMode,
      activeClass,
      iconHtml,
      stateIndicator,
      pinBadge,
      versionBadge,
      fileActionBtn,
      chatBtn,
      closeBtn,
      esc,
    } = options;

    if (compactMode) {
      const pathSuffix = showPath && bay.metadata.detailLabel
        ? `<span class="bay-path-inline">${esc(bay.metadata.detailLabel)}</span>`
        : '';

      return `<div class="bay compact${activeClass}" data-bay-id="${esc(bay.metadata.id)}">
      <span class="bay-icon">${iconHtml}</span>
      <div class="bay-text">
        <div class="bay-name${stateIndicator.nameClass}">${esc(bay.metadata.label)}${pinBadge}${versionBadge}${pathSuffix}</div>
      </div>
      ${stateIndicator.html}
      <span class="bay-actions">
        ${fileActionBtn}${chatBtn}${closeBtn}
      </span>
    </div>`;
    }

    const pathHtml = showPath && bay.metadata.detailLabel
      ? `<div class="bay-path">${esc(bay.metadata.detailLabel)}</div>`
      : '';

    return `<div class="bay${activeClass}" data-bay-id="${esc(bay.metadata.id)}">
      <span class="bay-icon">${iconHtml}</span>
      <div class="bay-text">
        <div class="bay-name${stateIndicator.nameClass}">${esc(bay.metadata.label)}${pinBadge}${versionBadge}</div>
        ${pathHtml}
      </div>
      ${stateIndicator.html}
      <span class="bay-actions">
        ${fileActionBtn}${chatBtn}${closeBtn}
      </span>
    </div>`;
  }
}
