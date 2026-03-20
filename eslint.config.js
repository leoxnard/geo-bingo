import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import gitignore from 'eslint-config-flat-gitignore';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    gitignore(),
    {
        ignores: ['dist', '.next', 'out', 'build'], // Zusätzliche manuelle Ignores
    },
    {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react': react, // <-- Plugin registrieren
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: { version: 'detect' }, // Erkennt deine React-Version automatisch
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'indent': ['error', 4],
      'react/jsx-indent': ['error', 4],
      'react/jsx-indent-props': ['error', 4],
    },
  },
);