import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
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

        page.add(this._buildShortcutGroup(window, settings));
        page.add(this._buildTesseractGroup(window, settings));
    }

    _buildShortcutGroup(window, settings) {
        const group = new Adw.PreferencesGroup({ title: 'Keyboard Shortcut' });

        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: 'Disabled',
            valign: Gtk.Align.CENTER,
        });
        const row = new Adw.ActionRow({
            title: 'Capture and Extract Text',
            subtitle: 'Click to set a new shortcut',
            activatable: true,
        });
        row.add_suffix(shortcutLabel);

        const resetButton = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: 'Reset to default (Super+Shift+O)',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        resetButton.connect('clicked', () => settings.reset('capture-ocr-shortcut'));
        row.add_suffix(resetButton);

        const update = () => {
            const [accel] = settings.get_strv('capture-ocr-shortcut');
            shortcutLabel.accelerator = accel ?? '';
            resetButton.sensitive = settings.get_user_value('capture-ocr-shortcut') !== null;
        };
        settings.connect('changed::capture-ocr-shortcut', update);
        update();

        row.connect('activated', () => this._captureShortcut(window, settings));
        group.add(row);
        return group;
    }

    // Modal "press a key combination" window, same idea as GNOME Settings'
    // keyboard shortcut editor: Escape cancels, Backspace disables.
    _captureShortcut(window, settings) {
        const dialog = new Adw.Window({
            modal: true,
            transient_for: window,
            default_width: 440,
            title: 'Set Shortcut',
        });

        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
        box.append(new Adw.HeaderBar());
        box.append(new Adw.StatusPage({
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
            title: 'Press a key combination',
            description: 'Press Escape to cancel or Backspace to disable the shortcut.',
        }));
        dialog.content = box;

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            const mods = state & Gtk.accelerator_get_default_mod_mask() & ~Gdk.ModifierType.LOCK_MASK;

            if (!mods && keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (!mods && keyval === Gdk.KEY_BackSpace) {
                settings.set_strv('capture-ocr-shortcut', []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            // Wait for a non-modifier key; a bare letter would hijack normal
            // typing, so only allow modifier-less keys that are never typed
            // (function keys, Print, media keys).
            const lower = Gdk.keyval_to_lower(keyval);
            const isSpecial = (lower >= Gdk.KEY_F1 && lower <= Gdk.KEY_F35) ||
                lower === Gdk.KEY_Print || lower >= 0x1008ff00;
            if (!Gtk.accelerator_valid(lower, mods) || (!mods && !isSpecial))
                return Gdk.EVENT_STOP;

            settings.set_strv('capture-ocr-shortcut', [Gtk.accelerator_name(lower, mods)]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present();
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
