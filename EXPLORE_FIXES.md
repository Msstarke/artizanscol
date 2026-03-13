# Explore & Discovery Fixes

## Filter Issues
- [x] 1. `search` vs `q` param mismatch — URL writes `search` but backend expects `q`
- [x] 2. Location filter uses exact match — changed to contains check
- [x] 3. Medium filter case-sensitive — now case-insensitive

## Filter UI
- [x] 4. No active filter indicator on mobile — N/A, no collapsible panel exists; filter chips handle this
- [x] 5. Price filter — added AUD label, max, and step attributes

## Empty States
- [x] 6. "No live profiles" state — removed sign-in link, now links to About + profile preview
- [x] 7. Discovery insight cards — replaced "0" values with "Coming / Open" when no live artists

## Artist Cards
- [x] 8. `artist.portfolio` null guard — now defaults to empty array before access
- [x] 9. Rating slot — shows "—" when no reviews instead of "New"
- [x] 10. Metrics row — review/momentum items only render when they have real values

## Sort
- [x] 11. Sort values — aligned to `"most_popular"` / `"highest_rated"` in both HTML and JS

## Discovery Insights
- [x] 12. Insight cards — now reflect current filtered view, not all live artists
