// "Development key" warning: only needed if the functions use an AI key whose
// prompts may be used for training — in that case no real book text must be
// sent to the AI. Amazon Nova on Bedrock does not use prompts for training,
// so the warning is off.
// Set to true only for a development setup with such a key.
// The constant is shared by every surface that calls the AI (Synopsis tab,
// editor/refinement).
export const SHOW_FREE_TIER_WARNING = false;
