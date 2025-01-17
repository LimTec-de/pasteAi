# Ai Clipboard Text Optimizer

A desktop application that automatically optimizes text when you perform three clipboard copies within a 1-second interval.
Select and copy text (Ctrl+C or ⌘+C) and then copy again and again within 1 second. The improved text will be copied to your clipboard.

So basically you can use this app to make your text more readable by 3 times copying and pasting.

## Download

💾 [Download the latest version for Mac, Windows and Linux](https://github.com/LimTec-de/pasteAi/releases/latest)

⚠️ You can use some free tokens from our server. After this, you'll need to either purchase more tokens from [pasteai.app](https://pasteai.app) or provide your own OpenAI API key from [OpenAI's website](https://platform.openai.com/api-keys).
Then open pasteAI settings via Tray Menu and paste your key.

## Features

- Automatically detects triple-copy clipboard operations
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
   cd pasteAI
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
   xattr -d com.apple.quarantine /Applications/pasteAI.app
   ```

   This step is necessary because the app is not signed (right now) and macOS may prevent it from starting.

## Usage

1. Launch the application
2. The app will run in the background
3. To optimize text:
   - Select and copy text (Ctrl+C or ⌘+C)
   - Immediately copy again and again within 1 second (copy 3 times)
   - The text in your clipboard will be automatically optimized

## Development

To run the application in development mode:
```bash
pnpm tauri dev
```

## Legal Information

PasteAI is released under the GNU General Public License. For detailed legal information, please see:
- [Legal Information](LEGAL.md) - Terms of service, privacy policy, and third-party licenses
- [Imprint (Impressum)](https://www.limtec.de/#imprint) - Legal contact information
- [OpenAI Terms](https://openai.com/policies/terms-of-use) - Terms for OpenAI API usage

## Imprint (Impressum)

For legal information and contact details, please visit our [Imprint page](https://www.limtec.de/#imprint).
</rewritten_file>
```