import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import css from '@eslint/css';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';

export default defineConfig([
  {
    ignores: ['node_modules/', '.wxt/', '.output/', 'dist/'],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: globals.browser },
    rules: {
      curly: ['error', 'all'],
    },
  },
  tseslint.configs.recommended,
  {
    files: ['**/*.css'],
    plugins: { css },
    language: 'css/css',
    extends: ['css/recommended'],
    rules: {
      'css/no-invalid-properties': ['error', { allowUnknownVariables: true }],
      'css/use-baseline': 'off',
      'css/no-important': 'warn',
    },
  },
  eslintConfigPrettier,
]);
