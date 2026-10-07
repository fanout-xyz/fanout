import { PayView } from "@/components/wallet/pay-view";

/** Pay links and pay QR codes land here: /pay?to=0x…&amount=20.00&note=Lunch (lib/payment-request.ts). */
export default async function PayPage(props: PageProps<"/pay">) {
  const query = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  return <PayView to={one(query.to)} amount={one(query.amount)} note={one(query.note)} />;
}
