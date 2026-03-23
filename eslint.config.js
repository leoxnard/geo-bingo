import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import gitignore from 'eslint-config-flat-gitignore';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import'; // 1. Plugin importieren

export default tseslint.config(
    gitignore(),
    {
        ignores: ['dist', '.next', 'out', 'build'],
    },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ['**/*.{ts,tsx}'],
        plugins: {
            'react': react,
            'react-hooks': reactHooks,
            'import': importPlugin, // 2. Plugin unter dem Namen 'import' registrieren
        },
        languageOptions: {
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        settings: {
            react: { version: 'detect' },
            'import/resolver': { // Hilft ESLint, TypeScript-Dateien zu finden
                typescript: true,
                node: true,
            },
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'indent': ['error', 4],
            'react/jsx-indent': ['error', 4],
            'react/jsx-indent-props': ['error', 4],
            
            // Deine Regel für sehr lange Zeilen
            'max-len': ['error', { 
                'code': 500,
                'ignoreUrls': true,
                'ignoreStrings': true,
                'ignoreTemplateLiterals': true,
                'ignoreRegExpLiterals': true,
                'ignoreComments': true
            }],

            // Die Import-Sortierung
            'import/order': ['error', {
                'groups': ['builtin', 'external', 'internal', ['parent', 'sibling']],
                'pathGroups': [
                    {
                        'pattern': 'react',
                        'group': 'external',
                        'position': 'before'
                    }
                ],
                'pathGroupsExcludedImportTypes': ['react'],
                'newlines-between': 'always',
                'alphabetize': {
                    'order': 'asc',
                    'caseInsensitive': true
                }
            }],
        },
    },
);