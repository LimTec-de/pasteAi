# Clipboard Text Optimizer

A desktop application that automatically optimizes text when you perform two clipboard cuts within a 1-second interval.

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
   git clone [your-repository-url]
   cd [repository-name]
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

4. **macOS Users**: If the app is not signed, you may need to remove the quarantine attribute to run it:
   ```bash
   xattr -d com.apple.quarantine /Applications/pasteai.app
   ```

   This step is necessary because the app is not signed and macOS may prevent it from starting.

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