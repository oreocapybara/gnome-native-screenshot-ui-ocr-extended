import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class OcrToClipboardPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({ title: 'Appearance' });
        page.add(group);

        const panelIconRow = new Adw.SwitchRow({
            title: 'Show Panel Icon',
            subtitle: 'Show the OCR icon in the top panel',
        });
        settings.bind('show-panel-icon', panelIconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(panelIconRow);

        const notifRow = new Adw.SwitchRow({
            title: 'Show Notifications',
            subtitle: 'Show a notification banner after each OCR capture',
        });
        settings.bind('show-notifications', notifRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(notifRow);
    }
}
