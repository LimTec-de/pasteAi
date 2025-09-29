import { Window, PhysicalPosition } from '@tauri-apps/api/window';

function initializeWindowMovement(): void {
    const windowHeader = document.querySelector('.window-header') as HTMLElement;
    if (!windowHeader) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;

    windowHeader.addEventListener('mousedown', async (e) => {
        isDragging = true;
        const position = await Window.getCurrent().outerPosition();
        startX = e.clientX - position.x;
        startY = e.clientY - position.y;
    });

    window.addEventListener('mousemove', async (e) => {
        if (!isDragging) return;

        await Window.getCurrent().setPosition(new PhysicalPosition(e.clientX - startX, e.clientY - startY));
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Handle close button
    const closeButton = document.getElementById('closeButton');
    if (closeButton) {
        closeButton.addEventListener('click', async () => {
            await Window.getCurrent().close();
        });
    }
}

window.addEventListener("DOMContentLoaded", () => {
    console.log('About window DOM loaded, initializing...');
    initializeWindowMovement();
});