---
name: expo-app-initialize
description: Scaffolds a new Expo React Native app with the tabs template, expo-router, react-native-mmkv, expo-dev-client, and expo-iap at their latest compatible versions using Bun, then runs prebuild and writes the project CLAUDE.md commands. Invoke only with /expo-app-initialize <project-name>.
disable-model-invocation: true
argument-hint: <project-name>
---

# Expo App Initialize

Create a production-ready Expo React Native app from the tabs template and configure it with the standard dependencies. Use Bun for every command. Never use npm, yarn, or npx; use `bunx` for one-off tools.

Project name: `$ARGUMENTS`. If that value is empty or starts with a dollar sign (Codex does not replace the placeholder), take the name from the invocation message. If no name was passed, ask the user for a project name before running anything.

## Versions

Use the latest version of every package that is compatible with the project. Never copy a version number from memory or from this skill.

- Create the project with `create-expo@latest`, so the app starts on the newest stable Expo SDK.
- Before any install, read the project's Expo SDK and React Native versions from `package.json`. For each package that Expo does not track (`react-native-mmkv`, `react-native-nitro-modules`, `expo-iap`), check the latest published version, its required peer dependencies, and its documented minimum Expo SDK and React Native versions. Choose the newest version that supports the project's React Native version and architecture, and record it with every required peer dependency. If the chosen version is older than the latest, tell the user why.
- Install every package with `bunx expo install <package>`. It selects the version that matches the project's Expo SDK for packages Expo tracks, and the latest version for others. Install the versions and peer dependencies that the check chose in the same command.
- After installation, run `bunx expo install --check` and `bunx expo-doctor`. Fix every version mismatch they report before prebuild.

## Workflow

Run each step in order and wait for it to finish before the next. If a step fails, stop and report the exact error with troubleshooting steps. Never continue after a failed step.

1. Create the project: `bunx create-expo@latest <project-name> --template tabs --yes`, then work inside the new directory.
2. Confirm `expo-router` is already in `package.json`. The tabs template includes it. Install it with `bunx expo install expo-router` only if it is missing.
3. Check the packages that Expo does not track, as the Versions section describes. Record the chosen version and the required peer dependencies of each package.
4. Install the dependencies: `bunx expo install react-native-mmkv react-native-nitro-modules expo-dev-client expo-iap`, plus every required peer dependency that step 3 found. Write a package as `<package>@<version>` when step 3 chose a version older than the latest.
5. Run `bunx expo install --check` and `bunx expo-doctor`, and fix every version mismatch they report.
6. Run prebuild as the final setup step: `bunx expo prebuild`. If the user asked for one platform only, run `bunx expo prebuild --platform <android|ios>`. On Windows, prebuild skips iOS with a warning; this is expected, so report it and continue.
7. Write the commands section into `CLAUDE.md` in the project root. Never overwrite or remove template content, and never add a second `# Project Commands` section.
   - `CLAUDE.md` exists, as a file or as a symlink to `AGENTS.md`: append the commands section to it once.
   - `CLAUDE.md` is missing and `AGENTS.md` exists: create `CLAUDE.md` with `@AGENTS.md` as its first line, then the commands section. Do not change `AGENTS.md`.
   - Neither file exists: create `CLAUDE.md` with the commands section.

Ask the user only when they give a non-standard project location, when their requirements conflict with this setup, or when an error cannot be resolved automatically.

## Verification

Before reporting completion, confirm:

- The tabs template exists: `app/(tabs)` and `app/_layout.tsx`.
- `package.json` lists every required dependency and peer dependency.
- `bunx expo install --check` and `bunx expo-doctor` report no problems.
- Prebuild finished with no errors, and the native directory of each platform that prebuild generated exists: `android/` and `ios/` by default, only `android/` on Windows, or only the platform the user asked for.
- `CLAUDE.md` contains the commands section exactly once, and `AGENTS.md`, if the template created it, keeps all of its template content.

## Commands section

Read the `scripts` in `package.json` after prebuild, and write the `bun run` lines to match the scripts that exist.

```markdown
# Project Commands

## Development
- `bun start` - Start the Expo development server
- `bun run ios` - Run on iOS simulator
- `bun run android` - Run on Android emulator
- `bun run web` - Run in web browser

### Build and Deployment
- `bunx expo prebuild --clean` - Clean and regenerate native code
- `bunx eas-cli build --platform android` - Build for Android using EAS
- `bunx eas-cli build --platform ios` - Build for iOS using EAS
- `bunx eas-cli build --platform android --auto-submit` - Build and auto-submit to Play Store
```

## Report

Follow the Response Style section of the global guidelines. Include the project directory name, the Expo SDK version, and each installed package with its version and purpose:

- `expo-router`: file-based routing.
- `react-native-mmkv`: high-performance key-value storage.
- `react-native-nitro-modules`: native module runtime that `react-native-mmkv` requires.
- `expo-dev-client`: custom development builds and native code.
- `expo-iap`: in-app purchases. Warn that Apple and Google store configuration is still required.

State any package that is not on its latest version, and why. Suggest `bunx expo run:ios` or `bunx expo run:android` as next steps.
