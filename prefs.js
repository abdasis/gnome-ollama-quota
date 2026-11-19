import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class OllamaQuotaPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage({
      title: 'Ollama Quota',
      icon_name: 'preferences-system-symbolic',
    });

    const group = new Adw.PreferencesGroup({
      title: 'Koneksi',
      description: 'Buat API key di https://ollama.com/settings/keys lalu tempel di bawah.',
    });

    const apiKeyRow = new Adw.PasswordEntryRow({title: 'API key'});
    settings.bind('api-key', apiKeyRow, 'text', Gio.SettingsBindFlags.DEFAULT);
    group.add(apiKeyRow);

    const intervalRow = new Adw.SpinRow({
      title: 'Interval penyegaran',
      subtitle: 'Menit',
      adjustment: new Gtk.Adjustment({
        lower: 1,
        upper: 60,
        step_increment: 1,
        page_increment: 5,
        value: settings.get_int('refresh-interval'),
      }),
    });
    settings.bind('refresh-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(intervalRow);

    page.add(group);
    window.add(page);
  }
}
