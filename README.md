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

Copy `.env.example` to `.env`, add your `OPENAI_API_KEY`, and restart the server. `OPENAI_MODEL` is optional and defaults to `gpt-4.1-mini`. The **Ask AI** panel labels replies as **AI response** or **Offline guide**. The built-in guide works with an unset key and takes over if the model provider is unavailable.

## Try the demo

1. Start in Delhi and review the current U.S. AQI, PM₂.₅ concentration, and 24-hour trend.
2. Set the household to **Family with children**, the commute to **Private car**, and the one-way distance to **8 km**. Choose **Update plan**. In the labeled Delhi sample, AQI 178 gives an unhealthy-air plan. Avoiding this 16 km gasoline-car round trip saves about 4 kg of tailpipe CO₂ from that car.
3. Switch to **Community group** to see how activity and indoor-air suggestions adapt. Try **Ask AI** and ask “What should we change for an outdoor community event?” Use **Share plan** to share the recommendations.
4. Search for another city and compare plans. A short list of cities remains available offline. With unavailable estimates, Delhi shows a labeled sample and other cities show general guidance.

## How it works

1. **Find the city and its air forecast.** The local Node server proxies Open-Meteo city search and retrieves current U.S. AQI, PM₂.₅, and hourly outdoor estimates for the selected location.
2. **Generate a reproducible plan.** The rules in `plan.js` use AQI severity, household type, commute, and one-way distance to build three recommendations. For example, on unhealthy days the plan shifts strenuous activities indoors, limits particle exposure, and suggests alternatives to optional car trips or strenuous travel. The same inputs produce the same plan.
3. **Answer follow-up questions.** When configured, the server sends the question, recent chat messages, and selected city, profile, and plan to the OpenAI Responses API. The instructions ground answers in the supplied context, distinguish exposure from tailpipe emissions, and keep medical guidance general.

## Assumptions and limits

- Outdoor readings use gridded Copernicus CAMS model estimates for the selected city. Roadside, neighborhood, and indoor conditions can differ. Check local air-quality advisories before making decisions during severe events.
- The app uses the U.S. AQI scale across locations. PM₂.₅ is the fine-particle concentration in µg/m³. Forecasts show relative changes over the day and can change as conditions develop.
- An avoided gasoline-car round trip uses a typical U.S. EPA factor of about 0.249 kg of tailpipe CO₂ per kilometer. The calculation is twice the entered one-way distance times that factor. Actual emissions depend on the vehicle, distance, and replacement mode. Exposure effects are described qualitatively.
- Planning assumes the household can adapt at least some activities. Indoor filtration and transit options depend on local access.

## Testing, accessibility, and privacy

- Run `npm test` from the project root. The dependency-free Node test runner checks recommendation logic and server behavior with mocked upstream data, so tests run without an API key or internet connection.
- The interface adapts to smaller screens and provides keyboard-operable dialogs, visible focus, labeled controls, text for AQI categories, and live announcements for changing results.
- The server listens on loopback and keeps the API key in its environment or an ignored `.env` file. Request validation, input limits, and upstream timeouts bound API calls. The browser stores the selected city and settings locally. Chat history stays in page memory, with recent messages sent to OpenAI when generative chat is enabled.

## Sources

- City and outdoor air estimates. [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api) · [Open-Meteo air quality](https://open-meteo.com/en/docs/air-quality-api) · [Copernicus CAMS](https://atmosphere.copernicus.eu/)
- U.S. AQI categories and particle exposure guidance. [AirNow AQI basics](https://www.airnow.gov/aqi/aqi-basics/) · [AirNow particle pollution guide](https://www.airnow.gov/publications/air-quality-index/air-quality-guide-for-particle-pollution/)
- Indoor filtration and typical gasoline-car tailpipe CO₂. [EPA air cleaner guide](https://www.epa.gov/indoor-air-quality-iaq/guide-air-cleaners-home) · [EPA passenger-vehicle emissions factor](https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle)
