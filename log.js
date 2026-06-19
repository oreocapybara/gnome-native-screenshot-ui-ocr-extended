const PREFIX = '[ocr-to-clipboard]';

export function warn(...args) {
    console.warn(PREFIX, ...args);
}

export function error(...args) {
    console.error(PREFIX, ...args);
}
