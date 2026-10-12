// Hawaiian moon calendar: lunar age for a date in Hawaiʻi, mapped to the 30 nights
// counted from the new moon. A plain average lunation, good to within about a day.
// Local practitioners may count differently.
export const MOONS = [
  'Hilo', 'Hoaka', 'Kūkahi', 'Kūlua', 'Kūkolu', 'Kūpau', 'ʻOlekūkahi', 'ʻOlekūlua', 'ʻOlekūkolu', 'ʻOlepau',
  'Huna', 'Mōhalu', 'Hua', 'Akua', 'Hoku', 'Māhealani', 'Kulu', 'Lāʻaukūkahi', 'Lāʻaukūlua', 'Lāʻaupau',
  'ʻOlekūkahi', 'ʻOlekūlua', 'ʻOlepau', 'Kāloakūkahi', 'Kāloakūlua', 'Kāloapau', 'Kāne', 'Lono', 'Mauli', 'Muku',
];
const LUNATION = 29.530588853;
const KNOWN_NEW = Date.UTC(2000, 0, 6, 18, 14); // a new moon

// date: 'YYYY-MM-DD' (read as evening in Hawaiʻi, when the moon is out) or a Date.
export function moonFor(date = new Date()) {
  const t = typeof date === 'string' ? Date.parse(`${date}T20:00:00-10:00`) : date.getTime();
  const age = ((((t - KNOWN_NEW) / 86400000) % LUNATION) + LUNATION) % LUNATION;
  const night = Math.min(29, Math.floor((age / LUNATION) * 30));
  return { name: MOONS[night], night: night + 1, age };
}

// Today's date in Hawaiʻi as YYYY-MM-DD.
export const hawaiiToday = () => new Date(Date.now() - 10 * 3600000).toISOString().slice(0, 10);

// A small moon drawing: the lit part grows to full at night 15 and shrinks after.
export function moonIcon(age, size = 18) {
  const f = age / LUNATION;
  const lit = Math.cos(2 * Math.PI * f); // 1 new, -1 full
  const rx = Math.abs(lit) * 8;
  const waxing = f < 0.5;
  const side = waxing ? 1 : 0;
  const bulge = lit > 0 ? (waxing ? 0 : 1) : waxing ? 1 : 0;
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="#e8e4db"/><path d="M10 2 A8 8 0 0 ${side} 10 18 A${rx.toFixed(2)} 8 0 0 ${bulge} 10 2Z" fill="#c9a227"/></svg>`;
}
