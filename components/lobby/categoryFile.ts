/*
================================================================================
CATEGORY FILE IMPORT / EXPORT
================================================================================
Reads a category list out of a CSV / TSV / TXT file the host picked, and writes
the current board back out as CSV.

The delimiter is detected rather than configured: hosts paste these lists out of
spreadsheets, notes apps and chat messages, and the extension routinely lies
about the real separator (".csv" files exported by a German Excel are
semicolon-delimited, ".txt" is anything at all). Quoting is honoured so a
category containing the delimiter survives a round-trip.
================================================================================
*/

const DELIMITERS = ['\t', ';', ',', '|'] as const;

/**
 * Split on `delim`, treating "..." as a quoted field ("" is a literal quote).
 * Delimiters inside quotes do not split.
 */
function splitLine(line: string, delim: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch !== '"') cur += ch;
            else if (line[i + 1] === '"') {
                cur += '"';
                i++;
            } else inQuotes = false;
        } else if (ch === '"') inQuotes = true;
        else if (ch === delim) {
            out.push(cur);
            cur = '';
        } else cur += ch;
    }
    out.push(cur);
    return out;
}

/** Occurrences of `delim` outside quoted fields, across the whole text. */
function countUnquoted(text: string, delim: string): number {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (inQuotes && text[i + 1] === '"') i++;
            else inQuotes = !inQuotes;
        } else if (ch === delim && !inQuotes) count++;
    }
    return count;
}

/**
 * The delimiter with the most unquoted occurrences, or null for a
 * one-category-per-line file (no delimiter present at all).
 */
export function detectDelimiter(text: string): string | null {
    let best: string | null = null;
    let bestCount = 0;
    for (const d of DELIMITERS) {
        const n = countUnquoted(text, d);
        if (n > bestCount) {
            best = d;
            bestCount = n;
        }
    }
    return best;
}

/**
 * Every category in the file, trimmed, de-quoted, de-duplicated
 * case-insensitively, and in file order. Newlines always separate, and the
 * detected delimiter separates within a line — so both a single column and a
 * single comma-separated row parse correctly.
 */
export function parseCategoryFile(text: string): string[] {
    const cleaned = text.replace(/^\uFEFF/, '');
    // A one-per-line file has no delimiter, but its fields may still be quoted
    // (that is what a single-column CSV export looks like). Split on a character
    // that cannot occur (NUL) instead of skipping splitLine, so quote handling and
    // "" un-escaping run down every path.
    const delim = detectDelimiter(cleaned) ?? '\u0000';
    const tokens = cleaned.split(/\r?\n/).flatMap((line) => splitLine(line, delim));

    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tokens) {
        const value = raw.trim();
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value);
    }
    return out;
}

/** One category per line, quoting only what needs it. Valid single-column CSV. */
export function toCsv(categories: string[]): string {
    return categories
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
        .join('\n');
}

/** Trigger a client-side download of `content` as `filename`. */
export function downloadTextFile(filename: string, content: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
