# Weather App — Build Notes

A simple record of the order I built this app, written for beginners.

## What the app does
- Shows current weather, an hourly forecast, and a 7-day outlook
- Has a backend server that fetches weather data and sends it to the page
- Extra features: geolocation, AQI, radar map, weather alerts, °C/°F toggle

## The big picture (2 parts)
1. **Backend** (`server.js`) — is like a kitchen: it takes orders from the
   browser, cooks the data (fetches from free weather APIs), and serves it.
2. **Frontend** (`public/`) — is like the dining area: the HTML page, the CSS
   styling, and the JavaScript that talks to the backend and shows the data.

---

## The steps I followed

### 1. Planned the features and stack
- Listed everything wanted: weather, radar, AQI, alerts, geolocation, unit toggle
- Chose free data sources that need **no API key** (Open-Meteo, RainViewer, BigDataCloud)
- Chose Node.js + Express for the backend (no build step, easy to run)
- Picked Leaflet for the interactive radar map

### 2. Created the backend files first
- `package.json` — told Node which libraries (dependencies) the app needs
- Ran `npm install` — downloaded Express so the server could use it

### 3. Built the backend server (`server.js`)
- Set up an Express server that also serves the frontend files (static files)
- Added a **weather endpoint** (`/api/weather`) that asks Open-Meteo for:
  current weather, hourly data, and 8-day forecast (all in one request)
- Added an **AQI endpoint** (`/api/aqi`) for air quality from Open-Meteo
- Added an **alerts endpoint** (`/api/alerts`) that turns weather codes into
  human-friendly warnings (heat, thunder, high wind, UV) server-side
- Added **geocoding endpoint** (`/api/geocode`) to turn a city name into
  coordinates (used for search and suggestions)
- Added **reverse-geocoding endpoint** (`/api/reverse`) to turn coordinates
  into a city name (used for "use my location")
- Added a **radar endpoint** (`/api/radar`) that proxies RainViewer radar data
- Added a small **cache** so repeated requests don't hit the API every time
- Added a `/api/health` check to confirm the server is alive

### 4. Built the frontend page (`public/index.html`)
- Header: search bar, geolocation button, unit toggle, menu
- Current weather panel: big temperature, condition, high/low
- AQI gauge
- A grid of detailed metrics: visibility, UV, humidity, wind, pressure,
  cloud cover, precipitation, feels-like, sunrise, sunset
- Hourly forecast strip and 7-day outlook list
- Radar map panel (with a "Show Radar" button)
- Loading, error, and first-visit prompt states

### 5. Styled it (`public/style.css`)
- Clean card-based layout with rounded panels
- **Animated weather backgrounds**: background changes with the condition
  - sunny → yellow scene with rotating sun rays
  - rainy → dark scene with falling rain animation
  - cloudy / fog / snow / thunder → different colours and effects
- Styled all panels, buttons, dropdowns, and made it responsive

### 6. Wrote the frontend logic (`public/script.js`)
- Search flow: type → suggestions → click/enter → load weather
- Unit toggle: switches °C/°F and reloads the data
- Geolocation: asks the browser for position → reverse geocodes → loads weather
- Renders current weather, metrics, AQI, alerts, hourly, and 7-day forecast
- Weather codes → emoji + label mapping
- Recent cities saved in localStorage

### 7. Integrated the radar map
- Included Leaflet library via CDN in the HTML
- On "Show Radar": creates the map, centers it on the chosen location
- Fetches radar frame list from the backend, then animates through frames
- Radar refreshes every 5 minutes

### 8. Connected frontend to backend
- Frontend only ever calls local paths like `/api/weather?lat=..&lon=..`
- The browser never talks to the weather APIs directly — the server does,
  so it's safer and faster (caching)

### 9. Tested everything
- `node --check` on the JavaScript files to catch syntax errors
- Started the server and hit every endpoint to confirm real data comes back
- Verified the radar tile URL actually returns radar images
- Confirmed the page and CSS/JS load with 200 status

---

## Nice problems I hit along the way (and fixes)

1. **Reverse geocoding** — the chosen weather API (Open-Meteo) doesn't do
   reverse lookups. Fix: added BigDataCloud (free, no key).
2. **Radar 404** — the RainViewer URL was wrong. Fix: used their correct
   metadata endpoint `api.rainviewer.com/public/weather-maps.json`.
3. **Wrong units in alerts** — alert thresholds were in mph but data came in
   km/h. Fix: requested `wind_speed_unit=mph` in the alert API call.
4. **Invalid emoji escapes** — wrote `\U+1F...` which isn't valid JavaScript.
   Fix: switched to proper `\u{1F...}` unicode syntax.

## How to run it
1. `npm install` (only the first time)
2. `npm start`
3. Open http://localhost:8080 in a browser