# Quorum

**Anonymous one-person-one-vote polling on Midnight.** The tally is public and
verifiable on-chain. The voters are not.

[![Compact Compiler](https://img.shields.io/badge/Compact%20Compiler-0.31.1-1abc9c.svg)](https://shields.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://shields.io/)
[![Network](https://img.shields.io/badge/deployed-Preview-8e44ad.svg)](https://shields.io/)

## The idea

Ask a group something they will only answer honestly if nobody can tell who said
what — *should we move to a four-day week?*, *do you trust this roadmap?*, *is
this proposal worth funding?* — and you hit a dilemma. Anonymous polls are easy
to stuff. Verified polls attach a name to every answer, and the moment a name is
attached, some people stop telling the truth.

Quorum removes the tradeoff. An organizer opens a question. Anyone holding a
secret key votes exactly once. The running Yes/No tally is public and anyone can
audit it, but nothing on-chain links a vote to a voter.

The chain enforces one-person-one-vote **without ever learning who voted**. Each
voter proves in zero knowledge that they hold a secret key whose *nullifier* — a
one-way, domain-separated hash of that key — is not already in the published
set. The proof convinces the network the vote is unique. It reveals nothing that
would identify the voter.

The proof is generated on the voter's own machine, and a second vote is rejected
*there*, before any transaction is built or broadcast. Nobody has to be trusted
with the link between voter and vote, because nobody is ever told it.

## Deployed contract

Live on the Midnight **Preview** testnet:

```
8d8397ab0d8013f834837e365a905fa1e5de0ca0aec8265bed37b34d522e7f97
```

Deployed in transaction
`d3b148963f514a1849cde4f8380d12c108240a32d32d0597e54a9254a9f2a981`, block
`328602`. This queries the public Preview indexer directly and depends on nothing
in this repo:

```bash
curl -s https://indexer.preview.midnight.network/api/v4/graphql -H 'content-type: application/json' -d '{"query":"{ contractAction(address: \"8d8397ab0d8013f834837e365a905fa1e5de0ca0aec8265bed37b34d522e7f97\") { address transaction { hash block { height } } } }"}'
```

Full deployment transcript: [`docs/deploy-output.txt`](docs/deploy-output.txt).
Compiler output listing the four circuits:
[`docs/compile-output.txt`](docs/compile-output.txt).

## Public state vs private witness

Every public value is published by an explicit `disclose()` in
[`contract/src/quorum.compact`](contract/src/quorum.compact). Compact refuses to
let a witness value reach public state without one, so the disclosure surface is
exactly these five calls and nothing else.

| Value | On chain | How |
|---|---|---|
| The question | yes | `disclose(some(newQuestion))` — [`quorum.compact:56`](contract/src/quorum.compact#L56). Everyone must see what is asked. |
| Yes / No totals | yes | Counter increments — [`:76`](contract/src/quorum.compact#L76), [`:78`](contract/src/quorum.compact#L78). The tally is the product. |
| That *a* vote was Yes | yes | `disclose(choice)` — [`:75`](contract/src/quorum.compact#L75). Selects which counter moves. |
| The nullifier set | yes | `disclose(voteNullifier(...))` — [`:71`](contract/src/quorum.compact#L71). Opaque by construction. |
| Organizer's derived key | yes | `disclose(organizerKey(...))` — [`:55`](contract/src/quorum.compact#L55). A commitment, not a name. |
| **The voter's secret key** | **never** | `witness localSecretKey()` — never passed to `disclose()` in any circuit. |
| **Which way a given voter voted** | **never** | `choice` moves a global counter; it is never stored per voter. |
| **The link between voter and vote** | **never** | Not derivable — the nullifier is a one-way hash. |

The two derivations at
[`quorum.compact:108-114`](contract/src/quorum.compact#L108-L114) are
domain-separated — `"quorum:org:"` and `"quorum:nul:"` — so one secret key
produces two unrelated values in its two roles. An organizer's derived key cannot
be linked to their own vote nullifier, even though both come from that key.

The private state itself lives in
[`contract/src/witnesses.ts`](contract/src/witnesses.ts) and holds one field: a
32-byte secret key generated locally. In the browser it is held by an in-memory
provider only ([`quorum-ui/src/in-memory-private-state-provider.ts`](quorum-ui/src/in-memory-private-state-provider.ts)) — closing the tab
forgets it, and so does disconnecting the wallet.

## The privacy claim, and its limit

**Claimed:** an observer with the full chain history can compute the exact tally
and the exact number of distinct voters, and cannot determine which way any
identified person voted, or whether a given person voted at all.

That claim holds because the only per-voter value published is
`persistentHash(["quorum:nul:", round, sk])`. Recovering `sk` from it means
inverting the hash. Linking it to a voter means already knowing their `sk` —
which is exactly the secret the scheme protects.

**Not claimed — a real limitation, stated plainly:** the nullifier is *not* bound
to the contract address. The same secret key therefore produces the same
nullifier in every Quorum poll at the same round number. An observer watching two
different Quorum deployments can tell that *the same anonymous person* voted in
both. They still learn no identity and no vote direction, but that cross-poll
correlation is real and it is a weakness. Binding `kernel.self()` into the hash
would close it; that is the obvious next change, deliberately left out of this
version rather than papered over.

Note also that `reset()` rotates every nullifier by bumping `round`. That is what
makes a contract reusable for a series of polls — and it means the anonymity set
is per-round, not per-lifetime.

## The behaviour to look for

**Vote once, then try to vote again.**

The second attempt fails during local proof generation with `failed assert: You
have already voted in this poll` — and no transaction is ever submitted. Nothing
is sent to the network, so nothing about the second attempt is recorded anywhere.
The chain was never asked, and was never told who you are.

Both frontends make this visible. The UI's privacy panel shows your own nullifier
in hex next to the on-chain set, so you can confirm by eye that the value that
landed on-chain is the one your key derives — the same check the circuit does, but
where you can see it. The Yes/No buttons then disable with *"already counted"*.

The CLI shows the same thing as a transcript; the recorded run is in
[`docs/deploy-output.txt`](docs/deploy-output.txt), which ends with the public
ledger state (`yes votes: 1, no votes: 0, round: 1, nullifiers: 1`) printed next
to the nullifier only a holder of the secret key could have computed.

## The dApp

![Quorum with no wallet connected: the poll card on black, and all three poll
actions greyed out until a wallet is attached](docs/screenshots/ui-disconnected.png)

The initial state, before a wallet is attached. Every poll action — join the live
poll, deploy a new one, join one by address — is gated on the wallet, because all
three need a key to sign with and `vote` additionally needs one to derive a
nullifier from. `Connect Lace` in the header is the only thing you can press.

Connecting reveals the poll question and tallies, and the privacy panel described
above. A recorded run of the same circuits against Preview, including the
second-vote rejection, is in [`docs/deploy-output.txt`](docs/deploy-output.txt).

## Project structure

```
quorum/
├── contract/          # The Compact contract, witnesses, and simulator tests
│   └── src/managed/   # Committed build output: circuits, prover/verifier keys
├── api/               # Shared types and the QuorumAPI used by both frontends
├── quorum-cli/        # Terminal client; also the deployment tool
├── quorum-ui/         # Browser dApp with Lace wallet integration
└── docs/              # Compile and deploy transcripts, and screenshots
```

## Prerequisites

The Compact toolchain does not support Windows natively, and the build scripts
use POSIX tools. On Windows, run everything inside WSL2.

| Requirement | Version | Check |
|---|---|---|
| Node.js | `24.11.1`+ (pinned in [`.nvmrc`](.nvmrc)) | `node --version` |
| Docker | any recent | `docker --version` |
| Compact | compiler `0.31.1` | `compact compile --version` |
| Lace wallet | for the UI only | browser extension |

Install the Compact toolchain:

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update
```

Get the Lace extension from the
[Chrome Store](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk)
or the [Edge Store](https://microsoftedge.microsoft.com/addons/detail/lace/efeiemlfnahiidnjglmehaihacglceia).

## Setup

```bash
npm install
```

Compile the contract. This writes `contract/src/managed/quorum/` — the four
circuits plus their proving and verifying keys — which the CLI and UI both load
at runtime:

```bash
cd contract && npm run compact
```

Run the test suite:

```bash
cd contract && npm test
```

Start the proof server. Use the pinned compose file rather than the `latest` tag:
the SDK here is pinned to 4.1.1, and a moving proof-server tag fails at proof
generation, which is a bad place to find out:

```bash
cd quorum-cli && docker compose -f proof-server-local.yml up -d
```

### Run the browser dApp

```bash
cd quorum-ui && npm run build:start:preview
```

Open the printed URL, click **Connect Lace**, and either join the deployed poll
above (offered as a one-click button) or deploy your own.

### Run the CLI

```bash
cd quorum-cli && npm run preview-remote
```

### Deploy your own contract

```bash
cd quorum-cli && npm run new-wallet -- preview   # prints an address to fund
```

Fund that address with tNIGHT from the
[Midnight faucet](https://midnight.network/test-faucet), then:

```bash
cd quorum-cli && npm run deploy-preview
```

Fees on Midnight are paid in DUST, not NIGHT, and DUST only accrues from NIGHT
that has been *registered* to generate it. The deploy script handles the
registration — including the fact that the registration transaction must itself
be paid for out of dust the registration has not formally unlocked yet — but the
first run on a fresh wallet takes several minutes while that dust accrues. The
log reports the balance as it climbs.

## Wallet safety

`.wallet-seed.local` holds the deployment wallet's master seed. It is a private
key: it is gitignored, and nothing in `docs/` contains it. The Midnight SDK logs
the seed at INFO level, so every script that captures output filters it before
anything reaches a file or the terminal. If you generate your own wallet, keep
that seed out of screenshots and commits.

## Troubleshooting

| Issue | Fix |
|---|---|
| `compact` not found | Re-run the installer, then `compact update`; open a new shell |
| Compilation fails | Run `npm run compact` from `contract/`, not the repo root |
| `Application is not authorized` | Start the proof server from `quorum-cli/`: `docker compose -f proof-server-local.yml up -d` |
| Lace not detected | Install the extension, then refresh the page |
| Deploy sits at `Waiting for dust` | Expected on a fresh wallet; registration takes minutes. It errors out rather than hanging if it truly fails |
| `Insufficient Funds: could not balance dust` | The wallet has NIGHT but not enough DUST yet. Wait and re-run |
| Port 6300 in use | `docker compose down`, then bring the proof server back up |
| `npm install` warnings on old Node | Use Node `24.11.1`+; older versions install but are not the target runtime |

## Further reading

- [Midnight documentation](https://docs.midnight.network/)
- [Compact language guide](https://docs.midnight.network/compact/writing)
- [Proof server](https://docs.midnight.network/develop/tutorial/using/proof-server)

## Implementation notes

- **Transaction fee overhead.** The `additionalFeeOverhead` default from
  `@midnight-ntwrk/testkit-js` (`500_000_000_000_000_000n`) is required on the
  `undeployed` network — lower values fail with `BalanceCheckOverspend` on the
  node. On remote networks that overhead demands far too much dust, so the CLI
  overrides it to `1_000n`.
- **Private state scoping.** CLI private state is stored per contract address,
  matching the Midnight.js 4.x private-state provider model.
- **Attribution.** Built on the
  [example-bboard](https://github.com/midnightntwrk/example-bboard) scaffold. The
  workspace layout, provider wiring and wallet plumbing come from there; the
  contract, its tests, the API surface and the poll UI are original to Quorum.
