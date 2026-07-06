# TIFO ⚽

> A football prediction market with no server. The swarm is the exchange, the crowd is
> the oracle, every fan holds their own keys. Pears (P2P) + QVAC (local AI) + WDK
> (self-custodial USDt) — Tether Developers Cup entry.

A *tifo* is the giant display made by thousands of fans each holding one card — no
single fan holds the picture. TIFO is a market built the same way: every peer holds one
append-only log; the market only exists in the crowd.

**Status:** in build (hackathon). Docs: [scope](docs/SCOPE.md) · [spec](docs/BUILD_SPEC.md) · [sprints](docs/SPRINTS.md)

## Prior work declaration

The pure parimutuel payout math is ported from [Hunch](https://www.playhunch.xyz)
(my prediction-market venue, settling real money on Base since June 2026). Everything
else — the P2P protocol, crowd oracle, QVAC/WDK integration, netting, app — is built
during the event.

## License

MIT
