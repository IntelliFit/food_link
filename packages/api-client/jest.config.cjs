/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testRegex: '[/\\\\]tests[/\\\\].*\\.test\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@food-link/core$': '<rootDir>/../core/src',
  },
}
