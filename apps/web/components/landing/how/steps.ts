export const STEPS = [
  { title: "Fund once", body: "Deposit dollars into your payout balance. One deposit covers the whole run." },
  { title: "Upload who gets what", body: "Drop in a CSV with email, amount and a note. We check every row first." },
  { title: "Everyone gets paid", body: "One approval pays the whole list. People claim with just their email." },
] as const;

// Illustrative sample for the scenes.
export const SAMPLE_TOTAL_CENTS = 1_240_000; // $12,400.00
export const SAMPLE_PAYEES = 50;
export const SAMPLE_ROWS = [
  { name: "Ana", flag: "🇦🇷", cents: 18_000 },
  { name: "Tunde", flag: "🇳🇬", cents: 32_000 },
  { name: "Mai", flag: "🇻🇳", cents: 9_500 },
  { name: "Diego", flag: "🇲🇽", cents: 24_000 },
  { name: "Amara", flag: "🇰🇪", cents: 41_000 },
] as const;
