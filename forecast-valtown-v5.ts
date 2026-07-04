// Val.town HTTP val — Nightbot !forecast command (v5)
// Adds: specific time-of-day, multiple locations/days in one query, and
// natural-language filler words ("for", "on", "at", "the", "in").
//
// SINGLE LOCATION MODE (backward compatible):
//   !forecast Sherman
//   !forecast Sherman Thursday
//   !forecast Sherman today 5:00pm
//   !forecast Sherman TX 7/4/26
//   !forecast for Dallas TX on Tuesday at 7am      (natural language)
//
// MULTI-LOCATION MODE (use the literal word "for" to separate locations
// from days, and "and" to chain multiple of either):
//   !forecast Sherman TX and Greenville TX for Sunday and Monday
//   !forecast Dallas and Austin for today 5pm
//   !forecast for Dallas and Austin on Sunday and Monday at 7am
//
// Nightbot setup:
// !commands add !forecast $(urlfetch https://YOUR-DEPLOYMENT-URL?q=$(querystring))
// Recommended: add -cd=120 to the command for spam control.

const CACHE = new Map<string, { lat: number; lon: number; name: string }>();

const MAX_LOCATIONS = 2;
const MAX_DAYS = 2;

const KNOWN_CITIES: Record<string, { lat: number; lon: number; name: string }> = {
  // Local / frequently used
  "sulphur springs": { lat: 33.1385, lon: -95.6011, name: "Sulphur Springs, TX" },
  "dallas": { lat: 32.7767, lon: -96.7970, name: "Dallas, TX" },
  "fort worth": { lat: 32.7555, lon: -97.3308, name: "Fort Worth, TX" },
  "sherman": { lat: 33.6357, lon: -96.6089, name: "Sherman, TX" },
  "bells": { lat: 33.6023, lon: -96.4142, name: "Bells, TX" },
  "greenville": { lat: 33.1384, lon: -96.1108, name: "Greenville, TX" },

  // Popular US cities (fast path — skips geocoding)
  "new york": { lat: 40.7128, lon: -74.0060, name: "New York, NY" },
  "los angeles": { lat: 34.0522, lon: -118.2437, name: "Los Angeles, CA" },
  "chicago": { lat: 41.8781, lon: -87.6298, name: "Chicago, IL" },
  "houston": { lat: 29.7604, lon: -95.3698, name: "Houston, TX" },
  "phoenix": { lat: 33.4484, lon: -112.0740, name: "Phoenix, AZ" },
  "philadelphia": { lat: 39.9526, lon: -75.1652, name: "Philadelphia, PA" },
  "san antonio": { lat: 29.4241, lon: -98.4936, name: "San Antonio, TX" },
  "san diego": { lat: 32.7157, lon: -117.1611, name: "San Diego, CA" },
  "austin": { lat: 30.2672, lon: -97.7431, name: "Austin, TX" },
  "san francisco": { lat: 37.7749, lon: -122.4194, name: "San Francisco, CA" },
  "seattle": { lat: 47.6062, lon: -122.3321, name: "Seattle, WA" },
  "denver": { lat: 39.7392, lon: -104.9903, name: "Denver, CO" },
  "boston": { lat: 42.3601, lon: -71.0589, name: "Boston, MA" },
  "miami": { lat: 25.7617, lon: -80.1918, name: "Miami, FL" },
  "atlanta": { lat: 33.7490, lon: -84.3880, name: "Atlanta, GA" },
  "las vegas": { lat: 36.1699, lon: -115.1398, name: "Las Vegas, NV" },
  "portland": { lat: 45.5152, lon: -122.6784, name: "Portland, OR" },
  "nashville": { lat: 36.1627, lon: -86.7816, name: "Nashville, TN" },
  "oklahoma city": { lat: 35.4676, lon: -97.5164, name: "Oklahoma City, OK" },
};

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY",
};

const DAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

// Direct offsets into the forecast's daily array (0 = today, 1 = tomorrow).
const RELATIVE_DAYS: Record<string, number> = {
  today: 0,
  tomorrow: 1,
};

const WEATHER: Record<number, string> = {
  0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Cloudy",
  45: "Fog", 48: "Fog", 51: "Light Drizzle", 53: "Drizzle", 55: "Heavy Drizzle",
  61: "Light Rain", 63: "Rain", 65: "Heavy Rain",
  71: "Snow", 73: "Snow", 75: "Heavy Snow",
  80: "Showers", 81: "Showers", 82: "Violent Showers",
  95: "Thunderstorms", 96: "T-Storm + Hail", 99: "Severe T-Storm",
};

const TIME_REGEX = /\b(\d{1,2})(:(\d{2}))?\s?(am|pm)\b/i;

// Filler words stripped out for natural-language phrasing support, e.g.
// "!forecast for Dallas TX on Tuesday at 7am" -> "dallas tx tuesday 7am"
// Matched as whole words only, so this won't eat letters out of city names.
// Note: "for" is NOT in this list — it's reserved as the multi-location/day
// separator (see isMulti below) and is stripped separately where safe.
const FILLER_WORDS = ["on", "at", "the", "in"];

function stripFillerWords(input: string): string {
  const words = input.split(" ").filter((w) => !FILLER_WORDS.includes(w));
  return words.join(" ").trim();
}

// ----------------------------
// UTIL
// ----------------------------
function normalize(input: string) {
  return input
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(input: string): Date | null {
  const m = input.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  let y = parseInt(m[3]);
  if (y < 100) y += 2000;
  return new Date(y, parseInt(m[1]) - 1, parseInt(m[2]));
}

function cacheKey(q: string) {
  return q.toLowerCase().trim();
}

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Extracts a time like "5pm", "5:00pm", "7 am" from anywhere in the string.
// Returns { hour24, minute, rest } where `rest` has the time removed.
function extractTime(input: string): { hour: number; minute: number } | null {
  const m = input.match(TIME_REGEX);
  if (!m) return null;

  let hour = parseInt(m[1]);
  const minute = m[3] ? parseInt(m[3]) : 0;
  const meridiem = m[4].toLowerCase();

  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return { hour, minute };
}

function stripTime(input: string): string {
  return input.replace(TIME_REGEX, " ").replace(/\s+/g, " ").trim();
}

// ----------------------------
// FETCH WITH TIMEOUT
// ----------------------------
async function fetchWithTimeout(url: string, ms = 4500, headers?: Record<string, string>) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers });
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ----------------------------
// GEO (cached + fallback)
// ----------------------------
async function geocode(query: string) {
  const key = cacheKey(query);
  if (CACHE.has(key)) return CACHE.get(key)!;

  const om: any = await fetchWithTimeout(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`
  );

  if (om?.results?.length) {
    const r = om.results[0];
    const res = {
      lat: r.latitude,
      lon: r.longitude,
      name: `${r.name}${r.admin1 ? ", " + r.admin1 : ""}`,
    };
    CACHE.set(key, res);
    return res;
  }

  // Fallback geocoder — requires a real User-Agent or Nominatim may throttle/block you.
  const osm: any = await fetchWithTimeout(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`,
    3500,
    { "User-Agent": "ENTER_UA_HERE" }
  );

  if (osm?.length) {
    const res = {
      lat: parseFloat(osm[0].lat),
      lon: parseFloat(osm[0].lon),
      name: osm[0].display_name.split(",")[0],
    };
    CACHE.set(key, res);
    return res;
  }

  return null;
}

// ----------------------------
// STATE DETECTION
// ----------------------------
function extractState(words: string[]) {
  for (let len = 2; len >= 1; len--) {
    for (let i = 0; i <= words.length - len; i++) {
      const seg = words.slice(i, i + len).join(" ");
      if (STATES[seg]) {
        const remaining = [...words.slice(0, i), ...words.slice(i + len)];
        return { city: remaining.join(" ").trim(), state: STATES[seg] };
      }
    }
  }
  return { city: words.join(" ").trim(), state: null };
}

// Resolves a raw location string ("sherman tx") to lat/lon/name.
async function resolveLocation(raw: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const words = raw.trim().split(" ").filter(Boolean);
  if (!words.length) return null;

  const cityKey = words.join(" ");
  if (KNOWN_CITIES[cityKey]) return KNOWN_CITIES[cityKey];

  const { city, state } = extractState(words);
  if (!city) return null;

  const query = state ? `${city}, ${state}` : city;
  return await geocode(query);
}

// ----------------------------
// DAY TOKEN RESOLUTION
// ----------------------------
// Given a single day/date token, returns info needed to pull data from a
// forecast response: either a fixed offset (today/tomorrow), a weekday
// index to search for, or a specific ISO date.
type DayToken =
  | { kind: "offset"; offset: number; label: string }
  | { kind: "weekday"; weekday: number; label: string }
  | { kind: "date"; iso: string; label: string };

function parseDayToken(word: string): DayToken | null {
  if (RELATIVE_DAYS[word] !== undefined) {
    return { kind: "offset", offset: RELATIVE_DAYS[word], label: word };
  }
  if (DAYS[word] !== undefined) {
    return { kind: "weekday", weekday: DAYS[word], label: word };
  }
  const date = parseDate(word);
  if (date) {
    return { kind: "date", iso: isoDate(date), label: word };
  }
  return null;
}

// Resolves a DayToken to an index into forecast.daily.time[]
function resolveDailyIndex(token: DayToken, dates: string[]): number {
  if (token.kind === "offset") return token.offset;
  if (token.kind === "date") return dates.findIndex((d) => d === token.iso);
  return dates.findIndex((d) => new Date(d + "T12:00:00").getDay() === token.weekday);
}

// ----------------------------
// FORECAST FETCH (daily + hourly together)
// ----------------------------
async function getForecast(lat: number, lon: number) {
  return await fetchWithTimeout(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,weathercode` +
    `&hourly=temperature_2m,weathercode` +
    `&temperature_unit=fahrenheit&timezone=auto`
  );
}

function formatHour(hour: number, minute: number) {
  const meridiem = hour >= 12 ? "pm" : "am";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute > 0 ? `${h12}:${String(minute).padStart(2, "0")}${meridiem}` : `${h12}${meridiem}`;
}

// Builds the text for one location x one day, using hourly data if a time
// was given, otherwise the daily high/low.
function formatEntry(
  forecast: any,
  token: DayToken,
  time: { hour: number; minute: number } | null
): string {
  const dates = forecast?.daily?.time;
  if (!dates) return `${token.label}: forecast unavailable`;

  const dayIdx = resolveDailyIndex(token, dates);
  if (dayIdx === -1 || dayIdx >= dates.length) {
    return `${token.label}: out of range (7 days max)`;
  }

  if (time) {
    const targetIso = dates[dayIdx];
    const hourStr = String(time.hour).padStart(2, "0");
    const targetPrefix = `${targetIso}T${hourStr}:00`;
    const hourlyTimes: string[] = forecast?.hourly?.time || [];
    const hIdx = hourlyTimes.findIndex((t) => t === targetPrefix);

    if (hIdx === -1) {
      return `${token.label} ${formatHour(time.hour, time.minute)}: out of range`;
    }

    const temp = Math.round(forecast.hourly.temperature_2m[hIdx]);
    const code = forecast.hourly.weathercode[hIdx];
    return `${token.label} ${formatHour(time.hour, time.minute)}: ${WEATHER[code] || "Unknown"} ${temp}°F`;
  }

  const hi = Math.round(forecast.daily.temperature_2m_max[dayIdx]);
  const lo = Math.round(forecast.daily.temperature_2m_min[dayIdx]);
  const code = forecast.daily.weathercode[dayIdx];
  return `${token.label}: ${WEATHER[code] || "Unknown"} ${hi}/${lo}°F`;
}

// ----------------------------
// MAIN
// ----------------------------
export default async function (req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    let input = normalize(url.searchParams.get("q") || "");

    if (!input) {
      return new Response("Usage: !forecast <city> [state] [day/date/time] — or use 'for' + 'and' for multiple: !forecast Sherman TX and Greenville TX for Sunday and Monday");
    }

    const time = extractTime(input);
    if (time) input = stripTime(input);

    // Detect "for" as the multi-location/day separator BEFORE stripping
    // other filler words, since "for" itself is meaningful structure here.
    const forSplit = input.split(" for ");
    const isMulti = forSplit.length > 1;

    // ----------------------------
    // MULTI-LOCATION / MULTI-DAY MODE
    // ----------------------------
    if (isMulti) {
      const locationsRaw = stripFillerWords(forSplit[0]).split(" and ").map((s) => s.trim()).filter(Boolean);
      const daysRaw = stripFillerWords(forSplit.slice(1).join(" for ")).split(" and ").map((s) => s.trim()).filter(Boolean);

      const locations = locationsRaw.slice(0, MAX_LOCATIONS);
      const dayTokensRaw = daysRaw.slice(0, MAX_DAYS);

      if (!locations.length || !dayTokensRaw.length) {
        return new Response("Usage: !forecast <city1> and <city2> for <day1> and <day2>");
      }

      const dayTokens: DayToken[] = [];
      for (const d of dayTokensRaw) {
        const t = parseDayToken(d);
        if (t) dayTokens.push(t);
      }
      if (!dayTokens.length) {
        return new Response("Couldn't understand the day(s) requested");
      }

      const results: string[] = [];

      for (const loc of locations) {
        const resolved = await resolveLocation(loc);
        if (!resolved) {
          results.push(`${loc}: location not found`);
          continue;
        }

        const forecast = await getForecast(resolved.lat, resolved.lon);
        const entries = dayTokens.map((t) => formatEntry(forecast, t, time));
        results.push(`${resolved.name}: ${entries.join(", ")}`);
      }

      const truncNote =
        locationsRaw.length > MAX_LOCATIONS || daysRaw.length > MAX_DAYS
          ? ` (max ${MAX_LOCATIONS} locations / ${MAX_DAYS} days per request)`
          : "";

      return new Response(results.join(" | ") + truncNote);
    }

    // ----------------------------
    // SINGLE-LOCATION MODE (backward compatible)
    // ----------------------------
    // No multi-mode "for" separator was found, so any stray "for" here is
    // just natural-language phrasing ("!forecast for Dallas Tuesday") —
    // safe to strip along with the other filler words.
    const singleModeInput = stripFillerWords(input.split(" for ").join(" "));
    const parts = singleModeInput.split(" ").filter(Boolean);
    const last = parts[parts.length - 1];

    const dayToken = parseDayToken(last);
    const cityWords = dayToken ? parts.slice(0, -1) : parts;

    if (!cityWords.length) {
      return new Response("Usage: !forecast <city> [state] [day/date]");
    }

    const resolved = await resolveLocation(cityWords.join(" "));
    if (!resolved) {
      return new Response(`Location not found: ${cityWords.join(" ")}`);
    }

    const forecast = await getForecast(resolved.lat, resolved.lon);
    if (!forecast?.daily?.time) {
      return new Response("Forecast unavailable, try again");
    }

    if (dayToken) {
      return new Response(`${resolved.name} ${formatEntry(forecast, dayToken, time)} 🌦️`);
    }

    if (time) {
      // Time given but no day — assume today.
      const todayToken: DayToken = { kind: "offset", offset: 0, label: "today" };
      return new Response(`${resolved.name} ${formatEntry(forecast, todayToken, time)} 🌦️`);
    }

    // DEFAULT — 3-day outlook
    const dates = forecast.daily.time;
    let out = `${resolved.name}: `;
    for (let i = 0; i < 3; i++) {
      const d = new Date(dates[i] + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
      const hi = Math.round(forecast.daily.temperature_2m_max[i]);
      const lo = Math.round(forecast.daily.temperature_2m_min[i]);
      const code = forecast.daily.weathercode[i];
      out += `${d} ${WEATHER[code] || "Unknown"} ${hi}/${lo}°F | `;
    }

    return new Response(out.replace(/\|\s*$/, "").trim());
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return new Response("Weather API timeout, try again");
    }
    return new Response("Error fetching forecast");
  }
}
