import { getUIElements, AboutService } from './services/about';

async function initializeUI() {
    const elements = getUIElements();
    await AboutService.displayVersion(elements.version);
    await AboutService.handleUpdate(elements);
}

window.addEventListener("DOMContentLoaded", initializeUI);