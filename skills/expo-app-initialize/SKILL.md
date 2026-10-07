---
name: expo-app-initialize
description: Scaffolds a new Expo React Native app with the tabs template, expo-router, react-native-mmkv, expo-dev-client, and expo-iap using Bun, then runs prebuild and writes a project claude.md. Invoke only with /expo-app-initialize.
disable-model-invocation: true
---

# Expo App Initialize

Create a production-ready Expo React Native app from the tabs template and configure it with the standard dependencies. Use Bun for every command. Never use npm, yarn, or npx; use `bunx` for one-off tools.

## Workflow

Run each step in order and wait for it to finish before the next. If a step fails, stop and report the exact error with troubleshooting steps. Never continue after a failed step.

1. Create the project: `bun create expo --template tabs`
2. Install dependencies in this order: `expo-router`, `react-native-mmkv`, `expo-dev-client`, `expo-iap`. Use `bun add` (for example `bun add expo-router react-native-mmkv expo-dev-client expo-iap`).
3. Run prebuild as the final setup step: `bun expo prebuild`
4. Create `claude.md` in the project root with the content below.

Ask the user only when they give a non-standard project name or location, when their requirements conflict with this setup, or when an error cannot be resolved automatically.

## Verification

Before reporting completion, confirm:

- The tabs template exists: `app/(tabs)` and `app/_layout.tsx`.
- `package.json` lists every required dependency.
- Prebuild finished with no errors and the `android/` and `ios/` directories exist.
- `claude.md` exists in the project root.
- No unresolved dependency conflicts remain.

## claude.md content

```markdown
# Project Commands

## Development
- `bun start` - Start the Expo development server
- `bun run ios` - Run on iOS simulator
- `bun run android` - Run on Android emulator
- `bun run web` - Run in web browser

### Build and Deployment
- `bunx expo prebuild --clean` - Clean and regenerate native code
- `eas build --platform android` - Build for Android using EAS
- `eas build --platform ios` - Build for iOS using EAS
- `eas build --platform android --auto-submit` - Build and auto-submit to Play Store
```

## Report

Follow the Response Style section of the global guidelines. Include the project directory name and each installed dependency with its purpose:

- `expo-router`: file-based routing.
- `react-native-mmkv`: high-performance key-value storage, no extra setup for basic use.
- `expo-dev-client`: custom development builds and native code.
- `expo-iap`: in-app purchases. Warn that Apple and Google store configuration is still required.

Suggest `bun expo run:ios` or `bun expo run:android` as next steps.
