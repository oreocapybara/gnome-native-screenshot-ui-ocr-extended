import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Only imports Gio/GLib, so this module is safe to load from both the shell
// process (ocrProcessor.js) and the separate prefs process (prefs.js).

// GNOME Shell's PATH comes from the session, not a login shell, so a
// Homebrew install (common on immutable distros like Bazzite/Silverblue,
// where layering tesseract with rpm-ostree is undesirable) is usually not
// on it. These are Homebrew's standard prefixes, checked in order after
// PATH.
function _homebrewCandidates() {
    const prefixes = [
        GLib.getenv('HOMEBREW_PREFIX'),
        '/home/linuxbrew/.linuxbrew',
        GLib.build_filenamev([GLib.get_home_dir(), '.linuxbrew']),
        '/opt/homebrew',
        '/usr/local',
    ].filter(Boolean);

    return [...new Set(prefixes)].map(prefix => GLib.build_filenamev([prefix, 'bin', 'tesseract']));
}

function _isExecutableFile(path) {
    return GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE) &&
        !GLib.file_test(path, GLib.FileTest.IS_DIR);
}

/**
 * Expands a leading '~' so users can type paths the way they would in a
 * terminal.
 * @param {string} path
 * @returns {string}
 */
export function expandHome(path) {
    if (path === '~')
        return GLib.get_home_dir();
    if (path.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
    return path;
}

/**
 * Works out which tesseract binary to run.
 *
 * A non-empty customPath always wins and is never silently replaced by
 * auto-detection - if it's wrong, the caller should tell the user rather
 * than quietly run a different binary than the one they configured.
 * @param {string} customPath the 'tesseract-path' setting ('' = auto)
 * @returns {{path: string|null, source: 'custom'|'path'|'homebrew'|null}}
 *   path is null if nothing usable was found
 */
export function resolveTesseract(customPath = '') {
    const custom = customPath.trim();
    if (custom) {
        const expanded = expandHome(custom);
        return { path: _isExecutableFile(expanded) ? expanded : null, source: 'custom' };
    }

    const onPath = GLib.find_program_in_path('tesseract');
    if (onPath)
        return { path: onPath, source: 'path' };

    const brew = _homebrewCandidates().find(_isExecutableFile);
    if (brew)
        return { path: brew, source: 'homebrew' };

    return { path: null, source: null };
}

/**
 * Normalises the 'ocr-languages' setting into tesseract's '-l' syntax,
 * accepting '+', ',' or whitespace as separators (e.g. 'jpn, eng').
 * @param {string} languages
 * @returns {string} e.g. 'jpn+eng', or '' for tesseract's default
 */
export function normalizeLanguages(languages) {
    return languages.split(/[\s,+]+/).filter(Boolean).join('+');
}

/**
 * Lists the language packs a tesseract binary has installed. Synchronous,
 * so only for prefs - the shell process must never block on a subprocess.
 * @param {string} tesseractPath
 * @returns {string[]|null} null if tesseract couldn't be run
 */
export function listLanguagesSync(tesseractPath) {
    try {
        const proc = Gio.Subprocess.new(
            [tesseractPath, '--list-langs'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
        );
        const [, stdout] = proc.communicate_utf8(null, null);
        if (!proc.get_successful())
            return null;
        // First line is the 'List of available languages in "...":' header.
        return stdout.split('\n').slice(1).map(l => l.trim()).filter(Boolean);
    } catch {
        return null;
    }
}
