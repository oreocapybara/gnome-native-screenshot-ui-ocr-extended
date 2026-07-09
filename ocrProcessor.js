import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as log from './log.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

function ocrError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

function _setSensitive(widget, sensitive) {
    widget.reactive = sensitive;
    widget.can_focus = sensitive;
    if (sensitive)
        widget.remove_style_pseudo_class('insensitive');
    else
        widget.add_style_pseudo_class('insensitive');
}

// Keep the native overlay's normal layout intact, but make Screen/Window
// capture, switching to screencast, and the cursor-visibility toggle
// unusable while an OCR capture is in progress - Selection-only, no
// recording, cursor forced off (OCR never wants the pointer baked in).
function _restrictUiForOcr(ui) {
    const disabledButtons = [ui._screenButton, ui._windowButton, ui._castButton];
    disabledButtons.forEach(button => _setSensitive(button, false));

    const cursorWasChecked = ui._showPointerButton.checked;
    ui._showPointerButton.checked = false;
    _setSensitive(ui._showPointerButton, false);

    return () => {
        disabledButtons.forEach(button => _setSensitive(button, true));
        _setSensitive(ui._showPointerButton, true);
        ui._showPointerButton.checked = cursorWasChecked;
    };
}

// ScreenshotUI's own _saveScreenshot() permanently saves to
// ~/Pictures/Screenshots, overwrites the clipboard with the image, and plays
// the shutter sound - none of which we want for an OCR capture. It's an
// instance method, so we can swap it out for the duration of one capture:
// same pixel-compositing logic, but writing to a throwaway /tmp file (which
// our own cleanup deletes after OCR) and skipping the sound/clipboard/save.
function _patchSaveScreenshot(ui) {
    const original = ui._saveScreenshot;

    ui._saveScreenshot = async function () {
        const content = this._stageScreenshot.get_content();
        if (!content)
            return;

        const texture = content.get_texture();
        const [x, y, w, h] = this._getSelectedGeometry(true);
        let cursorTexture = this._cursor.content?.get_texture();
        if (!this._cursor.visible)
            cursorTexture = null;

        const stream = Gio.MemoryOutputStream.new_resizable();
        await Shell.Screenshot.composite_to_stream(
            texture, x, y, w, h, this._scale,
            cursorTexture ?? null, this._cursor.x * this._scale,
            this._cursor.y * this._scale, this._cursorScale, stream
        );
        stream.close(null);

        const tmpPath = GLib.build_filenamev([
            GLib.get_tmp_dir(),
            `ocr-to-clipboard-${GLib.uuid_string_random()}.png`,
        ]);
        const file = Gio.File.new_for_path(tmpPath);
        file.replace_contents(
            stream.steal_as_bytes().get_data(), null, false, Gio.FileCreateFlags.NONE, null
        );

        this.emit('screenshot-taken', file);
    };

    return () => {
        ui._saveScreenshot = original;
    };
}

// org.gnome.Shell.Screenshot's SelectArea/ScreenshotArea D-Bus methods are
// gated by a sender allow-list (only SettingsDaemon.MediaKeys and the
// screenshot portal backend) with no exemption for extensions, so calling
// them ourselves always returns AccessDenied. Main.screenshotUI captures
// pixels via the Shell.Screenshot GObject directly, in-process, bypassing
// that D-Bus gate entirely - so we drive that UI instead of the D-Bus API.
function _captureViaNativeUI() {
    return new Promise((resolve, reject) => {
        const ui = Main.screenshotUI;
        let gotFile = false;
        let restoreButtons = () => {};
        const restoreSave = _patchSaveScreenshot(ui);

        const tracker = {};
        ui.connectObject(
            'screenshot-taken', (_ui, file) => {
                gotFile = true;
                cleanup();
                resolve(file.get_path());
            },
            'closed', () => {
                cleanup();
                if (!gotFile)
                    reject(ocrError('CANCELLED', 'Screenshot was cancelled'));
            },
            tracker);

        function cleanup() {
            ui.disconnectObject(tracker);
            restoreButtons();
            restoreSave();
        }

        // Apply restrictions after open() resolves, not before - open() sets
        // up the chosen mode's button states itself, which would otherwise
        // clobber our disabling if we did it first.
        ui.open().then(() => {
            restoreButtons = _restrictUiForOcr(ui);
        });
    });
}

// Tesseract emits a single '\n' for line-wraps within a paragraph and '\n\n'
// for actual paragraph breaks. Copying that raw would paste wrapped
// sentences as broken-looking separate lines, so single newlines are
// rejoined into flowing text while real paragraph breaks are kept.
function _reflowText(text) {
    return text
        .split(/\n{2,}/)
        .map(paragraph => paragraph.replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim())
        .filter(paragraph => paragraph.length > 0)
        .join('\n\n');
}

async function _runTesseract(filePath) {
    let proc;
    try {
        proc = Gio.Subprocess.new(
            ['tesseract', filePath, 'stdout'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
    } catch {
        throw ocrError('TESSERACT_NOT_FOUND', 'tesseract is not installed');
    }

    const [stdout, stderr] = await proc.communicate_utf8_async(null, null);

    if (!proc.get_successful())
        throw ocrError('TESSERACT_FAILED', stderr.trim() || 'tesseract exited with an error');

    return _reflowText(stdout);
}

function _cleanupFile(filePath) {
    try {
        Gio.File.new_for_path(filePath).delete(null);
    } catch (e) {
        log.warn('failed to clean up', filePath, e);
    }
}

/**
 * Runs the capture pipeline via the native screenshot UI, then OCRs the
 * resulting screenshot.
 * @returns {Promise<string>} trimmed OCR text (may be '' if no text found)
 * @throws {Error} tagged with .code: 'CANCELLED' | 'TESSERACT_NOT_FOUND' | 'TESSERACT_FAILED'
 */
export async function captureAndOcr() {
    const filePath = await _captureViaNativeUI();

    try {
        return await _runTesseract(filePath);
    } finally {
        _cleanupFile(filePath);
    }
}
