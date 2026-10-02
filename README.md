# Apex

Apex is a cross-platform sports companion built with Expo and React Native. It brings live scores, game context, player and team analysis, configurable in-game views, and experimental fan features into one mobile-first experience.

The project currently focuses on college basketball and baseball, with additional professional basketball data and a WNBA practice-currency player market.

## Highlights

- Live and upcoming game boards with date and conference filters
- In-game court, play-by-play, comments, team stats, previews, and betting views
- Player and team profiles with game logs, trends, and APEX ratings
- AI-assisted matchup previews, recaps, player bios, and highlight summaries
- Multi-game viewing and customizable in-game tab/section layouts
- Favorite-team themes, profile preferences, and prediction history
- Betting watchlists, tracked bets, fair-probability views, and EV tools
- WNBA player market using virtual practice currency only—no real-money trading
- Shared loading, error, caching, navigation, and design-system primitives

## Tech Stack

- [Expo](https://expo.dev/) 54 and [Expo Router](https://docs.expo.dev/router/introduction/)
- React 19 and React Native 0.81
- TypeScript
- React Navigation and React Native Reanimated
- Async Storage for local persistence
- D3 Shape and React Native SVG for charts and data visualization
- Optional Express and SQLite API service under `apps/api`

## Getting Started

### Prerequisites

- Node.js 20 or newer
- npm
- Expo Go or a native development build for device testing
- Android Studio or Xcode when running a native emulator/simulator

### Install

```bash
git clone https://github.com/alexlystad/college-basketball-app.git
cd college-basketball-app
npm install
```

### Configure the environment

Create a local `.env` file in the project root:

```dotenv
# Use "local" for a server on your network or "tunnel" for a public URL.
EXPO_PUBLIC_API_MODE=local

# Required when local auto-detection does not resolve the correct address.
EXPO_PUBLIC_LOCAL_API_URL=http://YOUR_LAN_IP:4000

# Used when EXPO_PUBLIC_API_MODE=tunnel.
EXPO_PUBLIC_API_URL=https://YOUR_API_URL

# Optional: enables AI-assisted content during development.
EXPO_PUBLIC_OPENAI_API_KEY=
```

Restart Expo with a cleared cache after changing any `EXPO_PUBLIC_*` value because Expo embeds these values in the client bundle.

> [!CAUTION]
> Variables prefixed with `EXPO_PUBLIC_` are visible in the compiled app. Do not ship a production OpenAI secret in the client; proxy AI requests through a trusted backend instead.

### Run the app

```bash
npm run dev:mobile
```

Then open the project in Expo Go, an emulator, or a development build. Other useful targets:

```bash
npm run android
npm run ios
npm run web
npm run dev:mobile:clean
npm run dev:mobile:tunnel
```

## Local API

Live data features expect a compatible API on port `4000` unless another URL is configured.

```bash
npm install --prefix apps/api
npm run dev:api
```

The API package currently expects compiled output at `apps/api/dist/server.js`. Its TypeScript service layer is still under active development, so backend build/runtime work may be required when setting up a fresh clone.

## Useful Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start Expo on the LAN |
| `npm run dev:mobile:clean` | Clear Metro's cache and start Expo |
| `npm run dev:mobile:tunnel` | Start Expo through a tunnel |
| `npm run dev:api` | Start the local API package |
| `npm run fit:win-impact` | Fit win-impact rating weights |
| `npm run check:baseball-impact` | Run the baseball impact sanity check |

## Project Structure

```text
app/                 Expo Router screens and route layouts
apps/api/            Optional Express/SQLite API service
apps/mobile/         Reusable mobile design and rating modules
assets/              Fonts and image assets
components/          Shared UI and feature components
hooks/               Live-game and navigation hooks
scripts/             Development, tunnel, and rating utilities
src/features/        Basketball, baseball, betting, recap, and market logic
src/lib/             Rating engines and lineup inference
src/profile/         Local profile and prediction state
src/settings/        Theme and layout preferences
src/theme/           App theme tokens
```

## Development Notes

- The application uses file-based routing through Expo Router.
- The root route redirects to the live-games screen.
- Local preferences and practice portfolios are stored on the device.
- Generated bundles, local databases, API logs, recovery artifacts, and `.env` files are intentionally excluded from Git.
- The project is under active development; some backend TypeScript issues are documented in `progress.md`.

## License

No license has been added yet. All rights are reserved unless the repository owner states otherwise.
