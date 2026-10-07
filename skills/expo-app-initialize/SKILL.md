---
name: expo-app-initialize
description: Scaffolds a new Expo React Native app with the tabs template, expo-router, react-native-mmkv, expo-dev-client, and expo-iap at their latest compatible versions using Bun, then runs prebuild and writes the project CLAUDE.md commands. Invoke only with /expo-app-initialize <project-name>.
disable-model-invocation: true
argument-hint: <project-name>
---

# Expo App Initialize

Create a production-ready Expo React Native app from the tabs template and configure it with the standard dependencies. Use Bun for every command. Never use npm, yarn, or npx; use `bunx` for one-off tools.

Project name: `$ARGUMENTS`. If it is empty, ask the user for a project name before running anything.

## Versions

Use the latest version of every package that is compatible with the project. Never copy a version number from memory or from this skill.

- Create the project with `create-expo@latest`, so the app starts on the newest stable Expo SDK.
- Install every package with `bunx expo install <package>`. It selects the version that matches the project's Expo SDK for packages Expo tracks, and the latest version for others.
- For each package that Expo does not track (`react-native-mmkv`, `react-native-nitro-modules`, `expo-iap`), check the latest published version, its required peer dependencies, and its documented minimum Expo SDK and React Native versions. Install every required peer dependency. If the latest version does not support the project's React Native version or architecture, use the newest version that does and tell the user why.
- After installation, run `bunx expo install --check` and `bunx expo-doctor`. Fix every version mismatch they report before prebuild.

## Workflow

Run each step in order and wait for it to finish before the next. If a step fails, stop and report the exact error with troubleshooting steps. Never continue after a failed step.

1. Create the project: `bunx create-expo@latest <project-name> --template tabs --yes`, then work inside the new directory.
2. Confirm `expo-router` is already in `package.json`. The tabs template includes it. Install it with `bunx expo install expo-router` only if it is missing.
3. Install the dependencies: `bunx expo install react-native-mmkv react-native-nitro-modules expo-dev-client expo-iap`, plus any other peer dependency that the version checks found.
4. Run the version checks from the Versions section.
5. Run prebuild as the final setup step: `bunx expo prebuild`.
6. Write the project commands to `CLAUDE.md` in the project root. If the template already created `CLAUDE.md` or `AGENTS.md`, keep its content and append the commands section. Never overwrite it.

Ask the user only when they give a non-standard project location, when their requirements conflict with this setup, or when an error cannot be resolved automatically.

## Verification

Before reporting completion, confirm:

- The tabs template exists: `app/(tabs)` and `app/_layout.tsx`.
- `package.json` lists every required dependency and peer dependency.
- `bunx expo install --check` and `bunx expo-doctor` report no problems.
- Prebuild finished with no errors and the `android/` and `ios/` directories exist.
- `CLAUDE.md` contains the commands section.

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
