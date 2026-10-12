// Model ids live here and nowhere else.
// With an Anthropic key (Settings, AI), Haiku 5.5 drafts a letter for under a cent. 'claude-sonnet-5-5'
// writes richer letters for about ten cents each. Without a key, Llama on Workers AI is used.
export const CLAUDE_MODEL = 'claude-haiku-5-5';
export const LLAMA_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

export const LINK_TTL_DAYS = 60;
export const SESSION_DAYS = 30;
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
