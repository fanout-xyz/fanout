# Fanout — PRD

Sep 28, 2026 · @Shreyansh

## Name and pitch

**Fanout** lets a platform pay thousands of people across countries in digital dollars, from one deposit, in seconds. The name says what it does: one deposit fans out into many payouts.

**Team name: T+0.** "T+0" is finance shorthand for same-day settlement, which is the whole promise. Short, memorable, and judges from Galaxy or Electric Capital will get it instantly.

| Option | Type | Why | Watch out |
| --- | --- | --- | --- |
| Fanout | Product (pick) | Describes the one-to-many payout in one word | Check the name isn't taken by a payments company before using it outside the hackathon |
| Payrail | Product | Sounds like infrastructure, fits a payout API | Close to many existing "rail" brands |
| Settle | Product | Plain and clear | Generic, hard to search |
| T+0 | Team (pick) | Same-day settlement, the core promise | None for a hackathon |
| Last Mile | Team | The payout is the last mile of global payments | Used widely in logistics |
| Blocktime | Team | Nods to Monad's speed | Reads as crypto-first, which the product avoids |

One-line pitch for the submission: *"Global payouts that settle in one block, not five business days."*

## Problem

Platforms that pay people in many countries still depend on bank wires and payout providers that are slow, expensive and often refuse whole regions.

- **Slow:** international bank transfers typically take 1–5 business days, and payouts stall over weekends and holidays.
- **Expensive:** each payout carries wire fees, intermediary bank charges and a currency conversion margin. Small payouts ($20–$200) lose a large share to fees.
- **Patchy coverage:** processors and banks often decline payouts to certain countries or "high-risk" industries such as trading platforms.
- **Recipients want dollars:** in countries with unstable currencies (Argentina, Nigeria, Turkey), people prefer to hold dollars, and many already use stablecoins informally.
- **Ops burden:** finance teams reconcile failed payouts, bounced wires and support tickets by hand.

Stablecoins fix the speed and cost problem, but today using them means the platform and every recipient has to handle wallets, seed phrases and chains. Fanout hides all of that.

## Target users

The buyer is a mid-sized platform that pays many people abroad; the recipient is the person being paid. For the hackathon demo, the example platform is a creator or gig marketplace paying users in LatAm, Africa and Southeast Asia.

| User | Who | What they need | What they never see |
| --- | --- | --- | --- |
| Platform ops / finance (buyer) | Payouts or finance lead at a platform with 1k–50k payees | One deposit, a CSV or API call, every payout done in minutes, one report | Gas, chains, private keys |
| Recipient (payee) | Creator, freelancer, trader or seller abroad | Money arrives now, in dollars, claimable with email or a passkey | Seed phrases, wallet apps, token names |
| Developer at the platform | Engineer integrating payouts | A simple API and webhooks for payout status | Smart contract details |

**Segments after the hackathon, in order:** (1) creator, gig and marketplace platforms; (2) prop trading and trading platforms; (3) importers paying overseas suppliers. We avoid India-based recipients and EU-first launch at the start because of crypto tax and licensing overhead (see Security, compliance and risk).

## Solution and core flows

Fanout is a payout layer: the platform funds once, uploads who gets what, and every payee receives dollars they can claim with an email and a passkey.

&#91;embedded content: Fanout payout flow · platform to payee\]

The platform side runs left to right on the top row; the payee side runs back along the bottom. Only the batch payout touches the chain in a way the platform notices.

**Flow 1: platform pays out**

1. Ops lead signs in (email via Privy) and sees the treasury balance.
2. Deposits USDC from any chain; it lands as AUSD in the Fanout treasury on Monad.
3. Uploads a CSV (email, amount, note) or calls the API.
4. Reviews totals and fees, approves. One transaction pays everyone.
5. Dashboard shows each payout as sent, claimed or unclaimed, with a downloadable report.

**Flow 2: payee gets paid**

1. Payee receives an email: "You've been paid $120 by \<Platform>".
2. Opens the link, creates a passkey. A wallet is created behind the scenes.
3. Sees the balance in dollars. Can hold it, send it to another address, or (later) cash out through a partner.

**Flow 3: payout agent (stretch)**

An AI agent runs recurring payouts, such as weekly creator earnings, from the platform's data. It can only pay approved payees, within a daily cap, and a human can pause it at any time.

## Hackathon scope

The submission must show one full payout end to end on Monad; everything else is optional. Entered in **Track 2: Consumer Products & Payments**.

| Priority | Feature | Done means |
| --- | --- | --- |
| Must | Treasury + batch payout contract | Deposit AUSD, pay 50+ addresses or claim codes in one transaction on Monad testnet |
| Must | Claim links | Payee claims by email link + passkey; unclaimed funds return to the platform after a set period |
| Must | Platform dashboard | Sign in, see balance, upload CSV, approve, see status per payout |
| Must | Payee view | Balance in dollars, send to another address |
| Should | Deposit from any chain (Aurora Intents) | Fund treasury from USDC on another chain in one step |
| Should | Indexed history (Envio) | Dashboard and report read from indexed events, not RPC calls |
| Should | Payout agent with guardrails (MetaMask agent wallet) | Weekly payouts run automatically within caps and an allowlist |
| Could | Chainlink CRE workflow | Payout triggered by an offchain event (e.g. month-end earnings) |
| Could | Public payout API | REST endpoint + webhook for payout status |
| Won't | Cash-out to local bank accounts | Out of scope; needs licensed partners |
| Won't | Real KYC | Mocked in the demo; described in the write-up |

Cut rule: if the four Musts don't work end to end by 6 Oct, drop every Should and polish the demo.

## Architecture and integrations

Three small contracts on Monad do the money movement; everything else is a normal web app with sponsor tools plugged in where they earn a bounty.

&#91;embedded content: Fanout architecture · 3 layers\]

Payees without a wallet yet are paid into ClaimEscrow against a hashed email; the claim page releases funds once the passkey wallet exists.

| Integration | Used for | Bounty | Amount |
| --- | --- | --- | --- |
| Agora AUSD | Currency for every payout | Best Cross-Border Payments App on Monad | $10k |
| Privy (or Dynamic, pick one) | Sign-in and embedded wallets | Privy / Best Use of Dynamic | $5k |
| Mera (Monad Foundation) | Passkey claim for payees | Best Mera-Powered UX; One Passkey, Many Keys | $2.5k × 2 |
| Aurora Intents | Fund treasury from any chain | Bring Any-Chain Liquidity to Monad | $5k |
| MetaMask | Agent wallet with caps for the payout agent | Best Agent Wallet Plugin | $2.5k |
| Envio | Indexing payout and claim events | Best Use of Envio | $1k |
| Chainlink CRE | Event-triggered payouts (stretch) | Best workflow with CRE | $3k |
| Qwen or Kimi | Model behind the payout agent | Best Builds with Qwen / KIMI | credits |

Bounty titles are from the [Metropolis page](https://monad.xyz/developers/hackathons/metropolis); detailed rules and whether one project can win several bounties are not confirmed yet. Also confirm AUSD is deployed on the Monad network we target.

## Security, compliance and risk

The biggest real-world risk is compliance, not code; the demo stays in stablecoins and says plainly what a production version would need.

| Risk | Mitigation in the hackathon build | Production need |
| --- | --- | --- |
| Funds stolen through contract bugs | Small contracts, OpenZeppelin base, tests on every path, testnet only | External audit (ack3's security scan bounty is worth applying for) |
| Payout agent tricked into paying wrong people | Allowlist of payees, per-payout and daily caps, human approval above a threshold, pause switch | Same, plus anomaly alerts |
| Wrong email gets the money | Claim link expires; unclaimed funds refund to the platform | Email + phone verification before first claim |
| Sanctioned or fraudulent recipients | Mocked screening step shown in the flow | Real KYC / sanctions screening via a provider |
| Cash-out to local currency | Not built; shown as future work | Licensed off-ramp partners per country |
| India recipients | Not targeted | 30% flat tax on crypto gains + 1% TDS make stablecoin payouts unattractive; revisit if rules change |
| EU launch | Not targeted | MiCA licensing and stablecoin restrictions |
| Stablecoin depeg or issuer risk | Single stablecoin (AUSD) for the demo | Support USDC as well; let platforms choose |
| Personal data | Only email hashes onchain, no names or amounts tied to identities publicly | Data retention policy, regional data storage |

We do not promise yield on balances; US rules restrict stablecoin issuers from paying interest, and it is not the revenue model.

## Build plan

Fifteen days: the core payout flow must work on testnet by 6 Oct, leaving a week for stretch bounties and the demo.

&#91;embedded content: Build plan · Sep 29 to Oct 13\]

On 6 Oct, if a deposit-to-claim payout doesn't work end to end, skip the stretch bounties and spend the time fixing and polishing.

- [ ] Register team T+0 and pick Track 2 on the application
- [ ] Confirm AUSD on Monad testnet and read each target bounty's rules
- [ ] Find a Solidity teammate (or scope contracts down to what you can write and test)
- [ ] Deploy Treasury, BatchPayout, ClaimEscrow with tests
- [ ] Dashboard: sign-in, balance, CSV upload, approve, status
- [ ] Claim page: email link, passkey, balance, send
- [ ] Record a 2–3 minute demo video and write the submission

## Demo script and pitch

The demo shows one real payout run in under three minutes: 50 people paid from one deposit, one of them claiming live on a phone.

1. **Hook (15s):** "A creator in Lagos waits five days and loses a big share of $80 to fees. Watch this."
2. **Fund (30s):** ops lead signs in with email, deposits USDC from another chain, balance shows as dollars.
3. **Pay (30s):** upload a 50-row CSV, approve, one transaction. Show the Monad explorer: done in seconds.
4. **Claim (45s):** on a phone, open the email link, create a passkey, see $80. No app, no seed phrase.
5. **Guardrails (20s):** payout agent tries to pay an address not on the allowlist and is blocked.
6. **Close (20s):** "Fanout: global payouts that settle in one block, not five business days." Show the bounty integrations on one slide.

**What judges will ask, and our answers:**

- *How is this different from Sablier, Superfluid or Rise?* Built for platforms paying people who have no wallet: email + passkey claim, one-step funding from any chain, dollars only in the UI.
- *Why Monad?* Paying hundreds of people per batch needs cheap, fast transactions; Monad makes a batch cost cents and confirm in about a second.
- *How do people cash out?* Through licensed off-ramp partners after the hackathon; the demo stays in stablecoins on purpose.

## After the hackathon

Fanout becomes a business only if 3 platforms agree to a paid pilot within 60 days of the hackathon; until then it stays a side project.

**Revenue model:** 0.5–1.5% per payout or a flat fee per payout, plus a small currency conversion margin. Revenue grows with payout volume, so target platforms with thousands of payouts a month.

**Go to market:** interview 10–15 payout or finance leads at creator, gig and trading platforms. Ask how they pay people today, what fails, and what it costs. Offer a free pilot on one corridor.

**Keep it chain-agnostic:** Monad for the hackathon, but customers don't care about the chain. Support other chains once there are paying pilots.

**Success metrics**

| Stage | Metric | Target |
| --- | --- | --- |
| Hackathon | Track 2 placing + bounties won | Top 3 in track, 2+ bounties |
| First 60 days | Customer interviews done | 15 |
| First 60 days | Pilots agreed | 3 |
| First 6 months | Monthly payout volume | Set after pilots |

**Open questions**

- [ ] Can one project win several bounties? Check the application platform rules.
- [ ] Is AUSD live on Monad testnet and mainnet?
- [ ] Who is the Solidity teammate?
- [ ] Which licensed off-ramp partner covers LatAm and Africa first?

Sources: [Monad Metropolis hackathon page](https://monad.xyz/developers/hackathons/metropolis) · [Stablecoin payroll platforms compared (Stablecoin Insider)](https://stablecoininsider.org/best-stablecoin-payroll-platforms/) · [Stablecoin payroll providers (Spark)](https://www.spark.money/tools/stablecoin-payroll-provider-comparison)
