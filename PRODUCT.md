# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a heavy multi-show viewer. They follow many shows and movies at once, spread across several streaming services, and they can't keep track of release dates, new seasons or which service has what. Their usual visit is checking what's out today or this week, then logging episodes as they watch them. Signed-in users land on the release calendar (`/calendar`), and alerts (email digest, premiere, trailer, streaming arrival, episode air-time push) bring them back between visits.

Secondary audiences found in the code but not prioritised: friends who follow each other's activity, and admins who moderate content and review feedback.

## Product Purpose

Release Radar tracks movies and TV for one person, down to the season and episode, and turns that tracking into a personal radar of what's coming and what's out. Success means the viewer never misses a release they care about, and keeping their lists current takes no upkeep.

## Positioning

Three things together, none of which competitors offer as a set:

- **Never miss a release:** the calendar, the alert set and iCal sync are built from the viewer's own tracked titles, not a general release feed.
- **Lists that keep themselves:** a show moves to Watched when its last episode is marked, and back to the Watchlist when a new season appears. Progress is per episode.
- **Movies, TV and friends in one place:** both media types plus the social layer, where the usual alternatives split them (Letterboxd for film, Serializd or TV Time for TV).

The tracking state is what drives the radar. That link is the claim to protect.

## Operating Context

- Used on desktop and mobile web; neither is confirmed as primary. The web app is installable as a PWA (`frontend/public/manifest.json`).
- A native SwiftUI iOS client for the same backend exists as a separate, paused project (`ReleaseRadar_iOS`). This record covers the web product.
- The calendar shows original air dates only, not reruns. The landing page tells signed-out visitors this.
- Emails (daily digest at the user's chosen local hour, premiere, trailer and streaming alerts) and the in-app notification bell are a core part of using the product, not extras.
- The live site is https://releaseradar.co.

## Capabilities and Constraints

- **Tracking:** Watchlist, Currently Watching, Watched; rewatches; finish-by goals; season and episode progress; auto-complete and auto-reactivation run on the server.
- **Discovery:** search (titles and people), trending, genres, box office, For You recommendations, collections and franchises, person pages.
- **Calendar and releases:** day-by-day release calendar, iCal feed, news for followed titles.
- **Social:** friends, activity feed, reviews, friend profiles, groups, blocking and moderation.
- **Organisation:** shelves (custom lists), favourites, import/export of watch history.
- **Stats:** watch time by genre, platform and time period.
- **Data:** metadata comes from TMDb (cached in Postgres), with OMDb and TVMaze as extra sources. Titles, posters and people are third-party data and need TMDb attribution.
- **Premium is still in beta.** Checkout is behind the `CHECKOUT_ENABLED` flag (`frontend/src/config/features.ts`) and is off. The planned pricing in `frontend/src/pages/Pricing.tsx` is $4.99/month or $39.99/year with a 7-day trial. Future work must not present paid tiers as live or available to buy.
- **Fantasy box office:** a fantasy game is planned as a monetisation differentiator. Its backend is on a separate development branch and is not part of `main`.

## Brand Commitments

- Name: "Release Radar" (PWA short name "ReleaseRadar"). The live domain is releaseradar.co.
- Existing logo and favicon assets: `frontend/public/logo-*.png`, `frontend/public/favicon-*.png`.

## Evidence on Hand

- Measured performance work (Release Radar vault note): the release calendar loads a 150-title library in 31ms instead of 957ms (123 HTTP requests became 1, 490 SQL queries became 4). The profile payload dropped from 190KB to 4.8KB. 62.5% of repeat external API calls are served from cache.
- Real catalogue content (posters, titles, trending, box office) from TMDb can stand in for imagery anywhere.
- The repository has no testimonials, user counts, reviews, press or customer logos. Future work must not invent any.

## Product Principles

1. **Your list is the source of truth.** Everything the radar shows comes from what the viewer tracks. Generic release noise is secondary.
2. **Zero upkeep.** Whenever the system can move, complete or reactivate something itself, it should. It shouldn't ask the viewer to.
3. **Timely, not noisy.** Alerts arrive once, at the right time, for things the viewer chose to follow.
4. **Honest about what's real.** Paid tiers stay labelled as beta until checkout ships, the calendar says it shows original air dates, and the product never invents social proof.
