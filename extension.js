import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup?version=3.0';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {formatPanel, formatUsd, quotaFraction, summarizeBalance} from './lib/balance.js';

const EXTENSION_UUID = 'ollama-quota@abdasis.github.io';
const BASE_URL = 'https://ollama.com';
const DASHBOARD_URL = 'https://ollama.com/dashboard';
const REQUEST_TIMEOUT_SECONDS = 15;
const LOW_QUOTA_PERCENT = 20;
const CRITICAL_QUOTA_PERCENT = 5;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const isCancelled = error =>
  error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

function formatLocalDateTime(iso) {
  try {
    const dateTime = GLib.DateTime.new_from_iso8601(iso, null);
    if (!dateTime)
      return '—';

    return dateTime.to_local().format('%d/%m/%Y %H:%M');
  } catch {
    return '—';
  }
}

class OllamaClient {
  constructor(cancellable) {
    this._cancellable = cancellable;
    this._session = new Soup.Session();
    this._session.timeout = REQUEST_TIMEOUT_SECONDS;
  }

  destroy() {
    this._session.abort();
  }

  /**
   * GET JSON dari API Ollama. Melempar ApiError untuk status non-200
   * dan GLib.Error (termasuk CANCELLED) untuk kegagalan jaringan.
   *
   * @param {string} path Path API, misal "/api/balance".
   * @param {string} apiKey Kunci API Ollama.
   * @returns {Promise<unknown>} Body JSON hasil parse.
   */
  async getJson(path, apiKey) {
    const message = Soup.Message.new('GET', `${BASE_URL}${path}`);
    message.request_headers.append('Authorization', `Bearer ${apiKey}`);
    message.request_headers.append('Accept', 'application/json');

    const bytes = await new Promise((resolve, reject) => {
      this._session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        this._cancellable,
        (session, result) => {
          try {
            resolve(session.send_and_read_finish(result));
          } catch (error) {
            reject(error);
          }
        });
    });

    const status = message.get_status();
    const text = new TextDecoder().decode(bytes.get_data());

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (status !== Soup.Status.OK) {
      const detail = typeof json?.error === 'string' ? json.error : `HTTP ${status}`;
      throw new ApiError(detail, status);
    }

    if (json === null)
      throw new ApiError('Respons API tidak valid', status);

    return json;
  }
}

const OllamaQuotaIndicator = GObject.registerClass(
class OllamaQuotaIndicator extends PanelMenu.Button {
  _init(extension) {
    super._init(0.0, 'Ollama Quota');

    this._extension = extension;
    this._settings = extension.getSettings();
    this._cancellable = new Gio.Cancellable();
    this._client = new OllamaClient(this._cancellable);
    this._destroyed = false;
    this._refreshing = false;
    this._timerId = 0;
    this._tooltipText = '';
    this._quotaPercent = null;
    this._intervalChangedId = 0;
    this._apiKeyChangedId = 0;

    this._buildPanel();
    this._buildMenu();
    this._buildTooltip();

    this._intervalChangedId = this._settings.connect('changed::refresh-interval', () => this._rearmTimer());
    this._apiKeyChangedId = this._settings.connect('changed::api-key', () => this.refresh());

    this._rearmTimer();
  }

  _buildPanel() {
    const iconPath = GLib.build_filenamev([this._extension.path, 'icons', 'ollama-quota.png']);
    this._icon = new St.Icon({
      gicon: new Gio.FileIcon({file: Gio.File.new_for_path(iconPath)}),
      icon_size: 16,
      style_class: 'system-status-icon',
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._label = new St.Label({
      text: '—',
      style_class: 'ollama-quota-label',
      y_align: Clutter.ActorAlign.CENTER,
    });

    const box = new St.BoxLayout({
      style_class: 'panel-status-menu-box',
      y_align: Clutter.ActorAlign.CENTER,
    });
    box.add_child(this._icon);
    box.add_child(this._label);
    this.add_child(box);
  }

  _addInfoItem(title) {
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const row = new St.BoxLayout({x_expand: true, style_class: 'ollama-quota-row'});
    const titleLabel = new St.Label({
      text: title,
      style_class: 'ollama-quota-title',
      x_expand: true,
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const valueLabel = new St.Label({
      text: '—',
      style_class: 'ollama-quota-detail',
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.CENTER,
    });

    row.add_child(titleLabel);
    row.add_child(valueLabel);
    item.add_child(row);
    this.menu.addMenuItem(item);
    return valueLabel;
  }

  // Bilah kuota digambar sendiri: St tidak punya widget progress bawaan, dan
  // lebarnya harus mengikuti persen sisa yang berubah tiap penyegaran.
  _buildQuotaBar() {
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this._quotaBar = new St.DrawingArea({
      style_class: 'ollama-quota-bar',
      x_expand: true,
    });
    this._quotaBar.connect('repaint', () => this._drawQuotaBar());
    item.add_child(this._quotaBar);
    this.menu.addMenuItem(item);
  }

  _drawQuotaBar() {
    const cr = this._quotaBar.get_context();
    const [width, height] = this._quotaBar.get_surface_size();
    if (!cr || width <= 0 || height <= 0)
      return;

    const node = this._quotaBar.get_theme_node();
    this._paintPill(cr, width, height, height / 2, node.get_color('background-color'));

    const fraction = quotaFraction(this._quotaPercent);
    if (fraction === null || fraction <= 0)
      return;

    const filled = width * fraction;
    this._paintPill(cr, filled, height, Math.min(height / 2, filled / 2), node.get_color('color'));
  }

  _paintPill(cr, width, height, radius, color) {
    cr.newSubPath();
    cr.arc(radius, height / 2, radius, Math.PI / 2, (Math.PI * 3) / 2);
    cr.arc(width - radius, height / 2, radius, (Math.PI * 3) / 2, Math.PI / 2);
    cr.closePath();
    cr.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255);
    cr.fill();
  }

  _buildMenu() {
    this._statusLabel = this._addInfoItem('Sisa kuota');
    this._buildQuotaBar();
    this._resetLabel = this._addInfoItem('Reset');
    this._usageLabel = this._addInfoItem('Pemakaian 24 jam');
    this._updatedLabel = this._addInfoItem('Diperbarui');

    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const refreshItem = new PopupMenu.PopupMenuItem('Segarkan');
    refreshItem.connect('activate', () => this.refresh());
    this.menu.addMenuItem(refreshItem);

    const dashboardItem = new PopupMenu.PopupMenuItem('Buka dashboard');
    dashboardItem.connect('activate', () => this._openDashboard());
    this.menu.addMenuItem(dashboardItem);

    const prefsItem = new PopupMenu.PopupMenuItem('Atur API key');
    prefsItem.connect('activate', () => this._openPreferences());
    this.menu.addMenuItem(prefsItem);

    this.menu.connect('open-state-changed', (menu, isOpen) => {
      this._hideTooltip();
      if (isOpen)
        this.refresh();
    });
  }

  // St.Widget tidak punya tooltip bawaan di Shell 46, jadi pakai label
  // dash-label yang mengikuti hover indikator.
  _buildTooltip() {
    this._tooltip = new St.Label({style_class: 'dash-label', visible: false});
    Main.uiGroup.add_child(this._tooltip);
    this._label.track_hover = true;
    this._label.connect('notify::hover', () => this._syncTooltip());
  }

  _syncTooltip() {
    if (!this._label.hover || !this._tooltipText) {
      this._hideTooltip();
      return;
    }

    this._tooltip.set_text(this._tooltipText);
    const [x, y] = this._label.get_transformed_position();
    const [, height] = this._label.get_transformed_size();
    const [, naturalWidth] = this._tooltip.get_preferred_width(-1);
    this._tooltip.set_position(
      Math.round(Math.max(0, x + (this._label.width / 2) - (naturalWidth / 2))),
      Math.round(y + height + 4));
    this._tooltip.show();
  }

  _hideTooltip() {
    this._tooltip?.hide();
  }

  _setTooltip(text) {
    this._tooltipText = text ?? '';
    this._label.set_accessible_name(this._tooltipText || 'Ollama Quota');
    if (!this._tooltipText)
      this._hideTooltip();
  }

  _applySeverity(label, percent) {
    label.remove_style_class_name('warning');
    label.remove_style_class_name('critical');

    if (!Number.isFinite(percent))
      return;

    if (percent < CRITICAL_QUOTA_PERCENT)
      label.add_style_class_name('critical');
    else if (percent < LOW_QUOTA_PERCENT)
      label.add_style_class_name('warning');
  }

  _applySummary(summary, usage) {
    this._label.set_text(formatPanel(summary));
    this._applySeverity(this._label, summary.percent);

    const parts = [formatPanel(summary)];
    if (Number.isFinite(summary.remainingUsd) && Number.isFinite(summary.allowanceUsd)) {
      parts.push(
        `${formatUsd(summary.remainingUsd)} dari ${formatUsd(summary.allowanceUsd)}`);
    }

    this._statusLabel.set_text(parts.join(' · '));
    this._applySeverity(this._statusLabel, summary.percent);

    this._quotaPercent = summary.percent;
    this._applySeverity(this._quotaBar, summary.percent);
    this._quotaBar.repaint();

    this._resetLabel.set_text(summary.resetsAt
      ? formatLocalDateTime(summary.resetsAt)
      : '—');

    this._usageLabel.set_text(usage
      ? `${usage.requestCount} request · ${formatUsd(usage.usageUsd)}`
      : 'tidak tersedia');

    this._updatedLabel.set_text(GLib.DateTime.new_now_local().format('%H:%M'));

    this._setTooltip('');
  }

  _showFailure(message) {
    this._label.set_text('—');
    this._applySeverity(this._label, null);

    this._statusLabel.set_text('—');
    this._applySeverity(this._statusLabel, null);

    this._quotaPercent = null;
    this._applySeverity(this._quotaBar, null);
    this._quotaBar.repaint();

    this._setTooltip(message);
  }

  async _fetchUsage(apiKey) {
    try {
      const json = await this._client.getJson('/api/usage?range=24h', apiKey);
      const totals = json?.totals;
      if (typeof totals !== 'object' || totals === null)
        return null;

      return {
        requestCount: Number.isFinite(totals.request_count) ? totals.request_count : 0,
        usageUsd: Number.isFinite(totals.usage_usd) ? totals.usage_usd : 0,
      };
    } catch (error) {
      if (isCancelled(error))
        throw error;

      // Detail pemakaian bersifat opsional: kegagalannya tidak membatalkan refresh.
      return null;
    }
  }

  async refresh() {
    if (this._refreshing || this._destroyed)
      return;

    const apiKey = this._settings.get_string('api-key').trim();
    if (!apiKey) {
      this._showFailure('Belum ada API key');
      return;
    }

    this._refreshing = true;
    try {
      const balance = await this._client.getJson('/api/balance', apiKey);
      const summary = summarizeBalance(balance);
      const usage = await this._fetchUsage(apiKey);

      if (this._destroyed)
        return;

      this._applySummary(summary, usage);
    } catch (error) {
      // 429 tidak diulang otomatis; timer berikutnya tetap berjalan.
      if (isCancelled(error) || this._destroyed)
        return;

      this._showFailure(this._describeError(error));
    } finally {
      this._refreshing = false;
    }
  }

  _describeError(error) {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403)
        return 'API key ditolak. Periksa lewat Atur API key.';
      if (error.status === 429)
        return 'Batas permintaan tercapai. Coba lagi beberapa saat lagi.';
      if (error.status === 503)
        return 'Layanan Ollama sedang tidak tersedia.';

      return error.message;
    }

    if (error instanceof GLib.Error)
      return error.message;

    return error?.message ?? 'Gagal memuat kuota';
  }

  _rearmTimer() {
    if (this._timerId) {
      GLib.source_remove(this._timerId);
      this._timerId = 0;
    }

    const minutes = Math.min(60, Math.max(1, this._settings.get_int('refresh-interval')));
    this._timerId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      minutes * 60,
      () => {
        this.refresh();
        return GLib.SOURCE_CONTINUE;
      });
  }

  _openDashboard() {
    try {
      Gio.AppInfo.launch_default_for_uri(DASHBOARD_URL, null);
    } catch (error) {
      logError(error, 'ollama-quota: gagal membuka dashboard');
    }
  }

  _openPreferences() {
    try {
      Util.spawn(['gnome-extensions', 'prefs', EXTENSION_UUID]);
    } catch (error) {
      logError(error, 'ollama-quota: gagal membuka preferensi');
    }
  }

  destroy() {
    this._destroyed = true;
    this._cancellable.cancel();
    this._client.destroy();

    if (this._timerId) {
      GLib.source_remove(this._timerId);
      this._timerId = 0;
    }

    if (this._intervalChangedId) {
      this._settings.disconnect(this._intervalChangedId);
      this._intervalChangedId = 0;
    }

    if (this._apiKeyChangedId) {
      this._settings.disconnect(this._apiKeyChangedId);
      this._apiKeyChangedId = 0;
    }

    this._hideTooltip();
    this._tooltip?.destroy();
    this._tooltip = null;

    super.destroy();
  }
});

export default class OllamaQuotaExtension extends Extension {
  enable() {
    this._indicator = new OllamaQuotaIndicator(this);
    Main.panel.addToStatusArea(EXTENSION_UUID, this._indicator);
    this._indicator.refresh();
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
  }
}
