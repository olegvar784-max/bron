const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  { files: ['src/**/*.js', 'scripts/**/*.js', 'eslint.config.js'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  { files: ['public/**/*.js'], languageOptions: { sourceType: 'script', globals: globals.browser } }
];
