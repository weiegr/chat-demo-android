# chat-demo-android

English | [简体中文](README.zh-CN.md)

An **Android WebView app and static chat client (`API demo`)** built on top of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo). No application backend is required: the embedded web app connects directly to the configured DeepSeek API service.

- **App Name**: `API demo`
- **Current Version**: `2.1.1`
- **Android Package Name**: `xyz.app566512.apidemo`
- **Minimum / Target SDK**: Android 8.0+ (`minSdkVersion 26`, `targetSdkVersion 34`)
- **Signing**: Gradle-free build using `~/.android/debug.keystore`, outputting `dist-apk/chat-demo.apk`

Enter your DeepSeek API key in **Settings → Data** before starting your first chat.

## Building the Android APK

Prerequisites:

- **Node.js 22.12+** and **pnpm**
- **JDK 11+** (providing `javac`, `jar`, and `keytool`; set `JAVA_HOME` if not in `PATH`)
- **Android SDK** (with `platforms` and `build-tools` installed, and `ANDROID_HOME` or `ANDROID_SDK_ROOT` set)

In your terminal:

```sh
pnpm install
pnpm build:apk
```

[scripts/build-apk.mjs](scripts/build-apk.mjs) builds without Gradle by directly invoking `aapt2`, `javac`, `d8`, `jar`, `zipalign`, and `apksigner`, packaging `dist/` into `assets/web/` and producing the signed `dist-apk/chat-demo.apk`.

## Web Development & Builds

All original web development, static build, and single-file build workflows remain supported:

```sh
# Start the dev server (http://localhost:8090)
pnpm dev

# Build the static site into dist/
pnpm build

# Build a self-contained single HTML file into dist-single/index.html
pnpm build:single
```

## Features & Android Enhancements

### Core Capabilities

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Three welcome modes: Fast mode (Flash), Expert mode (Pro with automatic DeepSeek OCR for images and pre-send bypass search), and RP mode (long-context mode beyond the 32K single-message limit, with local plain-text attachment inlining and configurable Flash/Pro model in RP mode settings).
- Streaming replies, deep thinking, smart search (expert mode uses bypass search and shares the same source citations), link reading, and source citations; stop generation or continue eligible replies.
- Attachment uploads (local inlining for plain-text files, automatic OCR for images on Pro, plus documents and code), voice input (ASR), and read-aloud playback (TTS, with optional auto read-aloud when a reply finishes) with a live audio spectrum while recording on mobile.
- Fast mode accepts one video of up to 60 seconds per message after **Allow video uploads** is enabled in chat settings. Each video sends 16 evenly sampled frames arranged into four 2×2 images. Original videos play in the app, and Android can transcribe their dialogue when you send them.
- Start a **DeepSeek Live** voice call from the Fast mode attachment menu. Calls can continue an existing text conversation, support interruptions, and save the transcript to a separate chat.
- Editable system prompts per mode (Fast, Expert, and RP), each with one-tap restore to defaults.
- Markdown, Prism syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, location settings, and ZIP chat history import/export.

### Android & Mobile Enhancements

- **Virtual HTTPS Origin**: WebView intercepts `https://appassets.androidplatform.net/` and serves `assets/web/`, ensuring `localStorage` and IndexedDB persist reliably under a standard HTTPS origin.
- **Native Integration**: Edge-to-Edge status/navigation bar safe-area insets (`--safe-top` / `--safe-bottom`), OS dark/light theme synchronization, and Back button handling to dismiss open drawers, menus, or modals first.
- **Media & Permissions**: Mobile `+` attachment panel integrates native camera capture, system photo picker, generic file chooser, and a quick-select strip of the 10 most recent photos once gallery permission is granted; microphone permission is requested dynamically for voice input.
- **Downloads Support**: Intercepts `blob:` exports and saves chat history ZIP archives directly to the device's `Download/` folder.
- **Mobile UI Refinements**: Swipe gestures for the sidebar drawer; long-press context menu on chat list items (hover menu preserved on desktop); inline bottom-composer editing of user messages and attachments; in-app image preview modal; and card-based Settings sub-pages (General / Data / Location / System Prompt) with masked API key view, edit, and clear.
- **Keyboard Integration**: The WebView shrinks frame by frame with the IME animation so the composer, attachment panel, and keyboard stay in sync; sheets, drawers, and modals no longer steal focus, keeping the keyboard from competing with their enter animations.

## Data Storage & Backup

- On Android, the app encrypts your API key with Android Keystore and stores the ciphertext in a private directory excluded from system backups. The web app encrypts it with Web Crypto and stores the result in IndexedDB. Where encrypted storage is unavailable, the API key lasts for the current page session.
- The app stores preferences in `localStorage` and conversations, message branches, and original attachments in IndexedDB. Android backup and device transfer exclude WebView `localStorage` because its files may retain data from older versions. Sending messages, uploading files, or using speech features submits the relevant data to the configured API service.
- **Uninstall & Upgrade Notes**:
  - **Uninstalling the app** deletes the app's private sandbox directory, removing all local chats and your saved API key.
  - **Overwriting / upgrading** in place with the same package name and signing keystore preserves existing conversations and settings.
  - Before uninstalling or switching devices, use **Settings → Data → Export all chats** to save a ZIP backup to your `Download/` folder. Exports include conversations and locally stored original images and videos. See the [history import/export docs (Chinese)](src/services/chat/history/README.md) for the archive format.
- **Clear all chats**: **Settings → Data → Delete all chats** clears all local conversations, original attachments, and unsent drafts after confirmation while keeping your API key, settings, and previously uploaded server files intact.

## Development & Structure

| Command             | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `pnpm dev`          | Start the development server                           |
| `pnpm build`        | Build static assets into `dist/`                       |
| `pnpm build:single` | Build a single self-contained HTML into `dist-single/` |
| `pnpm build:apk`    | Build and sign Android APK into `dist-apk/`            |
| `pnpm type`         | Run TypeScript type checks                             |
| `pnpm lint`         | Lint with oxlint                                       |
| `pnpm format`       | Format with oxfmt                                      |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default and supports `createConfig({ apiOrigin, devServer, singleFile })`. Chat defaults to `deepseek-flash` over Anthropic-compatible Messages / Files APIs, with ASR / TTS speech endpoints.

```text
android/               AndroidManifest.xml, MainActivity.java, and app icon/theme resources
scripts/
  build-apk.mjs        Gradle-free Android APK build and signing script
  inline-dist.mjs      Single-file HTML inlining script
src/
  app/                 App layout, theme sync, viewport adaptation, and global styles
  components/          Chat input, messages, search citations, Markdown, settings, and sidebar
  i18n/                Chinese and English translations
  services/
    api/               API client, SSE parser, and protocol types
    chat/              Sessions, branch tree, IndexedDB/memory storage, and ZIP backup
    markdown/          Markdown AST parsing, Prism highlighting, KaTeX, and Mermaid
    speech/            Audio recording and streaming PCM read-aloud
  utils/               Shared utilities
```

## License

[MIT](LICENSE), derived from [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo). The build copies `LICENSE` to `dist/LICENSE`; include it when redistributing. Third-party dependencies remain under their own licenses.
