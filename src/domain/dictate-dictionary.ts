import type { DictateReplacement, DictionaryLearnPair } from './types';

const KEYWORD_FORBIDDEN = /[<>\r\n]/;
const MAX_KEYWORDS = 50;
const MAX_KEYWORD_CHARS = 64;
const MAX_LEARN_PAIRS = 4;
const MAX_LEARN_TOKENS = 8;
const MAX_EMAIL_FROM_TOKENS = 12;
const TOKEN_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu;
const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'if', 'in', 'is', 'it',
    'just', 'like', 'of', 'on', 'or', 'please', 'so', 'that', 'the', 'this', 'to', 'was', 'with',
    'am', 'das', 'dem', 'den', 'der', 'des', 'die', 'du', 'ein', 'eine', 'es', 'ich', 'im', 'ist',
    'sie', 'und', 'von', 'wir', 'zu'
]);

export function normalizeVocabulary(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set<string>();
    const words: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') {
            continue;
        }

        const word = item.trim();
        if (word.length === 0 || seen.has(word)) {
            continue;
        }

        seen.add(word);
        words.push(word);
    }

    return words;
}

export function normalizeReplacements(value: unknown): DictateReplacement[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const seenFrom = new Set<string>();
    const replacements: DictateReplacement[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') {
            continue;
        }

        const record = item as { id?: unknown; from?: unknown; to?: unknown };
        const from = typeof record.from === 'string' ? record.from.trim() : '';
        const to = typeof record.to === 'string' ? record.to.trim() : '';
        if (from.length === 0 || to.length === 0) {
            continue;
        }

        const fromKey = from.toLowerCase();
        if (seenFrom.has(fromKey)) {
            continue;
        }

        seenFrom.add(fromKey);
        replacements.push({
            id: typeof record.id === 'string' && record.id.trim().length > 0
                ? record.id
                : crypto.randomUUID(),
            from,
            to
        });
    }

    return replacements;
}

export function transcriptionKeywords(vocabulary: string[]): string[] {
    const keywords: string[] = [];
    const seen = new Set<string>();
    for (const word of vocabulary) {
        if (keywords.length >= MAX_KEYWORDS) {
            break;
        }

        if (!isValidKeyword(word) || seen.has(word)) {
            continue;
        }

        seen.add(word);
        keywords.push(word);
    }

    return keywords;
}

export function isSpeakableTerm(value: string): boolean {
    const text = value.trim();
    return text.length > 0
        && !text.includes('@')
        && !text.includes('://')
        && !text.includes('\n')
        && !text.includes('\r');
}

export function dictionaryPromptSuffix(vocabulary: string[], replacements: DictateReplacement[]): string {
    const lines: string[] = [];
    if (replacements.length > 0) {
        lines.push('Correction rules (apply exactly):');
        for (const replacement of replacements.slice(0, 40)) {
            lines.push(`- Write ${replacement.to}, not "${replacement.from}".`);
        }
    }

    if (vocabulary.length > 0) {
        lines.push(`Preferred terms: ${vocabulary.slice(0, 40).join(', ')}.`);
    }

    return lines.join('\n');
}

export function applyReplacements(text: string, replacements: DictateReplacement[]): string {
    if (replacements.length === 0 || text.length === 0) {
        return text;
    }

    const ordered = [...replacements].sort((left, right) => right.from.length - left.from.length);
    let result = text;
    for (const replacement of ordered) {
        result = result.replace(phrasePattern(replacement.from), replacement.to);
    }

    return result;
}

export function inspectCopiedDictation(
    inserted: string,
    copied: string,
    existing: { vocabulary: string[]; replacements: DictateReplacement[] }
): { similar: boolean; pairs: DictionaryLearnPair[] } {
    const originalTokens = tokenize(inserted);
    const copyTokens = tokenize(copied);
    if (originalTokens.length === 0 || copyTokens.length === 0) {
        return { similar: false, pairs: [] };
    }

    const windowTokens = bestCopyWindow(originalTokens, copyTokens);
    const ops = diffTokens(originalTokens, windowTokens);
    if (!isSimilarCopy(inserted, windowTokens.join(' '), originalTokens, windowTokens, ops)) {
        return { similar: false, pairs: [] };
    }

    const existingFrom = new Set(existing.replacements.map((entry) => entry.from.toLowerCase()));
    const pairs: DictionaryLearnPair[] = [];

    for (let index = 0; index < ops.length && pairs.length < MAX_LEARN_PAIRS; index += 1) {
        const current = ops[index];
        const next = ops[index + 1];
        if (current.kind !== 'del' || next?.kind !== 'ins') {
            continue;
        }

        index += 1;
        const from = current.tokens.join(' ');
        const to = next.tokens.join(' ');
        if (!isLearnablePair(current.tokens, next.tokens, from, to, existingFrom)) {
            continue;
        }

        existingFrom.add(from.toLowerCase());
        pairs.push({ from, to });
    }

    return { similar: true, pairs };
}

function isValidKeyword(word: string): boolean {
    return word.length > 0
        && word.length <= MAX_KEYWORD_CHARS
        && !KEYWORD_FORBIDDEN.test(word);
}

function phrasePattern(from: string): RegExp {
    const escaped = from.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
}

function tokenize(text: string): string[] {
    return text.match(TOKEN_PATTERN) ?? [];
}

function tokensEqual(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}

interface DiffOp {
    kind: 'eq' | 'del' | 'ins';
    tokens: string[];
}

function lcsLength(original: string[], copy: string[]): number {
    const rows = original.length;
    const cols = copy.length;
    const previous = new Uint16Array(cols + 1);
    const current = new Uint16Array(cols + 1);
    for (let i = 1; i <= rows; i += 1) {
        for (let j = 1; j <= cols; j += 1) {
            current[j] = tokensEqual(original[i - 1], copy[j - 1])
                ? previous[j - 1] + 1
                : Math.max(previous[j], current[j - 1]);
        }
        previous.set(current);
    }

    return previous[cols];
}

function bestCopyWindow(original: string[], copy: string[]): string[] {
    if (copy.length === 0) {
        return copy;
    }

    if (original.length > 40) {
        const first = original[0].toLowerCase();
        const start = copy.findIndex((token) => token.toLowerCase() === first);
        if (start >= 0) {
            return copy.slice(start, start + original.length + 6);
        }

        return copy.slice(0, Math.min(copy.length, original.length + 6));
    }

    const minLen = 1;
    const maxLen = Math.min(copy.length, original.length + 6);
    const originalText = original.join(' ');
    let best = copy.slice(0, Math.min(copy.length, original.length));
    let bestScore = -1;
    for (let length = minLen; length <= maxLen; length += 1) {
        for (let start = 0; start + length <= copy.length; start += 1) {
            const window = copy.slice(start, start + length);
            const score = lcsLength(original, window)
                + charLcsRatio(compactChars(originalText), compactChars(window.join(' ')));
            if (score > bestScore || (score === bestScore && window.length < best.length)) {
                bestScore = score;
                best = window;
            }
        }
    }

    return best;
}

function diffTokens(original: string[], copy: string[]): DiffOp[] {
    const rows = original.length;
    const cols = copy.length;
    const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
    for (let i = 1; i <= rows; i += 1) {
        for (let j = 1; j <= cols; j += 1) {
            table[i][j] = tokensEqual(original[i - 1], copy[j - 1])
                ? table[i - 1][j - 1] + 1
                : Math.max(table[i - 1][j], table[i][j - 1]);
        }
    }

    const raw: DiffOp[] = [];
    let i = rows;
    let j = cols;
    while (i > 0 && j > 0) {
        if (tokensEqual(original[i - 1], copy[j - 1])) {
            raw.push({ kind: 'eq', tokens: [original[i - 1]] });
            i -= 1;
            j -= 1;
        } else if (table[i][j - 1] >= table[i - 1][j]) {
            raw.push({ kind: 'ins', tokens: [copy[j - 1]] });
            j -= 1;
        } else {
            raw.push({ kind: 'del', tokens: [original[i - 1]] });
            i -= 1;
        }
    }

    while (i > 0) {
        raw.push({ kind: 'del', tokens: [original[i - 1]] });
        i -= 1;
    }

    while (j > 0) {
        raw.push({ kind: 'ins', tokens: [copy[j - 1]] });
        j -= 1;
    }

    raw.reverse();
    return orderReplaceHunks(mergeDiffOps(raw));
}

function mergeDiffOps(ops: DiffOp[]): DiffOp[] {
    const merged: DiffOp[] = [];
    for (const op of ops) {
        const last = merged[merged.length - 1];
        if (last && last.kind === op.kind) {
            last.tokens.push(...op.tokens);
            continue;
        }

        merged.push({ kind: op.kind, tokens: [...op.tokens] });
    }

    return merged;
}

function orderReplaceHunks(ops: DiffOp[]): DiffOp[] {
    const ordered = [...ops];
    for (let index = 0; index < ordered.length - 1; index += 1) {
        if (ordered[index].kind === 'ins' && ordered[index + 1].kind === 'del') {
            const insert = ordered[index];
            ordered[index] = ordered[index + 1];
            ordered[index + 1] = insert;
        }
    }

    return ordered;
}

function compactChars(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9@.äöüß]/g, '');
}

function charLcsRatio(left: string, right: string): number {
    if (left.length === 0 || right.length === 0) {
        return 0;
    }

    const rows = left.length;
    const cols = right.length;
    const previous = new Uint16Array(cols + 1);
    const current = new Uint16Array(cols + 1);
    for (let i = 1; i <= rows; i += 1) {
        for (let j = 1; j <= cols; j += 1) {
            current[j] = left[i - 1] === right[j - 1]
                ? previous[j - 1] + 1
                : Math.max(previous[j], current[j - 1]);
        }
        previous.set(current);
    }

    return previous[cols] / Math.max(rows, cols);
}

function isSimilarCopy(
    inserted: string,
    windowText: string,
    original: string[],
    windowTokens: string[],
    ops: DiffOp[]
): boolean {
    const equalCount = ops
        .filter((op) => op.kind === 'eq')
        .reduce((sum, op) => sum + op.tokens.length, 0);
    if (equalCount / original.length >= 0.35) {
        return true;
    }

    const hasSubstitution = ops.some((op, index) =>
        (op.kind === 'del' && ops[index + 1]?.kind === 'ins')
        || (op.kind === 'ins' && ops[index + 1]?.kind === 'del')
    );
    const charScore = charLcsRatio(compactChars(inserted), compactChars(windowText));
    if (original.length <= 12 && charScore >= 0.5 && hasSubstitution) {
        return true;
    }

    if (!hasSubstitution) {
        return false;
    }

    return windowTokens.length <= original.length + 8 && charScore >= 0.5;
}

function looksLikeEmail(value: string): boolean {
    return value.includes('@') && value.includes('.');
}

function isLearnablePair(
    fromTokens: string[],
    toTokens: string[],
    from: string,
    to: string,
    existingFrom: Set<string>
): boolean {
    if (fromTokens.length === 0 || toTokens.length === 0) {
        return false;
    }

    const emailSide = looksLikeEmail(from) || looksLikeEmail(to);
    const maxFrom = emailSide ? MAX_EMAIL_FROM_TOKENS : MAX_LEARN_TOKENS;
    const maxTo = emailSide ? MAX_LEARN_TOKENS : MAX_LEARN_TOKENS;
    if (fromTokens.length > maxFrom || toTokens.length > maxTo) {
        return false;
    }

    if (from.toLowerCase() === to.toLowerCase()) {
        return false;
    }

    if (charLcsRatio(compactChars(from), compactChars(to)) < 0.4) {
        return false;
    }

    if (fromTokens.every(isStopword) && toTokens.every(isStopword)) {
        return false;
    }

    if (existingFrom.has(from.toLowerCase())) {
        return false;
    }

    return true;
}

function isStopword(token: string): boolean {
    return STOPWORDS.has(token.toLowerCase());
}
