# makefun-token-radar-20261121

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kangrisuk-id/makefun-token-radar-20261121/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kangrisuk-id/makefun-token-radar-20261121/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. From the sealed DefiLlama snapshot it ranks every
pre-token protocol — all 40 of the house watchlist plus 158 early finds
below it — by an implied value priced off the snapshot's own comparables:
each category's median market-cap/TVL among its tokenised protocols,
shrunk toward the global median by the peer count, then adjusted for
seven-day momentum, maturity and chain breadth. Wrapped, staked and
bridged products of tokens that already trade are kept off the board.
Every row carries a seven-step farm plan generated from its category,
its main chain's gas costs, its TVL and its age, and the dashboard shows
the model's working for every price: sortable and filterable board, a
detail view per protocol, the live-token set the radar sets aside, and
a method page that states the whole formula.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
