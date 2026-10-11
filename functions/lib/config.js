// Model ids live here and nowhere else.
// Haiku 5.5 drafts a summary for about half a cent. 'claude-sonnet-5-5' writes richer
// letters for about ten cents each. Without ANTHROPIC_API_KEY, Llama on Workers AI is used.
export const CLAUDE_MODEL = 'claude-haiku-5-5';
export const LLAMA_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

export const LINK_TTL_DAYS = 60;
export const SESSION_DAYS = 30;
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
