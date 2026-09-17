/* ─── State ──────────────────────────────────────────────────────────────── */
let unit = 'metric'; // metric | imperial
let lastLat = null;
let lastLon = null;
let lastQuery = null;
let lastPlaceName = '';
let debounceTimer = null;
let map = null;
let radarLayer = null;
let radarShown = false;
let radarTimer = null;
let radarRefreshTimer = null;
const MAX_RECENT = 8;

const WMO = {
  0: '\u2600\uFE0F', 1: '\u2600\uFE0F', 2: '\u2601\uFE0F', 3: '\u2601\uFE0F',
  45: '\u{1F32B}\uFE0F', 48: '\u{1F32B}\uFE0F',
  51: '\u{1F4A7}', 53: '\u{1F4A7}', 55: '\u{1F4A7}',
  56: '\u{1F4A7}', 57: '\u{1F4A7}',
  61: '\u{1F327}\uFE0F', 63: '\u{1F327}\uFE0F', 65: '\u{1F327}\uFE0F',
  66: '\u{1F327}\uFE0F', 67: '\u{1F327}\uFE0F',
  71: '\u{1F328}\uFE0F', 73: '\u{1F328}\uFE0F', 75: '\u{1F328}\uFE0F',
  77: '\u{1F328}\uFE0F', 80: '\u{1F327}\uFE0F', 81: '\u{1F327}\uFE0F', 82: '\u{1F327}\uFE0F',
  85: '\u{1F328}\uFE0F', 86: '\u{1F328}\uFE0F',
  95: '\u26C8\uFE0F', 96: '\u26C8\uFE0F', 99: '\u26C8\uFE0F',
};
function weatherEmoji(code) { return WMO[code] || '\u2601\uFE0F'; }

function weatherLabel(code) {
  const m = {
    0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Icy fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
    77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
    85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ hail',
  };
  return m[code] || 'Cloudy';
}

function bgClass(code) {
  if (code >= 200 && code < 300) return 'bg-thunder';
  if (code >= 300 && code < 400) return 'bg-rain';
  if ((code >= 500 && code < 600) || (code >= 600 && code < 700)) {
    if (code >= 600 && code < 700) return 'bg-snow';
    return 'bg-rain';
  }
  if (code >= 700 && code < 800) return 'bg-fog';
  if (code === 800) return 'bg-sunny';
  return 'bg-cloudy';
}

function applyBackground(code) {
  const body = document.body;
  body.classList.remove('bg-sunny', 'bg-cloudy', 'bg-rain', 'bg-snow', 'bg-fog', 'bg-thunder');
  body.classList.add(bgClass(code));
}

/* ─── DOM refs ───────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const searchForm = $('search-form');
const searchInput = $('search-input');
const clearBtn = $('clear-btn');
const suggestionsEl = $('suggestions');
const geoBtn = $('geo-btn');
const unitBtn = $('unit-btn');
const menuBtn = $('menu-btn');
const dropdownMenu = $('dropdown-menu');
const recentCitiesList = $('recent-cities-list');
const dropdownUnitBtn = $('dropdown-unit-btn');
const dropdownUnitText = $('dropdown-unit-text');
const clearHistoryBtn = $('clear-history-btn');
const weatherContainer = $('weather-container');
const loadingEl = $('loading');
const errorEl = $('error');
const errorMsg = $('error-message');
const initialPrompt = $('initial-prompt');
const retryBtn = $('retry-btn');
const alertsBar = $('alerts-bar');
const radarToggle = $('radar-toggle');
const mapEl = $('map');

const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

/* ─── Units ──────────────────────────────────────────────────────────────── */
function unitSymbol() { return unit === 'metric' ? '\u00B0C' : '\u00B0F'; }
function speedUnit() { return unit === 'metric' ? 'km/h' : 'mph'; }

/* ─── Recent cities ─────────────────────────────────────────────────────── */
function getRecentCities() {
  try { return JSON.parse(localStorage.getItem('weather_recent')) || []; } catch { return []; }
}
function saveRecentCity(city) {
  let recent = getRecentCities().filter(c => c.toLowerCase() !== city.toLowerCase());
  recent.unshift(city);
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
  localStorage.setItem('weather_recent', JSON.stringify(recent));
  renderRecentCities();
}
function removeRecentCity(city) {
  localStorage.setItem('weather_recent', JSON.stringify(getRecentCities().filter(c => c.toLowerCase() !== city.toLowerCase())));
  renderRecentCities();
}
function renderRecentCities() {
  const recent = getRecentCities();
  if (!recent.length) {
    recentCitiesList.innerHTML = '<div class="dropdown-empty">No recent searches</div>';
    return;
  }
  recentCitiesList.innerHTML = '';
  for (const city of recent) {
    const div = document.createElement('div');
    div.className = 'recent-city-item';
    div.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      <span class="city-name"></span>
      <button class="remove-city" title="Remove">&times;</button>`;
    div.querySelector('.city-name').textContent = city;
    div.querySelector('.city-name').addEventListener('click', () => {
      hide(dropdownMenu);
      searchInput.value = city;
      const place = getRecentPlaces().find(p => p.name === city);
      if (place) loadWeatherByCoords(place.lat, place.lon, place.name);
      else lookupAndLoad(city);
    });
    div.querySelector('.remove-city').addEventListener('click', (e) => {
      e.stopPropagation();
      removeRecentCity(city);
    });
    recentCitiesList.appendChild(div);
  }
}
function getRecentPlaces() {
  try { return JSON.parse(localStorage.getItem('weather_recent_places')) || []; } catch { return []; }
}
function saveRecentPlace(name, lat, lon) {
  const places = getRecentPlaces().filter(p => p.name.toLowerCase() !== name.toLowerCase());
  places.unshift({ name, lat, lon });
  localStorage.setItem('weather_recent_places', JSON.stringify(places.slice(0, MAX_RECENT)));
}

/* ─── Toast ─────────────────────────────────────────────────────────────── */
function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ─── Date/time helpers ─────────────────────────────────────────────────── */
function formatTime(iso, tz) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
}
function formatDate(iso, tz) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz });
}
function formatDay(iso, tz) {
  const d = new Date(iso);
  const nowKey = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz });
  const dayKey = d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz });
  if (dayKey === nowKey) return 'Today';
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz });
}

function loadWeatherByCoords(lat, lon, placeName) {
  lastLat = lat; lastLon = lon; lastPlaceName = placeName || 'Your location';
  lastQuery = placeName || null;
  showLoading();
  Promise.all([
    fetch(`/api/weather?lat=${lat}&lon=${lon}&units=${unit}`).then(r => { if (!r.ok) throw new Error('Weather fetch failed'); return r.json(); }),
    fetch(`/api/aqi?lat=${lat}&lon=${lon}`).then(r => r.ok ? r.json() : null),
    fetch(`/api/alerts?lat=${lat}&lon=${lon}`).then(r => r.ok ? r.json() : null),
  ])
    .then(([weather, aqi, alerts]) => {
      renderCurrent(weather);
      renderHourly(weather);
      renderForecast(weather);
      renderAlerts(alerts);
      renderAQI(aqi);
      if (placeName) { saveRecentCity(placeName); saveRecentPlace(placeName, lat, lon); }
      showWeather();
    })
    .catch(err => showError(err.message));
}

async function lookupAndLoad(query) {
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const results = await res.json();
    if (!results.length) throw new Error('City not found. Check the spelling and try again.');
    const place = results[0];
    searchInput.value = place.display;
    saveRecentPlace(place.display, place.latitude, place.longitude);
    lastQuery = place.display;
    loadWeatherByCoords(place.latitude, place.longitude, place.display);
  } catch (err) {
    showError(err.message);
  }
}

async function fetchSuggestions(query) {
  if (query.length < 2) { hide(suggestionsEl); return; }
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!data.length) { hide(suggestionsEl); return; }
    suggestionsEl.innerHTML = '';
    for (const place of data) {
      const div = document.createElement('div');
      div.className = 'suggestion-item';
      div.textContent = place.display;
      div.addEventListener('click', () => {
        searchInput.value = place.display;
        hide(suggestionsEl);
        show(clearBtn);
        saveRecentPlace(place.display, place.latitude, place.longitude);
        lastQuery = place.display;
        loadWeatherByCoords(place.latitude, place.longitude, place.display);
      });
      suggestionsEl.appendChild(div);
    }
    show(suggestionsEl);
  } catch { hide(suggestionsEl); }
}

/* ─── Showing / hiding state ───────────────────────────────────────────── */
function showLoading() {
  hide(weatherContainer); hide(errorEl); hide(initialPrompt); hide(alertsBar);
  show(loadingEl);
}
function showError(msg) {
  hide(weatherContainer); hide(loadingEl); hide(initialPrompt); hide(alertsBar);
  errorMsg.textContent = msg;
  show(errorEl);
  applyBackground(800);
}
function showWeather() {
  hide(loadingEl); hide(errorEl); hide(initialPrompt);
  show(weatherContainer);
}

/* ─── Rendering: current ───────────────────────────────────────────────── */
function renderCurrent(data) {
  const cur = data.current;
  const daily = data.daily;
  $('city-name').textContent = lastPlaceName || 'Current location';
  $('date').textContent = formatDate(cur.time, data.timezone);

  document.getElementById('weather-emoji').textContent = weatherEmoji(cur.weather_code);
  $('temperature').textContent = `${Math.round(cur.temperature_2m)}${unitSymbol()}`;
  $('description').textContent = weatherLabel(cur.weather_code);

  $('high-temp').textContent = `H: ${Math.round(daily.temperature_2m_max[0])}${unitSymbol()}`;
  $('low-temp').textContent = `L: ${Math.round(daily.temperature_2m_min[0])}${unitSymbol()}`;

  // Metrics
  const vis = cur.visibility != null ? cur.visibility : 0;
  $('visibility').textContent = unit === 'metric' ? `${(vis / 1000).toFixed(1)} km` : `${(vis / 1609.344).toFixed(1)} mi`;
  $('uv-index').textContent = cur.uv_index != null ? cur.uv_index.toFixed(1) : '--';
  $('uv-cat').textContent = uvCategory(cur.uv_index);
  $('humidity').textContent = `${cur.relative_humidity_2m}%`;

  const windSpeed = cur.wind_speed_10m != null ? Math.round(cur.wind_speed_10m) : 0;
  $('wind').textContent = `${windSpeed} ${speedUnit()}`;

  $('pressure').textContent = `${Math.round(cur.surface_pressure)} hPa`;
  $('clouds').textContent = `${cur.cloud_cover}%`;

  const precip = cur.precipitation != null ? cur.precipitation : 0;
  $('precip').textContent = unit === 'metric' ? `${precip.toFixed(1)} mm` : `${(precip * 0.03937).toFixed(2)} in`;

  $('feels-like').textContent = `${Math.round(cur.apparent_temperature)}${unitSymbol()}`;

  $('sunrise').textContent = formatTime(daily.sunrise[0], data.timezone);
  $('sunset').textContent = formatTime(daily.sunset[0], data.timezone);

  applyBackground(cur.weather_code);
}

function uvCategory(v) {
  if (v == null || isNaN(v)) return '';
  if (v < 3) return 'Low';
  if (v < 6) return 'Moderate';
  if (v < 8) return 'High';
  if (v < 11) return 'Very High';
  return 'Extreme';
}

function renderAQI(data) {
  const value = data && data.current && data.current.us_aqi;
  if (value == null) {
    $('aqi-value').textContent = '--';
    $('aqi-cat').textContent = 'Unavailable';
    $('aqi-fill').style.width = '0%';
    $('aqi-cat').style.background = 'rgba(0,0,0,0.08)';
    return;
  }
  $('aqi-value').textContent = Math.round(value);
  const cat = aqiCategory(value);
  $('aqi-cat').textContent = cat.label;
  $('aqi-cat').style.background = cat.color;
  $('aqi-cat').style.color = cat.color === '#ffeb3b' ? '#333' : '#fff';
  $('aqi-fill').style.width = `${Math.min(100, value / 2)}%`;
}

function aqiCategory(v) {
  if (v <= 50) return { label: 'Good', color: '#4caf50' };
  if (v <= 100) return { label: 'Moderate', color: '#ffeb3b' };
  if (v <= 150) return { label: 'Unhealthy for sensitive', color: '#ff9800' };
  if (v <= 200) return { label: 'Unhealthy', color: '#f44336' };
  if (v <= 300) return { label: 'Very Unhealthy', color: '#9c27b0' };
  return { label: 'Hazardous', color: '#7e0023' };
}

/* ─── Rendering: alerts ────────────────────────────────────────────────── */
function renderAlerts(data) {
  alertsBar.innerHTML = '';
  if (!data || !data.alerts || !data.alerts.length) {
    hide(alertsBar);
    return;
  }
  show(alertsBar);
  for (const a of data.alerts) {
    const div = document.createElement('div');
    div.className = `alert-item ${(a.level || '').toLowerCase()}`;
    const icon = a.title.includes('Heat') ? '\u{1F525}' : a.title.includes('UV') ? '\u{1F31E}' : a.title.includes('Wind') ? '\u{1F32C}\uFE0F' : '\u26A0\uFE0F';
    div.innerHTML = `
      <span class="alert-ico">${icon}</span>
      <div><div class="alert-title">${a.title}</div><div class="alert-msg">${a.message}</div></div>
      <span class="alert-level">${a.level}</span>
      <button class="alert-close" aria-label="Dismiss">&times;</button>`;
    div.querySelector('.alert-close').addEventListener('click', () => div.remove());
    alertsBar.appendChild(div);
  }
}

/* ─── Rendering: hourly ────────────────────────────────────────────────── */
function renderHourly(data) {
  const h = data.hourly;
  const hourly = $('hourly');
  hourly.innerHTML = '';
  const n = Math.min(24, h.time.length);
  const nowIdx = 0;
  for (let i = 0; i < n; i++) {
    const time = new Date(h.time[i]);
    const code = h.weather_code[i];
    const item = document.createElement('div');
    item.className = 'hour-item' + (i === nowIdx ? ' is-now' : '');
    const timeLabel = i === 0 ? 'Now' : time.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true, timeZone: data.timezone });
    const pop = h.precipitation_probability ? h.precipitation_probability[i] : null;
    item.innerHTML = `
      <div class="h-time">${timeLabel}</div>
      <div class="h-emoji">${weatherEmoji(code)}</div>
      <div class="h-temp">${Math.round(h.temperature_2m[i])}${unitSymbol()}</div>
      ${pop != null ? `<div class="h-pop">${pop}%</div>` : ''}`;
    hourly.appendChild(item);
  }
}

/* ─── Rendering: 7-day forecast ────────────────────────────────────────── */
function renderForecast(data) {
  const d = data.daily;
  const container = $('forecast');
  container.innerHTML = '';
  // Build temperature range min/max across days for consistent bar width
  const mins = d.temperature_2m_min;
  const maxs = d.temperature_2m_max;
  const allMin = Math.min(...mins);
  const allMax = Math.max(...maxs);
  const span = allMax - allMin || 1;

  for (let i = 0; i < d.time.length && i < 7; i++) {
    const row = document.createElement('div');
    row.className = 'forecast-row';
    const pop = d.precipitation_probability_max ? d.precipitation_probability_max[i] : null;
    const left = ((mins[i] - allMin) / span) * 100;
    const width = ((maxs[i] - mins[i]) / span) * 100;
    row.innerHTML = `
      <div class="fc-day">${formatDay(d.time[i], data.timezone)}</div>
      <div class="fc-emoji">${weatherEmoji(d.weather_code[i])}</div>
      <div class="fc-cond">${weatherLabel(d.weather_code[i])}</div>
      ${pop != null ? `<div class="fc-pop">${pop}%</div>` : ''}
      <div class="fc-temp-range">
        <span class="fc-low">${Math.round(mins[i])}${unitSymbol()}</span>
        <div class="range-bar"><span style="left:${left}%;width:${Math.max(width, 4)}%"></span></div>
        <span class="fc-high">${Math.round(maxs[i])}${unitSymbol()}</span>
      </div>`;
    container.appendChild(row);
  }
}

/* ─── Radar map ────────────────────────────────────────────────────────── */
async function toggleRadar() {
  if (lastLat === null || lastLon === null) {
    showToast('Search a city or use your location first');
    return;
  }
  if (radarShown) {
    if (radarLayer) radarLayer.remove();
    radarLayer = null;
    clearInterval(radarTimer);
    radarTimer = null;
    clearInterval(radarRefreshTimer);
    radarRefreshTimer = null;
    hide(mapEl);
    radarToggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>Show Radar`;
    radarShown = false;
    return;
  }
  show(mapEl);
  radarToggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="5" x2="19" y2="19"/><circle cx="11" cy="11" r="8"/></svg>Hide Radar`;
  radarShown = true;
  if (!map) initMap();
  await loadRadarFrames();
  // Refresh the frame list every 5 min (animation timer is managed inside loadRadarFrames)
  clearInterval(radarRefreshTimer);
  radarRefreshTimer = setInterval(loadRadarFrames, 5 * 60 * 1000);
}

function initMap() {
  const lat = lastLat != null ? lastLat : 20;
  const lon = lastLon != null ? lastLon : 0;
  map = L.map('map').setView([lat, lon], 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.on('click', () => { /* allow free pan/zoom */ });
}

async function loadRadarFrames() {
  if (!lastLat || !lastLon) return;
  try {
    const res = await fetch('/api/radar');
    const meta = await res.json();
    const host = meta.host;
    if (!host || !meta.radar) {
      throw new Error('No radar data');
    }
    const past = meta.radar.past || [];
    const now = meta.radar.nowcast || [];
    if (past.length === 0 && now.length === 0) return;

    // Animate through frames (past + nowcast)
    const frames = [...past.slice(-8), ...now];
    let idx = 0;
    showRadarFrame(host, frames[0].path, frames[0].time);
    clearInterval(radarTimer);
    radarTimer = setInterval(() => {
      idx = (idx + 1) % frames.length;
      showRadarFrame(host, frames[idx].path, frames[idx].time);
    }, 700);
  } catch (e) {
    showToast('Radar unavailable right now');
  }
}

function showRadarFrame(host, path, time) {
  if (radarLayer) radarLayer.remove();
  const tileUrl = `${host}${path}/256/{z}/{x}/{y}/0/0_0.png`;
  radarLayer = L.tileLayer(tileUrl, {
    opacity: 0.6,
    attribution: 'Radar &copy; <a href="https://www.rainviewer.com/">RainViewer</a>',
    maxNativeZoom: 6,
  }).addTo(map);
}

/* ─── Geolocation ──────────────────────────────────────────────────────── */
function useMyLocation() {
  if (!navigator.geolocation) {
    showError('Geolocation is not supported by your browser.');
    return;
  }
  showToast('Locating you\u2026');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        const res = await fetch(`/api/reverse?lat=${latitude}&lon=${longitude}`);
        const place = await res.json();
        loadWeatherByCoords(latitude, longitude, place.display);
      } catch {
        loadWeatherByCoords(latitude, longitude, 'Your location');
      }
    },
    () => showError('Location access denied. Please search for a city instead.')
  );
}

/* ─── Keyboard shortcuts ───────────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Escape') { searchInput.blur(); hide(suggestionsEl); hide(dropdownMenu); }
    return;
  }
  if (e.key === '/') { e.preventDefault(); searchInput.focus(); }
  else if (e.key === 'Escape') { hide(dropdownMenu); hide(suggestionsEl); }
  else if (e.key === 'g' || e.key === 'G') { useMyLocation(); }
});

/* ─── Event listeners ──────────────────────────────────────────────────── */
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  hide(suggestionsEl);
  lookupAndLoad(query);
});

searchInput.addEventListener('input', () => {
  const val = searchInput.value.trim();
  val ? show(clearBtn) : hide(clearBtn);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fetchSuggestions(val), 300);
});
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim().length >= 2) show(suggestionsEl);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrapper')) hide(suggestionsEl);
  if (!e.target.closest('.dropdown-wrapper')) hide(dropdownMenu);
});
clearBtn.addEventListener('click', () => {
  searchInput.value = ''; hide(clearBtn); hide(suggestionsEl); searchInput.focus();
});
geoBtn.addEventListener('click', useMyLocation);

unitBtn.addEventListener('click', () => {
  unit = unit === 'metric' ? 'imperial' : 'metric';
  unitBtn.textContent = dropdownUnitText.textContent = unit === 'metric' ? '\u00B0C' : '\u00B0F';
  showToast(`Switched to ${unit === 'metric' ? 'Celsius' : 'Fahrenheit'}`);
  if (lastLat !== null && lastLon !== null) loadWeatherByCoords(lastLat, lastLon, lastPlaceName);
});

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (dropdownMenu.classList.contains('hidden')) { renderRecentCities(); show(dropdownMenu); }
  else hide(dropdownMenu);
});
dropdownUnitBtn.addEventListener('click', () => { unitBtn.click(); hide(dropdownMenu); });
clearHistoryBtn.addEventListener('click', () => {
  localStorage.removeItem('weather_recent');
  localStorage.removeItem('weather_recent_places'); 
  renderRecentCities();
  showToast('Search history cleared'); 
  hide(dropdownMenu); 
});
retryBtn.addEventListener('click', () => {
  if (lastLat !== null && lastLon !== null) loadWeatherByCoords(lastLat, lastLon, lastPlaceName);
  else if (lastQuery) lookupAndLoad(lastQuery);
  else { hide(errorEl); show(initialPrompt); }
});
radarToggle.addEventListener('click', toggleRadar);

/* ─── Init ─────────────────────────────────────────────────────────────── */
renderRecentCities();