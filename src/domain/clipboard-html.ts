const TEAMS_EMOJI_SELECTOR = '[itemtype="http://schema.skype.com/Emoji"]';

function resolveEmojiText(element: Element): string {
    const itemscope = element.getAttribute('itemscope');
    if (itemscope && itemscope.trim()) {
        return itemscope;
    }

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
        return ariaLabel;
    }

    const img = element.querySelector('img');
    const alt = img?.getAttribute('alt');
    return alt && alt.trim() ? alt : '';
}

/**
 * Builds clean, improvable plain text from clipboard HTML.
 * Resolves Teams custom emoji (stored as Unicode in itemscope) to real characters
 * and drops the bogus double-newlines apps like Teams put in their text/plain version.
 */
export function htmlToImprovableText(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    for (const emoji of Array.from(doc.querySelectorAll(TEAMS_EMOJI_SELECTOR))) {
        emoji.replaceWith(doc.createTextNode(resolveEmojiText(emoji)));
    }

    for (const img of Array.from(doc.querySelectorAll('img'))) {
        const alt = img.getAttribute('alt');
        img.replaceWith(doc.createTextNode(alt && alt.trim() ? alt : ''));
    }

    const text = doc.body.textContent ?? '';
    return text
        .replace(/\u00a0/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
