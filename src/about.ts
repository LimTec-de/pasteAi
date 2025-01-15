import { AboutService } from './services/about';
import { getUIElements } from './utils/about-ui';

async function initializeUI() {
    const elements = getUIElements();
    await AboutService.displayVersion(elements.version);
    await AboutService.handleUpdate(elements);
}

window.addEventListener("DOMContentLoaded", initializeUI);