import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { listLanguagesSync, normalizeLanguages, resolveTesseract } from './tesseractPath.js';

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

        page.add(this._buildTesseractGroup(window, settings));
    }

    _buildTesseractGroup(window, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Tesseract',
            description: 'Leave the path empty to auto-detect tesseract on PATH, then in a ' +
                'Homebrew install (e.g. /home/linuxbrew/.linuxbrew/bin/tesseract).',
        });

        const pathRow = new Adw.EntryRow({ title: 'Custom Tesseract Path' });
        settings.bind('tesseract-path', pathRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        const browseButton = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            tooltip_text: 'Choose tesseract executable',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        browseButton.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({ title: 'Choose tesseract executable' });
            dialog.open(window, null, (_dialog, result) => {
                try {
                    const file = dialog.open_finish(result);
                    if (file)
                        settings.set_string('tesseract-path', file.get_path());
                } catch {
                    // Dismissed - nothing to do.
                }
            });
        });
        pathRow.add_suffix(browseButton);

        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: 'Clear and auto-detect',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        clearButton.connect('clicked', () => settings.set_string('tesseract-path', ''));
        pathRow.add_suffix(clearButton);
        group.add(pathRow);

        const statusRow = new Adw.ActionRow({ title: 'Tesseract in Use', subtitle_selectable: true });
        const updateStatus = () => {
            const { path, source } = resolveTesseract(settings.get_string('tesseract-path'));
            clearButton.sensitive = source === 'custom';
            if (path) {
                const label = { custom: 'custom path', path: 'found on PATH', homebrew: 'Homebrew' }[source];
                statusRow.subtitle = `${path} (${label})`;
            } else if (source === 'custom') {
                statusRow.subtitle = 'Custom path is not an executable file';
            } else {
                statusRow.subtitle = 'Not found - install tesseract or set a custom path';
            }
        };
        group.add(statusRow);

        const langRow = new Adw.EntryRow({ title: 'Languages (e.g. eng, jpn, jpn+eng)' });
        settings.bind('ocr-languages', langRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(langRow);

        const langStatusRow = new Adw.ActionRow({ title: 'Installed Languages', subtitle_selectable: true });
        let installed = null;
        const updateLangStatus = () => {
            if (!installed) {
                langStatusRow.subtitle = 'Unavailable - tesseract not found';
                return;
            }
            const wanted = normalizeLanguages(settings.get_string('ocr-languages'))
                .split('+').filter(Boolean);
            const missing = wanted.filter(lang => !installed.includes(lang));
            const summary = installed.length > 12
                ? `${installed.length} installed (${installed.filter(l => !l.includes('/')).slice(0, 12).join(', ')}, …)`
                : installed.join(', ');
            langStatusRow.subtitle = missing.length
                ? `Not installed: ${missing.join(', ')}. ${summary}`
                : summary;
        };
        settings.connect('changed::ocr-languages', updateLangStatus);
        group.add(langStatusRow);

        const refresh = () => {
            updateStatus();
            const { path } = resolveTesseract(settings.get_string('tesseract-path'));
            installed = path ? listLanguagesSync(path) : null;
            updateLangStatus();
        };
        settings.connect('changed::tesseract-path', refresh);
        refresh();

        return group;
    }
}
