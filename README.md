# Nightbot Forecast Command

A serverless `!forecast` command for Nightbot that returns a live weather forecast for any city, on a specific weekday, a specific date, or as a quick 3-day outlook — no API key required.

```
!forecast Dallas Thursday
!forecast New York NY fri
!forecast Chicago 07/04/2026
!forecast Miami
```

## Features

- **City + state support** — `!forecast Austin` or `!forecast Austin TX` both work
- **Flexible day input** — full weekday names (`thursday`) or abbreviations (`thu`, `thurs`)
- **Date support** — `MM/DD/YYYY` or `M-D-YY` formats, e.g. `7/4/26`
- **3-day outlook fallback** — if no day/date is given, returns the next 3 days
- **Fast path for popular cities** — skips the geocoding lookup entirely for cities in `KNOWN_CITIES`, cutting response time roughly in half
- **Automatic fallback geocoding** — if the primary geocoder (Open-Meteo) doesn't recognize a location, it retries with Nominatim/OpenStreetMap
- **In-memory caching** — repeated lookups for the same city skip geocoding on subsequent calls
- **Built-in timeouts** — every external fetch is capped at 3.5 seconds so the command never hangs Nightbot

## How it works

The command is a single serverless function that:
1. Parses the chat input into a city, optional state, and optional day/date
2. Resolves the city to latitude/longitude (instantly for known cities, or via geocoding API otherwise)
3. Pulls a 7-day forecast from [Open-Meteo](https://open-meteo.com/) (free, no API key)
4. Returns a plain-text response formatted for chat

## Setup

### 1. Set your User-Agent

Open the script and replace the placeholder near the top:

```ts
const NOMINATIM_USER_AGENT = "ENTER_UA_HERE";
```

with something identifying your project, e.g.:

```ts
const NOMINATIM_USER_AGENT = "my-twitch-forecast-bot/1.0 (contact: you@example.com)";
```

This is required — [Nominatim's usage policy](https://operations.osmfoundation.org/policies/nominatim/) throttles or blocks requests without an identifying User-Agent. This fallback only fires if the primary geocoder can't find the location, so it won't be hit often, but it needs to work when it is.

### 2. (Optional) Customize `KNOWN_CITIES`

The script ships with 20 major US cities hardcoded for instant lookups. Add your own frequently-requested cities (local towns, your stream's home base, etc.) in the same format:

```ts
"your city": { lat: 00.0000, lon: -00.0000, name: "Your City, ST" },
```

Any city not in this list still works fine — it just takes one extra API round-trip for geocoding.

### 3. Deploy

Pick whichever platform is easiest for you — both are free and require no server management.

#### Option A: Val.town (no CLI, works from a phone browser)
1. Go to [val.town](https://val.town) and sign up
2. Create a new val → select **HTTP** as the type
3. Paste in the full script
4. Save — Val.town auto-deploys and gives you a live URL like `https://username-valname.web.val.run`

#### Option B: Cloudflare Workers (requires Wrangler CLI)
1. `npm install -g wrangler`
2. `wrangler login`
3. Save the script as `index.js` in a new folder alongside a `wrangler.toml`:
   ```toml
   name = "nightbot-forecast"
   main = "index.js"
   compatibility_date = "2024-09-23"
   ```
4. `wrangler deploy` — prints your live `*.workers.dev` URL

### 4. Add the command to Nightbot

In your Nightbot dashboard or in chat:

```
!commands add !forecast $(urlfetch https://YOUR-DEPLOYMENT-URL?q=$(querystring))
```

Nightbot's `$(querystring)` already URL-encodes the input, so no extra encoding is needed.

## Limitations

- Forecast data only covers the next ~7 days (a limitation of the free Open-Meteo API) — requesting a day/date further out returns an "out of range" message
- Nightbot's `urlfetch` requires the response to be plain text under 400 characters, which this script is designed to stay within
- Geocoding accuracy for ambiguous city names (e.g. "Springfield") depends on Open-Meteo/Nominatim's own disambiguation — adding a state usually resolves this

## License

Free to use, modify, and redistribute. No attribution required, though it's appreciated.
