import { callGemini, withModelFallback } from '../utils/geminiClient';
import { BingoCategory } from '../utils/types';

// The generator picks its own batch size rather than taking a host-set count:
// it aims for AI_TARGET_CATEGORIES and only goes up to AI_MAX_CATEGORIES when it
// has that many genuinely good, findable items. The cap is also enforced
// client-side below, since models routinely overshoot an instructed limit.
export const AI_MAX_CATEGORIES = 20;
export const AI_TARGET_CATEGORIES = 15;

const COUNT_DIRECTIVE = `
HOW MANY: Decide the count yourself based on quality, not a fixed quota. Aim for about ${AI_TARGET_CATEGORIES} categories. Never return more than ${AI_MAX_CATEGORIES}. Only approach ${AI_MAX_CATEGORIES} if every item is genuinely distinct and clearly findable; if the theme is narrow, return fewer excellent categories instead of padding the list with weak, obscure or repetitive ones. Quality outranks quantity.
`;

export const generateAICategories = async (customPrompt: string, language: string, excludeCategories: string[] = [], contextBlock = ''): Promise<BingoCategory[]> => {
    try {
        // Categories already in the game (stacked generations) — the model must
        // spend its whole quota on genuinely new items.
        const exclusionBlock = excludeCategories.length
            ? `
ALREADY IN THE GAME — do NOT output any of these, nor close variants or translations of them:
${excludeCategories.map((c) => `- ${c}`).join('\n')}
`
            : '';

        // A per-call random key plus an explicit instruction keeps repeat runs of
        // the same prompt from converging on the same obvious picks.
        const varietyBlock = `
RANDOMIZATION (variation key: ${Math.random().toString(36).slice(2, 10)}):
Every run must be a fresh draw. Do not default to the most obvious/common picks — mix in less predictable but still clearly identifiable items, so two runs with this prompt never return the same list.
`;

        const prompt = customPrompt.trim()
            ? `
Act as a hyper-specific Google Street View Bingo Generator. 

MAIN DIRECTIVE:
You must generate ${language} bingo categories that are strictly and exclusively themed around: "${customPrompt}".
${COUNT_DIRECTIVE}
Contextual Rules:
- VISIBILITY: Items must be visible from a camera mounted on top of a car.
- SCALE: If the prompt specifies a size (e.g., "small objects"), ensure the items are still identifiable in a standard compressed GSV image (e.g., "doorbell", "padlock", "street name sign").
- LOCALIZATION: If the prompt is a location (e.g., "Germany"), use hyper-local visual cues (e.g., "Yellow license plates," "External window shutters," "Bollards with reflectors").
- VARIETY: Do not repeat the same concept.

Constraint Checklist:
1. Format: 2-4 words max. Use clear, common ${language} terms.
2. Grammar: Noun-focused.
3. Strictly NO commentary: Do not explain why you chose these.
4. NO MARKDOWN: No formatting, bold, italic, or code blocks.
5. Output Format: Return ONLY a raw JSON array of strings.
${contextBlock}${exclusionBlock}${varietyBlock}
REQUIRED JSON FORMAT (EXACT):
["item 1", "item 2", "item 3"]`
            : `
Act as an expert Geo-Bingo game designer generating a${contextBlock ? ' location-aware' : ' general-purpose, globally playable'} game set.

Your objective is to generate ${language} unique, identifiable bingo categories suitable for Google Street View ${contextBlock ? 'within the play area described below' : 'anywhere in the world'}.
${COUNT_DIRECTIVE}
Key Requirement: DIVERSITY. You must provide a balanced mixture of items from the following four domains. Do not overload the list with only one type of item (e.g., do not provide 10 different colors of cars).

THE FOUR DOMAINS (Select roughly equally from these):
1. Transport: Different vehicle types, colors, or states (e.g., "delivery truck", "red motorcycle", "bicycle with basket", "flat tire").
2. Infrastructure & Street Furniture: Common roadside objects (e.g., "fire hydrant", "bus stop shelter", "street light pole", "trash bin", "traffic cone").
3. Architecture & Buildings: Building details and materials (e.g., "brick facade", "spiral staircase", "blue door", "balcony garden", "solar panels").
4. Nature & Environment: Common flora or environmental elements visible from the road (e.g., "palm tree", "flowering bush", "overgrown grass", "large rock").

Constraints:
- Frequency: Items should have a "Medium" frequency globally—not on every block, but findable within a few minutes of browsing.
- Format: 2-4 words max. Use clear, common ${language} terms.
- GSV Constraints: Items must be static and clearly identifiable from a car-mounted camera perspective.
- NO FORMATTING: No markdown, bold, italic, code blocks, or any styling.

Output Format: Return ONLY a raw JSON array of strings. No markdown, no preamble, no explanations, no formatting.
${contextBlock}${exclusionBlock}${varietyBlock}
REQUIRED JSON TEMPLATE (EXACT):
["category 1", "category 2", "category 3"]`;

        // Structure validation happens INSIDE the fallback so an empty/broken reply
        // from a weaker model falls through to the next model instead of failing.
        const aiText = await withModelFallback(async (model) => {
            const res = await callGemini(model, {
                contents: [
                    {
                        parts: [
                            {
                                text: prompt,
                            },
                        ],
                    },
                ],
                generationConfig: { temperature: 1.25 },
            });
            if (!res.ok) {
                const errorBody = await res.json().catch(() => ({}));
                throw new Error(`Gemini API error with model ${model}: ${errorBody.error?.message || 'Unknown AI error'}`);
            }
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof text !== 'string' || !text.trim()) {
                console.error('Invalid AI response structure:', data);
                throw new Error(`Invalid AI response structure from model ${model}`);
            }
            return text;
        });

        let categories: string[];

        try {
            categories = JSON.parse(aiText);
        } catch {
            let cleanedText = aiText;
            cleanedText = cleanedText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
            cleanedText = cleanedText.replace(/'/g, '"');
            const jsonMatch = cleanedText.match(/\[[\s\S]*?\]/);
            if (jsonMatch) {
                try {
                    categories = JSON.parse(jsonMatch[0]);
                } catch {
                    const lines = cleanedText.split('\n').filter((line: string) => line.trim());
                    categories = lines
                        .map((line: string) =>
                            line
                                .replace(/^\d+\.\s*/, '')
                                .replace(/^[-*]\s*/, '')
                                .replace(/["']/g, '')
                                .trim(),
                        )
                        .filter(Boolean);
                }
            } else {
                const lines = cleanedText.split('\n').filter((line: string) => line.trim());
                categories = lines
                    .map((line: string) =>
                        line
                            .replace(/^\d+\.\s*/, '')
                            .replace(/^[-*]\s*/, '')
                            .replace(/["']/g, '')
                            .replace(/,$/, '')
                            .trim(),
                    )
                    .filter(Boolean);
            }
        }

        categories = categories
            .filter((cat) => cat && typeof cat === 'string')
            .map((cat) => cat.trim())
            .map((cat) => {
                return cat.replace(/[\\]/g, '').replace(/["']/g, '').replace(/\s+/g, ' ').trim();
            })
            .filter((cat) => cat.length > 0 && cat.length <= 50)
            .map((cat) => {
                return cat
                    .split(' ')
                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                    .join(' ');
            })
            .filter((cat, index, arr) => arr.indexOf(cat) === index);

        // Drop anything the model returned despite the exclusion list, BEFORE the
        // cap — so duplicates don't eat slots of the new batch.
        const excludedSet = new Set(excludeCategories.map((c) => c.trim().toLowerCase()));
        categories = categories.filter((cat) => !excludedSet.has(cat.toLowerCase()));

        if (categories.length === 0) {
            throw new Error('AI generated no valid categories');
        }

        const bingoCategories: BingoCategory[] = categories.slice(0, AI_MAX_CATEGORIES).map((category) => ({
            categoryName: category,
            matchedPlaces: [],
        }));

        return bingoCategories;
    } catch (error) {
        console.error('Error generating AI categories:', error);
        throw error;
    }
};
