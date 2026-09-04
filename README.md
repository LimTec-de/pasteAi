# Ai Clipboard Text Optimizer

A desktop application that automatically optimizes text when you perform three clipboard copies within a 1-second interval.
Select and copy text (Ctrl+C or ⌘+C) and then copy again and again within 1 second. The improved text will be copied to your clipboard.

So basically you can use this app to make your text more readable by 3 times copying and pasting.

You can also dictate: hold the shortcut (default ⌘⇧Space / Ctrl+Shift+Space), speak, release — the transcript is cleaned up and inserted. Rewrite and dictation work with OpenAI, Apple Intelligence (Mac, on-device), or a local model you download in Settings.

## Download

**v0.14.14**

[![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple_Silicon-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/LimTec-de/pasteAi/releases/download/pasteAI-v0.14.14/pasteai_0.14.14_aarch64.dmg)
[![macOS Intel](https://img.shields.io/badge/macOS-Intel-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/LimTec-de/pasteAi/releases/download/pasteAI-v0.14.14/pasteai_0.14.14_x64.dmg)
[![Windows](https://img.shields.io/badge/Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/LimTec-de/pasteAi/releases/download/pasteAI-v0.14.14/pasteai_0.14.14_x64-setup.exe)
[![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/LimTec-de/pasteAi/releases/download/pasteAI-v0.14.14/pasteai_0.14.14_amd64.AppImage)
[![Debian](https://img.shields.io/badge/Debian-A81D33?style=for-the-badge&logo=debian&logoColor=white)](https://github.com/LimTec-de/pasteAi/releases/download/pasteAI-v0.14.14/pasteai_0.14.14_amd64.deb)
[![RPM](https://img.shields.io/badge/RPM-294172?style=for-the-badge&logo=redhat&logoColor=white)](https://github.com/LimTec-de/pasteAi/releases/download/pasteAI-v0.14.14/pasteai-0.14.14-1.x86_64.rpm)

⚠️ You can use some free tokens from our server. After this, buy more at [pasteai.app](https://pasteai.app), paste your own [OpenAI API key](https://platform.openai.com/api-keys) in Settings (Tray Menu), or switch to Apple Intelligence / a local model.

## Features

- Triple-copy clipboard rewrite
- Hold-to-dictate (insert or copy)
- OpenAI, Apple Intelligence, or local models
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


## Usage

1. Launch the application
2. The app will run in the background
3. To rewrite text: select and copy three times within 1 second (Ctrl+C or ⌘+C)
4. To dictate: hold the shortcut, speak, release (or tap briefly, then Done)

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