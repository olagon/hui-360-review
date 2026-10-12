import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, LLAMA_MODEL, WHISPER_MODEL } from './config.js';
import { HttpError } from './http.js';

// The single switch: Claude when ANTHROPIC_API_KEY is set, Llama on Workers AI otherwise.
export function completer(env) {
  if (env.ANTHROPIC_API_KEY) {
    const baseURL =
      env.AI_GATEWAY_ID && env.CF_ACCOUNT_ID
        ? `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic`
        : undefined;
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL });
    // Server side fallback (if a safety classifier declines) exists for Sonnet and Opus, not Haiku.
    const fallback = /sonnet|opus/.test(CLAUDE_MODEL) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
    return async (system, user) => {
      const msg = await client.beta.messages
        .stream({ model: CLAUDE_MODEL, max_tokens: 16000, system, messages: [{ role: 'user', content: user }], ...fallback })
        .finalMessage();
      if (msg.stop_reason === 'refusal') throw new HttpError(502, 'The model declined to write this draft. Try again or write it by hand.');
      return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    };
  }
  return async (system, user) => {
    const out = await env.AI.run(LLAMA_MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 3000,
    }, env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined);
    // Workers AI hands back JSON replies already parsed. Callers always get text.
    return typeof out.response === 'string' ? out.response : JSON.stringify(out.response ?? '');
  };
}

export async function transcribe(env, bytes, hint) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const out = await env.AI.run(WHISPER_MODEL, { audio: btoa(bin), initial_prompt: hint });
  return { text: (out.text || '').trim(), language: out.transcription_info?.language || null };
}
