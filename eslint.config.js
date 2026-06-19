import js from '@eslint/js';

export default [
    { ignores: ['node_modules/', 'schemas/gschemas.compiled'] },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                // GJS runtime globals - not Node/browser, so the standard
                // env presets don't apply.
                global: 'readonly',
                globalThis: 'readonly',
                log: 'readonly',
                logError: 'readonly',
                print: 'readonly',
                printerr: 'readonly',
                ARGV: 'readonly',
                console: 'readonly',
            },
        },
        rules: {
            // Signal callbacks conventionally name unused leading args with
            // an underscore (e.g. (_ui, file) => ...).
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        },
    },
];
