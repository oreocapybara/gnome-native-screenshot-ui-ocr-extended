import GLib from 'gi://GLib';

// Only imports GLib, so this module is safe to load from both the shell
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
