import { getVersion } from '@tauri-apps/api/app';

async function initializeUI() {
    const versionElement = document.getElementById('version');
    if (!versionElement) return;

    const version = await getVersion();
    versionElement.textContent = `Version: ${version}`;
}

window.addEventListener("DOMContentLoaded", initializeUI);