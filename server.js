const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 8080;

function isValidCoord(val, min, max) {
  const n = parseFloat(val);
  return !isNaN(n) && n >= min && n <= max;
}

function validateLatLon(req, res, next) {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon are required' });
  if (!isValidCoord(lat, -90, 90) || !isValidCoord(lon, -180, 180)) {
    return res.status(400).json({ error: 'lat must be -90..90 and lon must be -180..180' });
  }
  next();
}

// ─── Open-Meteo endpoints ────────────────────────────────────────────────────
const OM = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  airQuality: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  geocoding: 'https://geocoding-api.open-meteo.com/v1/search',
  alert: 'https://api.open-meteo.com/v1/forecast',
  radar: 'https://api.rainviewer.com/public/weather-maps.json',
};

// ─── Simple in-memory cache (TTL based) ──────────────────────────────────────
const cache = new Map();
function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}
function setCache(key, data, ttlMs) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

// Small fetch-like helper using https (no external deps)
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Upstream responded ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON from upstream'));
        }
      });
    }).on('error', reject);
  });
}

// ─── Static files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Serve Vercel Speed Insights script
app.use('/_vercel/speed-insights', express.static(path.join(__dirname, 'node_modules/@vercel/speed-insights/dist')));

// ─── Current weather + hourly + 7-day forecast ──────────────────────────────
// Query: /api/weather?lat=..&lon=..&units=metric|imperial
app.get('/api/weather', validateLatLon, async (req, res) => {
  const { lat, lon } = req.query;
  const units = req.query.units === 'imperial' ? 'imperial' : 'metric';

  const cacheKey = `weather:${lat}:${lon}:${units}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius';
  const windUnit = units === 'imperial' ? 'mph' : 'kmh';
  const url =
    `${OM.forecast}?latitude=${lat}&longitude=${lon}&current=` +
    `temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,` +
    `weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,` +
    `wind_gusts_10m,visibility,uv_index,uv_index_clear_sky` +
    `&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,` +
    `precipitation,weather_code,visibility,uv_index,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,` +
    `uv_index_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max` +
    `&timezone=auto&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}` +
    `&forecast_days=8`;

  try {
    const data = await fetchJSON(url);
    setCache(cacheKey, data, 10 * 60 * 1000); // 10 min
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch weather from upstream', detail: e.message });
  }
});

// ─── Air Quality Index ───────────────────────────────────────────────────────
// Query: /api/aqi?lat=..&lon=..
app.get('/api/aqi', validateLatLon, async (req, res) => {
  const { lat, lon } = req.query;

  const cacheKey = `aqi:${lat}:${lon}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  // US AQI (aqi) + standard pollutants
  const url =
    `${OM.airQuality}?latitude=${lat}&longitude=${lon}&current=` +
    `us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide` +
    `&hourly=us_aqi&timezone=auto&forecast_days=1`;

  try {
    const data = await fetchJSON(url);
    setCache(cacheKey, data, 30 * 60 * 1000); // 30 min
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch AQI from upstream', detail: e.message });
  }
});

// ─── Weather alerts / severe weather warnings ────────────────────────────────
// Open-Meteo exposes WMO weather codes; we translate the forecast codes into
// human-readable server-side alerts (thunderstorm, rain, snow, heat, etc.).
app.get('/api/alerts', validateLatLon, async (req, res) => {
  const { lat, lon } = req.query;

  const cacheKey = `alerts:${lat}:${lon}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  const url = `${OM.alert}?latitude=${lat}&longitude=${lon}&current=weather_code,temperature_2m,uv_index,wind_speed_10m&daily=weather_code,uv_index_max,temperature_2m_max,wind_gusts_10m_max&timezone=auto&forecast_days=2&temperature_unit=fahrenheit&wind_speed_unit=mph`;

  try {
    const data = await fetchJSON(url);
    const alerts = buildAlerts(data);
    setCache(cacheKey, { alerts, generatedAt: new Date().toISOString() }, 15 * 60 * 1000);
    res.json({ alerts, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: 'Failed to fetch alerts', detail: e.message });
  }
});

const CODE = {
  thunderstorm: [95, 96, 99],
  rain: [51, 53, 55, 61, 63, 65, 80, 81, 82],
  snow: [66, 67, 71, 73, 75, 77, 85, 86],
  fog: [45, 48],
};

function describeCode(code) {
  if (CODE.thunderstorm.includes(code)) return 'Thunderstorm';
  if (CODE.rain.includes(code)) return 'Rain';
  if (CODE.snow.includes(code)) return 'Snow';
  if (CODE.fog.includes(code)) return 'Fog';
  return '';
}

function buildAlerts(data) { 
  const alerts = [];
  if (!data || !data.current) return alerts;

  const cur = data.current;

  // Thunderstorm / severe precipitation now
  const nowType = describeCode(cur.weather_code);
  if (nowType === 'Thunderstorm') {
    alerts.push(severity(cur.weather_code, 'Thunderstorm', 'Severe thunderstorms possible. Avoid open areas and unplug electronics.', 'Watch'));
  }
  if (nowType === 'Snow') {
    alerts.push({ level: 'Watch', title: 'Snow', message: 'Snow is falling. Exercise caution when travelling.', severity: 2 });
  }

  // Heat warning
  if (cur.temperature_2m >= 95) {
    alerts.push({ level: 'Warning', title: 'Heat Advisory', message: `Feeling ${Math.round(cur.temperature_2m)}F. Stay hydrated and limit time outdoors.`, severity: 3 });
  }

  // UV index warning
  if (cur.uv_index >= 8) {
    alerts.push({ level: 'Advisory', title: 'Extreme UV Index', message: `UV index is ${Math.round(cur.uv_index)}. Use sunscreen and protective clothing.`, severity: 2 });
  }

  // High wind
  if (cur.wind_speed_10m >= 39) { // ~39 mph = strong breeze
    alerts.push({ level: 'Advisory', title: 'High Winds', message: `Wind gusts up to ${Math.round(cur.wind_speed_10m)} mph. Secure loose objects.`, severity: 2 });
  }

  // Look ahead 1 day for precip risk
  const daily = data.daily;
  if (daily && daily.weather_code && daily.weather_code[1] !== undefined) {
    const tomorrowType = describeCode(daily.weather_code[1]);
    if (tomorrowType === 'Thunderstorm') {
      alerts.push({ level: 'Advisory', title: 'Tomorrow: Thunderstorms', message: 'Thunderstorms are forecast for tomorrow. Check back for updates.', severity: 1 });
    }
    if (daily.temperature_2m_max && daily.temperature_2m_max[1] >= 100) {
      alerts.push({ level: 'Warning', title: 'Extreme Heat Ahead', message: `High of ${Math.round(daily.temperature_2m_max[1])}F tomorrow. Prepare for heat.`, severity: 3 });
    }
  }

  return alerts;
}

function severity(code, title, message, base) {
  // 95,96,99 thunderstorm -> strongest
  if (code === 95 || code === 96 || code === 99) {
    return { level: 'Warning', title, message, severity: 3 };
  }
  return { level: base, title, message, severity: 1 };
}

// ─── City search (autocomplete / geocoding) ─────────────────────────────────
// Query: /api/geocode?q=London
app.get('/api/geocode', async (req, res) => {
  const q = req.query.q;
  if (!q || q.trim().length < 1) return res.json([]);

  const cacheKey = `geo:${q.toLowerCase().trim()}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  const url = `${OM.geocoding}?name=${encodeURIComponent(q.trim())}&count=6&language=en&format=json`;

  try {
    const data = await fetchJSON(url);
    const results = (data.results || []).map(r => ({
      name: r.name,
      country: r.country || '',
      admin1: r.admin1 || '',
      latitude: r.latitude,
      longitude: r.longitude,
      display: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    }));
    setCache(cacheKey, results, 60 * 60 * 1000); // 1 hour
    res.json(results);
  } catch (e) {
    res.status(502).json({ error: 'Failed geocoding', detail: e.message });
  }
});

// ─── Reverse geocode (for "use my location") ────────────────────────────────
// Query: /api/reverse?lat=..&lon=..
// Open-Meteo geocoding has no reverse lookup, so we use BigDataCloud's free
// reverse-geocode-client (no API key required).
app.get('/api/reverse', validateLatLon, async (req, res) => {
  const { lat, lon } = req.query;
  const cacheKey = `rev:${lat}:${lon}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  try {
    const data = await fetchJSON(url);
    const city = data.city || data.locality || data.principalSubdivision || '';
    const region = data.principalSubdivision || '';
    const country = data.countryName || '';
    const name = [city, country].filter(Boolean).join(', ') || 'Your location';
    const result = {
      name,
      display: [city, region, country].filter(Boolean).join(', ') || 'Your location',
    };
    setCache(cacheKey, result, 60 * 60 * 1000);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: 'Reverse geocode failed', detail: e.message });
  }
});

// ─── Radar metadata (safely proxy RainViewer tile info/search) ──────────────
// Helps the client find radar frames. We proxy to avoid CORS/front-end pitfalls.
app.get('/api/radar', async (req, res) => {
  const cacheKey = 'radar:meta';
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await fetchJSON(OM.radar);
    setCache(cacheKey, data, 5 * 60 * 1000); // 5 min
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'Radar unavailable', detail: e.message });
  }
});

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

const server = app.listen(PORT, () => {
  console.log(`Weather app server running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try a different port or kill the process using it.`);
    console.error(`  - Windows: netstat -ano | findstr :${PORT}`);
    console.error(`  - Then:    taskkill /PID <PID> /F`);
    process.exit(1);
  }
  throw err;
});
