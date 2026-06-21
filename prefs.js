import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

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

        const placementRow = new Adw.ComboRow({
            title: 'Overlay Button Placement',
            subtitle: '• Bottom Row — icon-only, next to Show Pointer. No known issues.\n' +
                '• Top Row — full button with a label, next to Screen/Window/Selection. Can make ' +
                'that row stretch to full screen width after suspend or screen blank on some systems.',
            model: Gtk.StringList.new(['Bottom Row (Icon Only)', 'Top Row (With Label)']),
        });
        placementRow.selected = settings.get_boolean('show-overlay-button-in-type-row') ? 1 : 0;
        placementRow.connect('notify::selected', () => {
            settings.set_boolean('show-overlay-button-in-type-row', placementRow.selected === 1);
        });
        group.add(placementRow);
    }
}
