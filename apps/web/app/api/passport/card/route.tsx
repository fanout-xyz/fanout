/* eslint-disable @next/next/no-img-element -- ImageResponse draws plain <img>, not next/image */
import { ImageResponse } from "next/og";
import { CARD_SIZES, cardFacts, cardPeriod, parseFormat, parseShareCard, type CardFormat, type ShareCard } from "@/lib/payee/passport-share";

/**
 * GET /api/passport/card?m=&from=&to=[&a=&pl=&tot=][&format=portrait]
 * The share image for a Passport link: 1200×630 for link previews, 1080×1350 for stories.
 * It draws only the preview fields in the query, which hold only what the payee chose to show.
 * The query is never trusted to be true (the verify page does the checking), so the image never
 * says "verified"; it invites the viewer to open the link. Bad input draws the plain card.
 */

const INK = "#1B1B2F";
const CREAM = "#FFF6EA";
const MINT = "#C9F2DC";
const COBALT = "#3355FF";

// The brand mark as three petals; cream on ink, separated by ink strokes.
const mark = (fill: string, cut: string) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="8.49 14.5 83.03 65.54">${[-38, 38, 0]
      .map(
        (a) =>
          `<rect x="38" y="${a ? 16 : 12}" width="24" height="${a ? 64 : 68}" rx="12" fill="${fill}" stroke="${cut}" stroke-width="5" paint-order="stroke" transform="rotate(${a} 50 80)"/>`,
      )
      .join("")}</svg>`,
  ).toString("base64")}`;

type Font = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700 | 800; style: "normal" };

/** Google Fonts serves TTF to clients that don't ask for woff2. Cached per server; falls back to the default font. */
async function googleFont(family: string, weight: Font["weight"]): Promise<Font | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}`, {
      signal: AbortSignal.timeout(3_000),
    }).then((r) => r.text());
    const url = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    const data = await fetch(url, { signal: AbortSignal.timeout(3_000) }).then((r) => r.arrayBuffer());
    return { name: family, data, weight, style: "normal" };
  } catch {
    return null;
  }
}

let fonts: Promise<Font[]> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all([googleFont("Bricolage Grotesque", 700), googleFont("Plus Jakarta Sans", 600), googleFont("Plus Jakarta Sans", 800)]).then(
    (list) => {
      const ok = list.filter((f): f is Font => f !== null);
      if (ok.length < list.length) fonts = null; // try again next time
      return ok;
    },
  ));

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const format: CardFormat = parseFormat(params.get("format")) ?? "landscape";
  const card = parseShareCard(params);
  const size = CARD_SIZES[format];
  const portrait = format === "portrait";

  return new ImageResponse(<Card card={card} portrait={portrait} />, {
    ...size,
    fonts: await loadFonts(),
    headers: {
      // Same query, same picture: let link previews and the CDN keep it.
      "Cache-Control": card ? "public, max-age=86400, s-maxage=604800, immutable" : "public, max-age=3600",
    },
  });
}

function Card({ card, portrait }: { card: ShareCard | null; portrait: boolean }) {
  const pad = portrait ? 88 : 72;
  const display = { fontFamily: "Bricolage Grotesque" };
  const facts = card ? cardFacts(card) : [];
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: INK,
        color: CREAM,
        padding: pad,
        position: "relative",
        fontFamily: "Plus Jakarta Sans",
      }}
    >
      {/* Watermark petals, bottom right. */}
      <img
        src={mark(COBALT, INK)}
        width={portrait ? 760 : 560}
        height={portrait ? 600 : 442}
        style={{ position: "absolute", right: portrait ? -180 : -120, bottom: portrait ? -150 : -110, opacity: 0.32 }}
        alt=""
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src={mark(CREAM, INK)} width={48} height={38} alt="" />
          <span style={{ fontSize: portrait ? 36 : 30, fontWeight: 800 }}>Earnings Passport</span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: portrait ? 150 : 120,
            height: portrait ? 150 : 120,
            borderRadius: 999,
            border: `5px solid ${MINT}`,
            color: MINT,
            transform: "rotate(-12deg)",
            fontSize: portrait ? 22 : 18,
            fontWeight: 800,
            textAlign: "center",
            lineHeight: 1.15,
          }}
        >
          {(card ? ["OPEN TO", "CHECK"] : ["FANOUT"]).map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
      </div>

      {card ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: portrait ? 40 : 34, fontWeight: 600, color: "rgba(255,246,234,0.7)" }}>
            {card.minMonthlyUsd !== undefined ? "Earned at least" : "Earnings record"}
          </span>
          <span style={{ ...display, fontSize: portrait ? 132 : 112, lineHeight: 1, letterSpacing: -4, marginTop: 8 }}>
            {card.minMonthlyUsd !== undefined ? `$${card.minMonthlyUsd.toLocaleString("en-US")} a month` : "Paid every month"}
          </span>
          <span style={{ fontSize: portrait ? 44 : 38, fontWeight: 600, marginTop: 20, color: "rgba(255,246,234,0.85)" }}>{cardPeriod(card)}</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ ...display, fontSize: portrait ? 120 : 100, lineHeight: 1.02, letterSpacing: -3 }}>Earnings you can prove</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          {facts.map((f) => (
            <span
              key={f}
              style={{ fontSize: portrait ? 34 : 28, fontWeight: 800, padding: "12px 26px", borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)" }}
            >
              {f}
            </span>
          ))}
        </div>
        <span style={{ fontSize: portrait ? 28 : 24, fontWeight: 600, color: "rgba(255,246,234,0.6)" }}>
          Open the link to check it against real payouts · Fanout
        </span>
      </div>
    </div>
  );
}
