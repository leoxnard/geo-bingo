import { callGemini } from '../utils/geminiClient';
import { BingoCategory } from '../utils/types';

export const generateAICategories = async (customPrompt: string, requiredCount: number, language: string): Promise<BingoCategory[]> => {
    try {
        const prompt = customPrompt.trim()
            ? `
Act as a hyper-specific Google Street View Bingo Generator. 

MAIN DIRECTIVE: 
You must generate exactly ${requiredCount} ${language} bingo categories that are strictly and exclusively themed around: "${customPrompt}". 

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

REQUIRED JSON FORMAT (EXACT):
["item 1", "item 2", "item 3"]`
            : `
Act as an expert Geo-Bingo game designer generating a general-purpose, globally playable game set. 

Your objective is to generate exactly ${requiredCount} ${language} unique, identifiable bingo categories suitable for Google Street View anywhere in the world.

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

REQUIRED JSON TEMPLATE (EXACT):
["category 1", "category 2", "category 3"]`;

        const geminiModels = ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite-preview'];
        let aiResponse;
        let currentModelIndex = 0;

        while (currentModelIndex < geminiModels.length) {
            try {
                aiResponse = await callGemini(geminiModels[currentModelIndex], {
                    contents: [
                        {
                            parts: [
                                {
                                    text: prompt,
                                },
                            ],
                        },
                    ],
                });

                if (!aiResponse.ok) {
                    const errorBody = await aiResponse.json();
                    throw new Error(`Gemini API error with model ${geminiModels[currentModelIndex]}: ${errorBody.error?.message || 'Unknown AI error'}`);
                }

                break;
            } catch {
                currentModelIndex++;
                if (currentModelIndex >= geminiModels.length) {
                    throw new Error('All Gemini models failed to generate categories.');
                }
            }
        }

        if (!aiResponse) {
            throw new Error('Failed to get a response from Gemini API.');
        }

        const data = await aiResponse.json();
        console.log('AI API Response:', JSON.stringify(data, null, 2));

        if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
            console.error('Invalid AI response structure:', data);
            throw new Error(`Invalid AI response structure: ${JSON.stringify(data)}`);
        }

        const aiText = data.candidates[0].content.parts[0].text;
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

        if (categories.length < requiredCount) {
            throw new Error(`AI generated only ${categories.length} valid categories, need ${requiredCount}`);
        }

        const bingoCategories: BingoCategory[] = categories.slice(0, requiredCount).map((category) => ({
            categoryName: category,
            matchedPlaces: [],
        }));

        return bingoCategories;
    } catch (error) {
        console.error('Error generating AI categories:', error);
        throw error;
    }
};
