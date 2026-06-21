import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { captureAndOcr } from './ocrProcessor.js';
import * as log from './log.js';

const OcrIndicator = GObject.registerClass(
class OcrIndicator extends PanelMenu.Button {
    _init(gicon, onActivate) {
        // dontCreateMenu = true: this is a click target, not a menu. That
        // also disables PanelMenu.Button's own internal ClickGesture, so we
        // attach our own rather than relying on the legacy button-press-event
        // signal (which modern GNOME Shell's gesture-based input no longer
        // reliably delivers to non-menu panel buttons).
        super._init(0.0, 'Native Screenshot UI OCR Extended', true);

        this.add_child(new St.Icon({
            gicon,
            style_class: 'system-status-icon',
        }));

        const clickGesture = new Clutter.ClickGesture();
        clickGesture.set_recognize_on_press(true);
        clickGesture.connect('recognize', () => {
            onActivate();
            return Clutter.EVENT_STOP;
        });
        this.add_action(clickGesture);
    }
});

export default class OcrToClipboardExtension extends Extension {
    enable() {
        this._icon = Gio.icon_new_for_string(
            GLib.build_filenamev([this.path, 'icons', 'extract-text-symbolic.svg'])
        );
        this._panelIcon = Gio.icon_new_for_string(
            GLib.build_filenamev([this.path, 'icons', 'extract-text-panel-symbolic.svg'])
        );
        this._overlayIcon = Gio.icon_new_for_string(
            GLib.build_filenamev([this.path, 'icons', 'extract-text-overlay-symbolic.svg'])
        );

        this._settings = this.getSettings();

        this._updatePanelIcon();
        this._panelIconChangedId = this._settings.connect(
            'changed::show-panel-icon', () => this._updatePanelIcon());
        this._overlayPlacementChangedId = this._settings.connect(
            'changed::show-overlay-button-in-type-row', () => this._rebuildScreenshotUiButton());

        Main.wm.addKeybinding(
            'capture-ocr-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => this._runCapture()
        );

        try {
            this._patchScreenshotUI();
        } catch (e) {
            log.warn('failed to add button to screenshot UI', e);
        }
    }

    disable() {
        Main.wm.removeKeybinding('capture-ocr-shortcut');
        this._settings.disconnect(this._panelIconChangedId);
        this._panelIconChangedId = null;
        this._settings.disconnect(this._overlayPlacementChangedId);
        this._overlayPlacementChangedId = null;
        this._settings = null;

        if (this._idleSourceId) {
            GLib.source_remove(this._idleSourceId);
            this._idleSourceId = null;
        }

        this._indicator?.destroy();
        this._indicator = null;

        if (this._notifSource) {
            this._notifSource.disconnect(this._notifSourceDestroyId);
            this._notifSourceDestroyId = null;
            this._notifSource.destroy();
        }
        this._notifSource = null;

        this._teardownScreenshotUI();

        this._icon = null;
        this._panelIcon = null;
        this._overlayIcon = null;
    }

    _teardownScreenshotUI() {
        try {
            if (this._screenshotUiButton) {
                this._screenshotUiButton.disconnect(this._screenshotUiButtonClickedId);
                this._screenshotUiButtonClickedId = null;
                this._screenshotUiButton.get_parent()?.remove_child(this._screenshotUiButton);
                this._screenshotUiButton.destroy();
            }
            if (this._screenshotUiDivider) {
                this._screenshotUiDivider.get_parent()?.remove_child(this._screenshotUiDivider);
                this._screenshotUiDivider.destroy();
            }
        } catch (e) {
            log.warn('failed to remove button from screenshot UI', e);
        }
        this._screenshotUiButton = null;
        this._screenshotUiDivider = null;
    }

    _rebuildScreenshotUiButton() {
        this._teardownScreenshotUI();
        try {
            this._patchScreenshotUI();
        } catch (e) {
            log.warn('failed to add button to screenshot UI', e);
        }
    }

    _updatePanelIcon() {
        const shouldShow = this._settings.get_boolean('show-panel-icon');
        if (shouldShow && !this._indicator) {
            this._indicator = new OcrIndicator(this._panelIcon, () => this._runCapture());
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } else if (!shouldShow && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    // GNOME's native PrtSc overlay (Main.screenshotUI) has no extension API,
    // so this adds a button directly to private overlay internals. Default
    // placement is _showPointerButtonContainer (next to "show pointer"), a
    // plain non-homogeneous box. The alternate, opt-in placement is
    // _typeButtonContainer (next to Screen/Window/Selection) - adding a 4th
    // child to THAT homogeneous row reliably triggers a native Shell layout
    // bug after suspend/screen-off (confirmed: container and ALL of its
    // children get allocated a stretched width identical to each other,
    // content-independent, only when there are 4 children instead of 3).
    // show-overlay-button-in-type-row controls which one is used; see the
    // gschema description for the suspend-stretch caveat. Private API - if
    // the relevant container is missing on a future Shell version, skip
    // gracefully rather than breaking the rest of the extension.
    _patchScreenshotUI() {
        const ui = Main.screenshotUI;
        const useTypeRow = this._settings.get_boolean('show-overlay-button-in-type-row');

        if (useTypeRow) {
            if (!ui?._typeButtonContainer) {
                log.warn('Main.screenshotUI._typeButtonContainer not found; skipping PrtSc integration');
                return;
            }

            // icon-label-button-container is the same style class the native
            // Selection/Screen/Window buttons use - their icon's size/stroke
            // weight comes from CSS keyed off this class, not icon properties.
            const box = new St.BoxLayout({
                vertical: true,
                style_class: 'icon-label-button-container',
            });
            box.add_child(new St.Icon({ gicon: this._icon }));
            box.add_child(new St.Label({ text: 'Extract Text' }));

            this._screenshotUiButton = new St.Button({
                style_class: 'screenshot-ui-type-button',
                toggle_mode: true,
                x_expand: true,
                child: box,
            });
            ui._typeButtonContainer.add_child(this._screenshotUiButton);
        } else {
            if (!ui?._showPointerButtonContainer) {
                log.warn('Main.screenshotUI._showPointerButtonContainer not found; skipping PrtSc integration');
                return;
            }

            // A thin divider visually separates our toggle from the native
            // show-pointer button - same row, but reads as its own distinct
            // action rather than a tacked-on extra option.
            this._screenshotUiDivider = new St.Widget({
                style: 'background-color: rgba(255, 255, 255, 0.18); width: 1px; height: 16px;',
                y_align: Clutter.ActorAlign.CENTER,
            });
            ui._showPointerButtonContainer.add_child(this._screenshotUiDivider);

            // Reuse the show-pointer button's own style class so ours matches
            // its icon-only, no-label look instead of the bigger type-button style.
            this._screenshotUiButton = new St.Button({
                style_class: 'screenshot-ui-show-pointer-button',
                toggle_mode: true,
                child: new St.Icon({ gicon: this._overlayIcon }),
            });
            ui._showPointerButtonContainer.add_child(this._screenshotUiButton);
        }

        this._screenshotUiButtonClickedId = this._screenshotUiButton.connect('clicked', () => {
            // toggle_mode flips .checked before 'clicked' fires, so this
            // tells us whether the user just turned OCR mode on or off.
            const enteringOcrMode = this._screenshotUiButton.checked;

            // Wait for 'closed' before reopening - close() doesn't reset the
            // UI's internal state synchronously, so calling open() right away
            // gets ignored (the UI thinks it's still open/closing). Defer
            // with idle_add too, since we're still on the same call stack as
            // _finishClosing() while the 'closed' handler runs.
            const closedId = ui.connect('closed', () => {
                ui.disconnect(closedId);
                this._idleSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._idleSourceId = null;
                    if (enteringOcrMode) {
                        this._runCapture();
                    } else {
                        // Turning OCR mode off mid-session: just reopen a
                        // plain, unrestricted screenshot session instead of
                        // starting another OCR capture.
                        ui.open();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            });
            ui.close();
        });
    }

    async _runCapture() {
        // checked stays true for the whole capture, as a visible "OCR mode
        // is active" indicator on the overlay button - regardless of
        // whether this capture was triggered from that button, the panel
        // icon, or the keyboard shortcut.
        if (this._screenshotUiButton)
            this._screenshotUiButton.checked = true;

        try {
            const text = await captureAndOcr();
            if (!text) {
                this._notify('No text found', 'The selected area did not contain recognizable text.');
                return;
            }

            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
            this._notify('OCR Complete', text.slice(0, 100));
        } catch (err) {
            if (err.code === 'CANCELLED')
                return; // silent abort, expected UX

            if (err.code === 'TESSERACT_NOT_FOUND') {
                this._notify('Tesseract not installed', 'Install tesseract to use this extension.');
                return;
            }

            this._notify('OCR Failed', err.message);
            log.error(err);
        } finally {
            if (this._screenshotUiButton)
                this._screenshotUiButton.checked = false;
        }
    }

    _notify(title, body) {
        if (!this._settings.get_boolean('show-notifications'))
            return;

        if (!this._notifSource) {
            this._notifSource = new MessageTray.Source({
                title: 'Native Screenshot UI OCR Extended',
                icon: this._icon,
            });
            this._notifSourceDestroyId = this._notifSource.connect('destroy', () => {
                this._notifSource = null;
            });
            Main.messageTray.add(this._notifSource);
        }

        const notification = new MessageTray.Notification({
            source: this._notifSource,
            title,
            body,
            'is-transient': true,
        });
        this._notifSource.addNotification(notification);
    }
}
