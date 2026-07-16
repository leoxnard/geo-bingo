/*
================================================================================
ONE-TIME WORD POOL SEED GENERATOR
================================================================================
Emits supabase/migrations/<date>_seed_word_pool_builtins.sql, which inserts every
built-in category database into word_pool as approved words so they show up in
the Explore overlay.

Run: npx tsx scripts/seedWordPoolBuiltins.ts

Shape of the sources (see lib/categories.ts):
  - geoGuessrMeta          — one entry per concept, all 5 languages keyed. Complete.
  - categoriesSimple/Hard  — five arrays, index-aligned. Complete.
  - categoriesBalanced     — en/es/fr/zh are index-aligned (es/fr/zh are
                             translations of en); GERMAN IS A SEPARATE CURATED
                             LIST of a different length, so it cannot be zipped.
                             English-source rows therefore ship without a German
                             translation, and the German list ships as its own
                             german-source rows.

Gaps are left for the admin translation sweep on /admin/words, which is the
existing path for this (Postgres cannot call DeepL/Gemini itself — see the
header of lib/wordPool.ts).

Dedup rules, in insert order, matching the word_pool (word_norm, language)
unique constraint:
  - english-source rows dedupe on the lowercased English word
  - german-source rows additionally dedupe against the German TRANSLATIONS of
    the english-source rows, so "Mülltonne" is not listed twice in a German
    lobby — once via a translation and once as its own row
================================================================================
*/

import { writeFileSync } from 'node:fs';

import { categoriesBalanced, categoriesHard, categoriesSimple, geoGuessrMeta } from '../lib/categories';
import { LOCALE_CODES, LOCALES, type CategoryLanguage } from '../lib/i18n/locales';

const LANGS: CategoryLanguage[] = LOCALE_CODES.map((c) => LOCALES[c].aiName);

type Row = { word: string; language: CategoryLanguage; translations: Partial<Record<CategoryLanguage, string>> };

const norm = (s: string) => s.trim().toLowerCase();

const rows: Row[] = [];
// Guards the (word_norm, language) unique constraint across all sources.
const seen = new Set<string>();
// Every German string already reachable via a translation, so the German-only
// curated list does not re-add concepts under a second row.
const germanSeen = new Set<string>();

function addRow(language: CategoryLanguage, word: string, translations: Partial<Record<CategoryLanguage, string>>): boolean {
    const w = word.trim();
    if (!w || w.length > 80) return false;

    const key = `${language}::${norm(w)}`;
    if (seen.has(key)) return false;

    // A German-source word whose text is already a German translation elsewhere
    // would surface twice in a German lobby.
    if (language === 'german' && germanSeen.has(norm(w))) return false;

    seen.add(key);
    const german = translations.german?.trim();
    if (german) germanSeen.add(norm(german));
    if (language === 'german') germanSeen.add(norm(w));

    rows.push({ word: w, language, translations });
    return true;
}

/** Zip N index-aligned per-language arrays into one english-source row each. */
function addAligned(byLang: Partial<Record<CategoryLanguage, string[]>>, label: string) {
    const en = byLang.english ?? [];
    const aligned = LANGS.filter((l) => byLang[l] && byLang[l]!.length === en.length);
    const skipped = LANGS.filter((l) => byLang[l] && byLang[l]!.length !== en.length);
    let added = 0;

    for (let i = 0; i < en.length; i++) {
        const translations: Partial<Record<CategoryLanguage, string>> = {};
        for (const l of aligned) {
            const v = byLang[l]![i]?.trim();
            if (v) translations[l] = v;
        }
        if (addRow('english', en[i], translations)) added++;
    }
    console.log(`  ${label.padEnd(22)} ${String(added).padStart(3)} rows  (aligned: ${aligned.join(',')}${skipped.length ? ` | NOT aligned, skipped: ${skipped.join(',')}` : ''})`);
}

console.log('Building word pool seed:');

// geoGuessrMeta first — it is the only fully-keyed source, so its complete
// translation sets win any dedup race against the zipped lists.
{
    let added = 0;
    for (const item of geoGuessrMeta) {
        const translations: Partial<Record<CategoryLanguage, string>> = {};
        for (const l of LANGS) {
            const v = item.term[l]?.trim();
            if (v) translations[l] = v;
        }
        if (translations.english && addRow('english', translations.english, translations)) added++;
    }
    console.log(`  ${'geoGuessrMeta'.padEnd(22)} ${String(added).padStart(3)} rows  (all 5 languages keyed)`);
}

addAligned(categoriesSimple, 'categoriesSimple');
addAligned(categoriesHard, 'categoriesHard');
addAligned(categoriesBalanced, 'categoriesBalanced');

// The German balanced pool is curated separately and has its own length, so it
// ships as german-source rows for the admin sweep to translate outward.
{
    let added = 0;
    for (const w of categoriesBalanced.german) {
        if (addRow('german', w, { german: w.trim() })) added++;
    }
    console.log(`  ${'categoriesBalanced.de'.padEnd(22)} ${String(added).padStart(3)} rows  (german-source; separate curated list)`);
}

// ── Emit ────────────────────────────────────────────────────────────────────
const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;
const values = rows.map((r) => `    (${sqlStr(r.word)}, ${sqlStr(norm(r.word))}, ${sqlStr(r.language)}, ${sqlStr(JSON.stringify(r.translations))}::jsonb)`).join(',\n');

const missing = rows.filter((r) => LANGS.some((l) => !r.translations[l]));

const sql = `-- One-time seed: every built-in category database into the Explore word pool.
-- GENERATED by scripts/seedWordPoolBuiltins.ts — do not hand-edit; re-run instead.
--
-- ${rows.length} words, inserted as 'approved' so they are immediately importable.
-- ON CONFLICT (word_norm, language) DO NOTHING makes this safe to re-run and
-- keeps it from disturbing words already harvested from real games.
--
-- ${missing.length} rows ship without a full set of translations (the German
-- balanced pool is curated separately from the English one, so neither side can
-- be zipped into the other). The admin translation sweep on /admin/words fills
-- those in — Postgres cannot call DeepL/Gemini itself.

INSERT INTO "public"."word_pool" ("word", "word_norm", "language", "translations", "status", "reviewed_at")
SELECT v.word, v.word_norm, v.language, v.translations, 'approved', now()
FROM (VALUES
${values}
) AS v(word, word_norm, language, translations)
ON CONFLICT ("word_norm", "language") DO NOTHING;
`;

const out = 'supabase/migrations/20260716_seed_word_pool_builtins.sql';
writeFileSync(out, sql);

console.log(`\n  total ${rows.length} rows -> ${out}`);
console.log(`  fully translated: ${rows.length - missing.length} | need admin sweep: ${missing.length}`);
