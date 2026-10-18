// Renders a tour page to an MP4, frame by frame, with its music mixed in.
// The tour pages expose window.seek(ms) and hide their controls with ?record, so the video
// is exactly what the page plays, credits included.
//
// Needs the dev server (npm run dev) and ffmpeg. For example:
//   node scripts/render-tour.mjs http://localhost:8790/tour/ 77 public/tour/intro-music.mp3 public/tour/hui-360-overview.mp4
//   node scripts/render-tour.mjs http://localhost:8790/tour/admin/ 93 public/tour/admin-music.mp3 public/tour/hui-360-admin-walkthrough.mp4
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const [url, seconds, music, out] = process.argv.slice(2);
if (!out) throw new Error('Usage: node scripts/render-tour.mjs <tour url> <seconds> <music.mp3> <out.mp4>');
const FPS = 30;
const frames = Math.round(Number(seconds) * FPS);
const dir = mkdtempSync(join(process.env.RENDER_TMP || tmpdir(), 'tour-'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${url}${url.includes('?') ? '&' : '?'}record`);
await page.waitForFunction(() => window.seek && document.fonts.status === 'loaded');
for (let i = 0; i < frames; i++) {
  await page.evaluate((ms) => window.seek(ms), (i * 1000) / FPS);
  await page.screenshot({ path: join(dir, `f${String(i).padStart(5, '0')}.png`) });
}
await browser.close();

const credit = 'Music: "Life of Riley" by Kevin MacLeod (incompetech.com), licensed under CC BY 4.0. Shortened, with a fade out.';
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%05d.png'), '-i', music,
  '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '128k',
  '-t', String(seconds), '-metadata', `comment=${credit}`, '-movflags', '+faststart', out,
]);
rmSync(dir, { recursive: true });
console.log(`${out}: ${frames} frames`);
