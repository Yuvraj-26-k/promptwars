# ClearSkies

**PromptWars vertical — Winter smog and urban air pollution**

ClearSkies turns local air-quality estimates into three decisions families and communities can make today. Each plan suggests a lower-exposure routine, a practical indoor air improvement, and a sustainable travel or scheduling alternative. Every action explains its expected effect on pollution exposure or emissions.

- **Families and caregivers** can adjust outdoor play and errands, set up a cleaner room, and choose a lower-emission trip. A sensitive-household setting adapts recommendations for people at greater risk from air pollution.
- **Community organizers** can adapt outdoor group activities, coordinate shared indoor spaces and trips, and share a plan with neighbors.

## Run locally

Requires Node.js 22 or later. The app has no package dependencies or build step. Run this command from the project root.

```powershell
node server.js
```

Open [ClearSkies on localhost](http://127.0.0.1:3000). To change the port, set `PORT` in `.env` or your environment before starting the server.

## Enable generative chat

For local AI, start Ollama with a chat model installed. In `.env`, set `AI_PROVIDER=ollama` and `OLLAMA_MODEL` to its installed name (for example, `gemma4:12b`), then restart ClearSkies. In this mode chat runs on your computer.

Copy `.env.example` to `.env` in the project root and set a key from **Google AI Studio** (`GEMINI_API_KEY`) or **OpenAI** (`OPENAI_API_KEY`). Restart the server. Keep the key in `.env` or the server environment. [Google AI Studio keys](https://aistudio.google.com/apikey) · [OpenAI API keys](https://platform.openai.com/api-keys)

With both keys set, OpenAI is selected by default. Set `AI_PROVIDER=gemini` or `AI_PROVIDER=openai` to choose explicitly. `GEMINI_MODEL` and `OPENAI_MODEL` override the defaults `gemini-3.5-flash-lite` and `gpt-4.1-mini`. The assistant identifies the provider that answered. The built-in guide works without a key and takes over if the provider is unavailable.

## Try ClearSkies

1. Search for your city or choose **Use my location** with browser permission. Hover or tap the 24-hour outlook, or use the slider with your keyboard, to see an hour’s estimated AQI. Choose **Pin this hour** and move to a second hour to compare. **Ask about these hours** opens the assistant with the two selected readings. The share button includes the timing comparison and suggested action in your plan.
2. Set the household and usual commute, then open **Household routines** to specify school runs, cooking, outdoor exercise, or access to an air purifier. Choose **Update plan**.
3. Choose **Adapt my plan** for a tailored walkthrough of the daily routine, indoor air improvement, and sustainable alternative. With a key configured, **Ask AI to adapt plan** uses the selected model. Try “What’s the air quality in mumbai today?” followed by “Should I move our outdoor activity indoors?” The conversation uses Mumbai while the dashboard keeps its selected location.
4. To rehearse an unhealthy-air scenario, open the location picker and choose **Try Delhi sample**. With an 8 km one-way car commute, avoiding that gasoline-car round trip saves about 4 kg of tailpipe CO₂ from that car. Choose **Return to live** when finished.

## How it works

1. **Find local air estimates.** The Node server queries Open-Meteo for the current U.S. AQI, PM₂.₅ and hourly forecast. An open, visible dashboard checks periodically. The dashboard labels earlier estimates and switches to general planning guidance during a data outage. Sample conditions require an explicit selection.
2. **Build a reproducible plan.** The rules in `plan.js` adapt to current AQI, forecast, household type, travel distance and habits. During an unhealthy spell they prioritize lower exposure. When there are at least two consecutive hours at or below AQI 150 and the window meaningfully improves on current conditions, the plan can suggest rescheduling flexible activities. It includes guidance for sensitive groups when the window is still elevated.
3. **Adapt the plan conversationally.** The configured model receives the question, recent messages, city label, household profile, plan, and usable forecast. It explains the expected effect of each choice. A built-in guide answers common questions and can summarize the full plan when the model is unavailable.

## Assumptions and limits

- Outdoor readings use gridded Copernicus CAMS model estimates for the selected city. Roadside, neighborhood, and indoor conditions can differ. Check local air-quality advisories before making decisions during severe events.
- The app uses the U.S. AQI scale across locations. PM₂.₅ is the fine-particle concentration in µg/m³. Forecasts show relative changes over the day and can change as conditions develop.
- An avoided gasoline-car round trip uses a typical U.S. EPA factor of about 0.249 kg of tailpipe CO₂ per kilometer. The calculation is twice the entered one-way distance times that factor. Actual emissions depend on the vehicle, distance, and replacement mode. Exposure effects are described qualitatively.
- Planning assumes the household can adapt at least some activities. Indoor filtration and transit options depend on local access.

## Testing, accessibility, and privacy

- Run `npm test` from the project root. The dependency-free Node test runner checks recommendation logic and server behavior with mocked upstream data, so tests run without an API key or internet connection.
- The Node server limits per-client traffic, total traffic, concurrent chat requests, and daily AI usage per process. When a provider call fails, the chat returns the built-in guide and releases the request slot.
- The interface adapts to smaller screens and provides keyboard-operable dialogs, visible focus, labeled controls, text for AQI categories, and live announcements for changing results.
- The Node server accepts localhost requests and the configured Render hostname. It keeps API keys in its environment or an ignored `.env` file. The browser remembers the selected city and household settings locally. Device coordinates are rounded before the air-data lookup and stay out of saved preferences and chat requests. Recent messages and plan context go to the selected provider only when generative chat is enabled and you ask a question.

## Sources

- City and outdoor air estimates. [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api) · [Open-Meteo air quality](https://open-meteo.com/en/docs/air-quality-api) · [Copernicus CAMS](https://atmosphere.copernicus.eu/)
- U.S. AQI categories and particle exposure guidance. [AirNow AQI basics](https://www.airnow.gov/aqi/aqi-basics/) · [AirNow particle pollution guide](https://www.airnow.gov/publications/air-quality-index/air-quality-guide-for-particle-pollution/)
- Indoor filtration and typical gasoline-car tailpipe CO₂. [EPA air cleaner guide](https://www.epa.gov/indoor-air-quality-iaq/guide-air-cleaners-home) · [EPA passenger-vehicle emissions factor](https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle)
- Reducing exhaust during school pickup. [EPA Idle-Free Schools Toolkit](https://www.epa.gov/schools/idle-free-schools-toolkit-healthy-school-environment)

## Live Application

https://promptwars-5mla.onrender.com

## Competition

PromptWars 2026 - Challenge 6: Urban Air Quality Assistant

## Key Features

- Gemini-powered personalized AI assistant
- Automatic city detection from conversations
- Location-based air quality estimates
- Hourly pollution forecasts
- Personalized low-emission daily routines
- Affordable indoor air quality recommendations
- Estimated carbon emission savings
- Offline fallback when AI is unavailable

## Technology Stack

HTML, CSS, JavaScript, Node.js, Gemini API, Open-Meteo and Render.

