import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, LLAMA_MODEL, WHISPER_MODEL } from './config.js';
export { CLAUDE_MODEL, LLAMA_MODEL };
import { HttpError } from './http.js';
import { seal, unseal } from './seal.js';

// Settings, AI. When it is off, nothing about anyone is sent to any model.
export async function aiOn(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'ai'").first();
  return row?.value !== 'off';
}
export const AI_OFF = 'AI is turned off in Settings, so start from the answers and write it yourself.';

// Every model call goes through here, so the AI switch in Settings holds everywhere,
// and every call lands in the AI log: what it was for, which model, when, size, and result.
// ctx: { kind, cycle, staff, actor }
export function completer(env, ctx = {}) {
  return async (system, user) => {
    if (!(await aiOn(env))) throw new HttpError(409, AI_OFF);
    const key = await anthropicKey(env);
    const run = { ...ctx, model: key ? CLAUDE_MODEL : LLAMA_MODEL, started: Date.now() };
    try {
      const { text, usage } = await model(env, key)(system, user);
      await logRun(env, { ...run, ...usage, ok: 1 });
      return text;
    } catch (e) {
      await logRun(env, { ...run, ok: 0, error: String(e.message || e).slice(0, 300) });
      throw e;
    }
  };
}

export async function logRun(env, r) {
  try {
    await env.DB.prepare(
      'INSERT INTO ai_runs (actor, kind, cycle_id, staff_id, model, input_tokens, output_tokens, ms, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(r.actor ?? null, r.kind || 'other', r.cycle ?? null, r.staff ?? null, r.model, r.input ?? null, r.output ?? null, r.started ? Date.now() - r.started : null, r.ok ?? 1, r.error ?? null).run();
  } catch (e) {
    console.error('ai log', e.message); // the log never stops a draft
  }
}

// ---------- the Anthropic key ----------
// Either a Cloudflare secret (ANTHROPIC_API_KEY, set during setup) or pasted in Settings, AI, and sealed (seal.js).
export const sealKey = (env, plain) => seal(env, plain, 'anthropic-key');
export const openKey = (env, sealed) => unseal(env, sealed, 'anthropic-key');
export async function anthropicKey(env) {
  if (env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'anthropic_key'").first();
  return row?.value ? openKey(env, row.value) : '';
}
const gateway = (env) =>
  env.AI_GATEWAY_ID && env.CF_ACCOUNT_ID ? `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic` : undefined;

// Checks a key before it is saved. Listing models costs nothing.
export async function checkKey(env, key) {
  await new Anthropic({ apiKey: key }).models.list({ limit: 1 }); // straight to Anthropic, not through the gateway
}

// Plain words for the ways a pasted key stops working, so the director knows what to do.
export function keyTrouble(e) {
  const fix = 'Paste a new key in Settings, AI, or press Remove key there to use the free Llama.';
  if (e?.status === 401 || e?.status === 403) return `Your Anthropic key stopped working. It may have expired, been deleted, or belonged to someone who left your Anthropic organization. ${fix}`;
  if (/credit balance/i.test(e?.message || '')) return `Your Anthropic account is out of credit. Add credit in the Anthropic console (Billing). ${fix}`;
  return '';
}

// The model switch: Claude with an Anthropic key, Llama on Workers AI otherwise.
function model(env, key) {
  if (key) {
    const client = new Anthropic({ apiKey: key, baseURL: gateway(env) });
    // Server side fallback (if a safety classifier declines) exists for Sonnet and Opus, not Haiku.
    const fallback = /sonnet|opus/.test(CLAUDE_MODEL) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
    return async (system, user) => {
      let msg;
      try {
        msg = await client.beta.messages
          .stream({ model: CLAUDE_MODEL, max_tokens: 16000, system, messages: [{ role: 'user', content: user }], ...fallback })
          .finalMessage();
      } catch (e) {
        throw new HttpError(502, keyTrouble(e) || `Claude did not answer (${e.status || e.message}). Try again in a minute.`);
      }
      if (msg.stop_reason === 'refusal') throw new HttpError(502, 'The model declined to write this draft. Try again or write it by hand.');
      return {
        text: msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
        usage: { input: msg.usage?.input_tokens, output: msg.usage?.output_tokens },
      };
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
    return {
      text: typeof out.response === 'string' ? out.response : JSON.stringify(out.response ?? ''),
      usage: { input: out.usage?.prompt_tokens, output: out.usage?.completion_tokens },
    };
  };
}

export async function transcribe(env, bytes, hint) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const out = await env.AI.run(WHISPER_MODEL, { audio: btoa(bin), initial_prompt: hint });
  return { text: (out.text || '').trim(), language: out.transcription_info?.language || null };
}
