import {
    cursorPosition,
    monitorFromPoint,
    PhysicalPosition,
    primaryMonitor,
    type Monitor,
    type Window
} from '@tauri-apps/api/window';

async function resolveMonitorAtCursor(window: Window): Promise<Monitor | null> {
    const scaleFactor = await window.scaleFactor();
    const logicalCursor = (await cursorPosition()).toLogical(scaleFactor);
    return (await monitorFromPoint(logicalCursor.x, logicalCursor.y)) ?? (await primaryMonitor());
}

/** Vertical center of the window sits at the middle of the top third of the work area. */
const TOP_THIRD_CENTER_RATIO = 1 / 6;

export async function centerWindowOnCursorMonitor(window: Window): Promise<void> {
    try {
        const monitor = await resolveMonitorAtCursor(window);
        if (!monitor) {
            return;
        }

        const outerSize = await window.outerSize();
        const { position: workOrigin, size: workSize } = monitor.workArea;

        const x = workOrigin.x + (workSize.width - outerSize.width) / 2;
        const y = workOrigin.y + workSize.height * TOP_THIRD_CENTER_RATIO - outerSize.height / 2;

        await window.setPosition(new PhysicalPosition(x, y));
    } catch (error) {
        console.warn('Could not center window on cursor monitor:', error);
    }
}
