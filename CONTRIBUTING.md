# Contributing to Waqt

First off, thanks for taking the time to contribute to Waqt! 

## Getting Started

1. Ensure you have Node.js and `yarn` installed.
2. Clone the repository and run `yarn install`.
3. To open the extension inside of VS Code development host, press `F5` in the root repository.
4. If you modify any logic flow, ensure it passes testing inside `src/test/extension.test.ts`.

## Project Structure

- `src/tracker.ts` - Core tracking algorithms and state management.
- `src/dashboard.ts` - UI components (Native HTML/CSS mapping to VS Code color tokens).
- `src/editorDetector.ts` - Editor environment detectors.
- `src/aiDetector.ts` - AI CLI and VS Code extension hooks.

## Submitting Pull Requests

1. Create a logical, specific branch name (`feature/xyz`, `bugfix/xyz`).
2. Make sure your code is formatting gracefully.
3. Update `CHANGELOG.md` with your feature details.
4. Ensure `yarn test` passes and `yarn compile` yields 0 warnings.
