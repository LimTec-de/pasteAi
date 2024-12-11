# Ai Clipboard Text Optimizer

A desktop application that automatically optimizes text when you perform two clipboard cuts within a 1-second interval.
Select and cut text (Ctrl+X or ⌘+X) and then cut again within 1 second. The improved text will be copied to your clipboard.

So basically you can use this app to make your text more readable by 2 times cutting and pasting.

## Download

💾 [Download the latest version for Mac, Windows and Linux](https://github.com/LimTec-de/pasteAi/releases/latest)

⚠️You need an OpenAI API key to use this app. You can get one [here](https://platform.openai.com/api-keys).
Then open pasteAi settings via Tray Menu and paste your key then restart the app.

## Features

- Automatically detects double-cut clipboard operations
- Optimizes text formatting instantly
- Runs silently in the background
- Cross-platform support

## Prerequisites

Before building the application, ensure you have the following installed:
- [Rust](https://www.rust-lang.org/tools/install)
- [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/installation)

## Building from Source

1. Clone the repository:
   ```bash
   git clone git@github.com:LimTec-de/pasteAi.git
   cd pasteAi
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the application:
   ```bash
   pnpm tauri build
   ```

   The compiled application will be available in the `src-tauri/target/release` directory.

4. ⚠️ **macOS Users**: Remove the quarantine attribute to run it:
   ```bash
   xattr -d com.apple.quarantine /Applications/pasteai.app
   ```

   This step is necessary because the app is not signed (right now) and macOS may prevent it from starting.

## Usage

1. Launch the application
2. The app will run in the background
3. To optimize text:
   - Select and cut text (Ctrl+X or ⌘+X)
   - Immediately cut again within 1 second
   - The text in your clipboard will be automatically optimized

## Development

To run the application in development mode:
```bash
pnpm tauri dev