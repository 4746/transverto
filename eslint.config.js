import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier/flat'

export default [
  {
    ignores: ['dist/**'],
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  ...oclif,
  prettier,
  {
    files: ['src/**/*.ts'],
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      '@stylistic/lines-between-class-members': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'arrow-body-style': 'off',
      'guard-for-in': 'off',
      'jsdoc/check-tag-names': 'off',
      'jsdoc/check-types': 'off',
      'no-await-in-loop': 'off',
      'no-else-return': 'off',
      'object-shorthand': 'off',
      'perfectionist/sort-interfaces': 'off',
      'perfectionist/sort-objects': 'off',
      'perfectionist/sort-union-types': 'off',
      'unicorn/catch-error-name': [
        'error',
        {
          ignore: [String.raw`^error\d*$`, String.raw`^reason\d*$`],
        },
      ],
      'unicorn/no-abusive-eslint-disable': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/numeric-separators-style': 'off',
      'unicorn/prefer-string-raw': 'off',
      'unicorn/prefer-structured-clone': 'off',
      'unicorn/switch-case-braces': 'off',
    },
  },
]
