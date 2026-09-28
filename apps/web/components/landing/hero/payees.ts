// Illustrative payouts for the hero animation. Invented first names, no real people.
// Corridors follow the PRD's demo focus (LatAm, Africa, Southeast Asia).
export type DemoPayee = { name: string; flag: string; cents: number };

export const DEMO_PAYEES: DemoPayee[] = [
  { name: "Ana", flag: "🇦🇷", cents: 12_000 },
  { name: "Tunde", flag: "🇳🇬", cents: 8_000 },
  { name: "Mai", flag: "🇻🇳", cents: 6_450 },
  { name: "Diego", flag: "🇲🇽", cents: 15_000 },
  { name: "Amara", flag: "🇰🇪", cents: 9_500 },
  { name: "Rizal", flag: "🇮🇩", cents: 4_200 },
  { name: "Lucía", flag: "🇨🇴", cents: 21_000 },
  { name: "Kofi", flag: "🇬🇭", cents: 5_825 },
  { name: "Bea", flag: "🇵🇭", cents: 7_700 },
  { name: "João", flag: "🇧🇷", cents: 13_000 },
  { name: "Zeynep", flag: "🇹🇷", cents: 6_600 },
  { name: "Thandi", flag: "🇿🇦", cents: 8_840 },
];

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatCents = (cents: number) => usd.format(cents / 100);
