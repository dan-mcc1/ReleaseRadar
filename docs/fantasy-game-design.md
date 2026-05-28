# Fantasy Box Office Game — Design Doc

A season-long fantasy game where players draft movies and TV shows, then compete based on real-world performance. Inspired by Hollywood Stock Exchange (HSX), adapted as the differentiating feature for ReleaseRadar.

## Why this exists

Tracking apps (Trakt, Simkl, TV Time) all do roughly the same thing for free. ReleaseRadar needs a reason to choose it. The fantasy game is that reason — none of the competitors have it, HSX shut down in 2024 leaving a market gap, and it provides the daily/weekly return hook that pure tracking apps lack.

## Game format

### Seasons

**4 seasons per year**, each ~3 months, tied to natural release windows:

| Season | Months | Theme |
|---|---|---|
| Summer | May–Aug | Summer blockbusters |
| Fall | Sep–Nov | Awards contenders |
| Holiday | Nov–Jan | Holiday tentpoles |
| Spring | Feb–Apr | Spring releases |

Shorter than a 6-month season — keeps draft picks closer to release dates, reduces dead-time on far-future picks, gives players 4 chances per year to win.

### Format: season-long ROI race

**Not** head-to-head matchups. Standings update weekly, but there's no "I play Mike this week." The leaderboard moves constantly because other players' releases push you up or down even when nothing of yours dropped. Movies/TV release on an uneven calendar — forcing a weekly head-to-head format onto that creates broken, lopsided matchups (e.g. someone with an Avengers pick auto-wins their week).

Weekly engagement comes from waiver bidding, trades, lineup decisions, and weekly side competitions — not from forced head-to-head.

### Leagues

**Private leagues only** for v1. Invite friends, 8–12 people typical. The social pressure ("Mike will roast me if I drop out") does the engagement work. Public leagues / global leaderboards can come later.

## Draft

### Auction-style

Each player gets a **$200 fantasy budget**. Everyone bids on movies/shows. Tentpole assets cost more, sleepers cost less. Salary cap math forces diversification — you physically can't stack all the blockbusters.

Crucially, auction price is *not* used in scoring. It's only for draft positioning. Scoring is based on actual industry ROI (see below). This means the auction is a market mechanism — players collectively price assets based on their expectations — and scoring rewards correctly identifying mispriced assets (e.g. sleepers everyone undervalued).

### Roster requirements

Minimum 8 assets:
- 4 movies
- 3 TV shows
- 1 flex slot (movie or TV)

Required mix prevents "all blockbusters, no TV" rosters from working — TV is necessary to survive dry box office weeks.

## Weekly engagement loop

The natural rhythm of the week, mirroring how movies/TV actually release:

| Day | Event |
|---|---|
| **Friday** | New movies open, new episodes drop. Live scoring updates. |
| **Sat–Sun** | Box office weekend. Live updates as numbers come in. |
| **Monday** | Weekend results final. Standings update. Push notification: "you moved up X spots / down Y." |
| **Tue–Thu** | Waiver window opens. Drop/add. Trade discussions. |

### Weekly mechanics

- **Waiver bidding** — Unused auction budget + a small rolling weekly allowance accumulates. Use it to bid on undrafted assets (surprise hits, sleepers that emerged). FAAB-style blind bids.
- **Trades** — Between league members. "I'll send you my Avengers pick for your Severance + a sleeper."
- **Lineup decisions** — Limited "boost slots" each week amplify scoring on chosen active assets. Creates a decision every week even if your roster is unchanged.
- **Weekly side competitions** — Mini-trophies for biggest mover, best waiver pickup, smartest trade, etc. Don't affect overall standing but give weekly "wins" and recognition.
- **News reactions** — Trailer drops, casting changes, review embargoes lifting all drive waiver/trade activity.

## Scoring system

### Core principle: scoring branches by asset type

The single hardest problem: theatrical movies, streamer movies, and TV series can't share one scoring formula because the data available for each is different. A theatrical wide release has box office. A Netflix original has neither budget nor reliable revenue. TV has neither.

Three scoring tracks produce comparable point totals.

### Theatrical movies (ROI-driven)

ROI = Box office ÷ production budget.

**Continuous base:**
- 10 pts per 1x ROI
- Capped at 10x for scoring purposes (prevents a $5M horror movie at 100x ROI from breaking the league)
- Below 1x: floor penalty −50

**Milestone bonuses:**
- 2x ROI: +15
- 5x ROI: +30
- 10x ROI: +50
- (No higher milestones — keeps sleeper variance bounded)

**Modifiers:**
- #1 opening weekend: +30
- Weeks at #1: +10 per week
- Rotten Tomatoes ≥90%: +20 (critical hit)
- Rotten Tomatoes ≤30%: −15 (critical bomb)
- CinemaScore A or A+: +15

**Settlement:** ~60% of points settle on opening weekend, ~40% at end of theatrical run.

### Streamer movies (charts + reception)

No reliable ROI data (budgets undisclosed, no box office). Score on:

- Top 10 streaming charts: +20 per week in top 10, +40 per week at #1
- Critical scores (RT/Metacritic thresholds): tier bonuses (≥90%: +20, ≥80%: +10)
- Audience scores (TMDb vote_average, IMDB): tier bonuses (≥8.0: +15, ≥7.0: +5)
- Awards nominations during scoring window: +15 each
- Awards wins: +50

### TV series (episode-by-episode + season-end + renewal)

- **Per-episode aired:** +15 base
- **Ratings modifier per episode:** +5 if IMDB ≥8.5 or RT ≥90% that week
- **Premiere episode bonus:** +25
- **Finale episode bonus:** +25
- **Streaming chart presence:** +10 per week in top 10
- **Season completion bonus:** +50 when the season finishes within the scoring window
- **Renewal bonus:** +75 if officially renewed during the season *(big — drives long-game thinking)*
- **Cancellation penalty:** −50
- **Awards nominations:** +15 each
- **Awards wins:** +50

### Cross-cutting bonuses (all asset types)

- Trending #1 of the week (TMDb popularity): +20
- Top 5 trending of the week: +10

### Settlement events

Some events are settlement events — points lock in:
- Movie's theatrical run ends → final ROI calculated
- TV season finale airs → completion bonus locked in
- Renewal/cancellation announced → bonus/penalty locked in

Gives the season a satisfying rhythm: weekly accumulation + occasional big settlements that shake up standings.

## Worked example: Summer 2024

Sample roster ($200 auction budget, mixed strategy):

| Asset | Type | Auction | Score |
|---|---|---|---|
| Deadpool & Wolverine ($200M → $1.34B, 6.7x) | Movie | $55 | 162 |
| Twisters ($155M → $370M, 2.4x) | Movie | $20 | 69 |
| It Ends With Us ($25M → $351M, 14x) — sleeper | Movie | $8 | 240 |
| Borderlands ($110M → $33M, 0.3x) — flop | Movie | $20 | −65 |
| Strange Darling ($5M → $11M, 2.2x) | Movie | $3 | 57 |
| House of the Dragon S2 | TV | $40 | 315 |
| Bridgerton S3 | TV | $25 | 260 |
| The Acolyte (cancelled) | TV | $15 | 160 |
| Filler TV pick | TV | $14 | 0 |
| **Total** | | **$200** | **1,198** |

### Alternative: "Safe Blockbusters" strategy

| Asset | Auction | Score |
|---|---|---|
| Inside Out 2 (8.5x) | $75 | 210 |
| Despicable Me 4 (9.7x) | $30 | 182 |
| Deadpool & Wolverine | $55 | 162 |
| Twisters | $15 | 69 |
| Cheap flier (didn't pop) | $5 | 0 |
| Bridgerton S3 | $15 | 260 |
| Two cheap TV picks | $5 | 30 |
| **Total** | **$200** | **913** |

### Meta health

Three viable archetypes with different risk profiles:

- **Diversified + sleeper hunting** → highest ceiling, moderate floor. Wins most seasons.
- **All blockbusters** → solid floor, lower ceiling. Wins when sleepers all miss.
- **All lottery tickets** → highest variance. Spectacular when it hits, brutal when it doesn't.

Expected season totals: league winner ~1,400–1,600, last place ~800–900. Healthy spread.

## Data sources

What's available and what'll be hard:

| Data | Source | Difficulty |
|---|---|---|
| Box office | TMDb revenue / The Numbers | Medium — TMDb updates slowly, sometimes incomplete |
| Movie budget | TMDb | Easy for theatrical, **missing for most streamer originals** |
| Critic scores (RT, Metacritic) | OMDb | Easy |
| Audience scores | TMDb vote_average, OMDb | Easy |
| Streaming Top 10 | Nielsen (paid), JustWatch (scrapable), Netflix Top 10 (public) | **Hard — scraping required** |
| TV renewals & cancellations | News events, no clean API | **Hard — manual entry or scrape Deadline/Variety** |
| Awards | Manual or scraping post-event | Medium |

**Two infrastructure problems to solve before building:**

1. **Renewal/cancellation tracking** — No clean API. Options: league admin marks events manually, scrape industry trade RSS feeds, or use a paid news service. This is one of the best mechanics in the game, but it requires figuring out the data pipeline.

2. **Streaming charts** — Nielsen has it but it's a paid product. JustWatch trending is scrapable. Netflix publishes its own Top 10. Need to decide what's authoritative before scoring depends on it.

## Open questions

- **Should negative scores have a floor?** Currently Borderlands cost −65. Three flops could net a player ~−200 and effectively eliminate them. A floor at −30 per asset would be more forgiving for casual leagues. Worth testing.
- **Public leagues / global leaderboard for v2?** Private-only is right for v1, but a global "everyone in the world drafted the same season" mode could be a big acquisition driver later.
- **Trade vetoes / commissioner controls?** Standard fantasy stuff. League admin can veto lopsided trades. Probably needed.
- **What's the draft format?** Auction is decided, but real-time live auction (everyone online together) vs. async slow auction (nominations over a few days) is a UX question. Real-time is more fun but harder to coordinate.
- **Should auction price feed back into scoring at all?** Currently it doesn't — scoring is pure industry ROI. An alternative is "your roster score is divided by total auction spend" so frugal drafts get a multiplier. Adds complexity but rewards bargain hunting more.

## Monetization fit

This is the differentiator that justifies a paywall. Possible free vs. premium split:

**Free:**
- Play in one league
- Standard scoring
- Basic roster management

**Premium:**
- Create/host multiple private leagues
- Advanced league commissioner controls
- Detailed scoring breakdowns / analytics
- Season-long stats and history
- (Optional) custom league rules

This pairs with the existing paywall ideas (iCal sync, daily digest, etc.) — the fantasy game is the *headline* premium feature; the others are supporting features.

## Build phases (rough)

**Phase 1 — MVP single-league prototype**
- Hardcoded scoring rules
- One league, one season
- Manual data entry where APIs are weak (renewals, charts)
- Goal: prove the game is fun before investing in infrastructure

**Phase 2 — Multi-league + automation**
- Auction draft UI
- Multi-league support
- Automated data pipelines for box office, ratings, charts
- Weekly notifications

**Phase 3 — Polish + monetization**
- Premium league features
- Advanced stats and history
- Public leagues / global leaderboard (maybe)
- Trade machine, commissioner tools
