const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**']
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'indent': 'off',
      'quotes': 'off',
      'semi': 'off',
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'no-dupe-class-members': 'warn',
      'no-useless-catch': 'warn',
      'no-unreachable': 'warn',
      'no-useless-assignment': 'warn',
      'no-undef': 'warn',
      'preserve-caught-error': 'off'
    }
  }
];
