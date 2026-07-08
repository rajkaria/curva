# Demo script (≤ 3-minute video)

Three devices on camera: two laptops + one phone. A real (or replayed) match on a
TV in the background. Backup: `npm run demo` runs the whole flow headless, so the
live pitch can never be killed by venue Wi-Fi.

| Time | Beat | On screen |
|---|---|---|
| 0:00–0:20 | **Hook.** "This is a prediction market with no server. Watch." | Laptop A: `pear run apps/terrace` → open a terrace for tonight's match → invite key |
| 0:20–0:50 | **Join & trade.** | Phone + Laptop B join; three bets land; pool odds shift live on all three screens |
| 0:50–1:20 | **💀 THE MOMENT. Close Laptop A — the machine that *created* the market.** | Phone + Laptop B keep trading, odds keep moving. Caption: "There is no host. There is nothing to shut down." |
| 1:20–2:00 | **The crowd oracle.** Goal on the TV → phone's QVAC transcript highlights "GOAL — 2–1" heard *locally, offline* → full-time attestation pre-filled → two taps → quorum bar fills → RESOLVED |
| 2:00–2:40 | **Settlement.** Manifest → netted to two transfers → debtor taps → WDK-signed USDt transfers → txids appear as receipts on every screen → "everyone's square ✓" (show the explorer link) |
| 2:40–3:00 | **Zoom out.** The Gaffer cracks a joke; chat shows PT→EN→HI live translation; card: *"Polymarket needs AWS, an oracle company, and a custodian. Curva needs two phones."* |

## The one-command backup

```bash
npm install && npm run demo
```

Prints the full narrated pipeline — derive → terrace → trade → **kill host** →
lock → ASR attest → resolve → net → settle → receipts → *everyone's square* —
using the real packages with no network, no Pear, no funded wallet. If the venue
Wi-Fi dies, this is the demo. (Fittingly, Curva barely needs Wi-Fi — LAN mode
*is* the backup.)
