// "Development key" warning: only needed if the functions use a FREE-tier
// Gemini key, which uses prompts for training — in that case no real book
// text must be sent to the AI. With the default provider (Amazon Nova on
// Bedrock) prompts are not used for training, so the warning is off.
// Set to true when using a free Gemini key.
// The constant is shared by every surface that calls the AI (Synopsis tab,
// editor/refinement).
export const SHOW_FREE_TIER_WARNING = false;
