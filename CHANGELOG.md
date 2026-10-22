# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] – 2026-10-22

First public release.

### Added

- **Single-file console script:** paste it into Discord's DevTools console, no install or build step needed.
- **Supported tasks:** `WATCH_VIDEO`, `WATCH_VIDEO_ON_MOBILE`, `PLAY_ACTIVITY`, `PLAY_ON_DESKTOP` and `STREAM_ON_DESKTOP`.
- **Auto-accept:** quests that haven't been accepted yet are accepted before they are farmed.
- **Two parallel lanes:** API quests (video, activity) and desktop quests (play, stream).
- **Dashboard on the quest page:**
  - Stat tiles: Orbs, completed quests, active quests, overall progress.
  - Reward tabs plus status and task dropdowns, with counts. The selection is saved.
  - Quest rows with progress ring, reward, end date, percentage, remaining time and an action button.
  - Floating fallback panel if the page layout can't be detected.
- **Sidebar entry:** "Quests" becomes **Quest Farmer**, with an orb icon and a live badge.
- **Window title:** the title bar and the browser tab title are renamed to **Quest Farmer** on the quest page.
- **Clean page:** Discord's promo banner, promo tiles and quest grid are hidden (configurable).
- **Optional card buttons:** an **⚡ Auto farm** button on every quest card when the quest grid is shown.
- **Console API:** `window.__orbFarmer` with `getState`, `start`, `startAll`, `stop`, `stopAll`, `on` and `destroy`.
- **Safe re-run:** pasting the script again cleanly replaces the old instance. **Remove** restores Discord exactly as it was.

[1.0.0]: https://github.com/Simpleglhf/discord-quest-farmer/releases/tag/v1.0.0
