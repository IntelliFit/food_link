/** @type {import('jest').Config} */
module.exports = {
  /** 单条用例最大执行时间（毫秒），超时则失败，避免挂死 */
  testTimeout: 120000,
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.jest.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Resolve workspace source inside the same staged snapshot, including copied Windows checkouts.
    '^@food-link/core$': '<rootDir>/../../packages/core/src/index.ts',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(png|jpe?g|gif|webp|svg|mp3|wav)$': '<rootDir>/tests/__mocks__/fileMock.js',
  },
}
