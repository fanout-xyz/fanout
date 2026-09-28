import { SignInCta } from "@/components/sign-in-cta";

const steps = [
  {
    title: "Deposit once",
    body: "Fund your payout balance in dollars. One deposit covers every payee in the run.",
  },
  {
    title: "Upload who gets what",
    body: "A CSV with email, amount and a note. We check it before anything moves.",
  },
  {
    title: "Everyone is paid at once",
    body: "One approval pays the whole list. Each payee gets a link and claims with their email.",
  },
];

export default function Landing() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="text-lg font-semibold tracking-tight">Fanout</span>
        <SignInCta />
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-6">
        <section className="flex flex-col items-start gap-6 py-16 sm:py-24">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Global payouts that settle in one block, not five business days.
          </h1>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">
            Pay creators and freelancers abroad from a single deposit. Their money lands in
            seconds, in dollars, and they claim it with just their email.
          </p>
          <SignInCta size="lg" signedOutLabel="Start paying people" />
        </section>

        <section className="grid gap-8 border-t py-12 sm:grid-cols-3 sm:gap-6">
          {steps.map((step, i) => (
            <div key={step.title} className="flex flex-col gap-2">
              <span className="text-sm text-muted-foreground tabular-nums">0{i + 1}</span>
              <h2 className="font-medium">{step.title}</h2>
              <p className="text-sm text-pretty text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted-foreground sm:px-6">
        Testnet demo. No real funds move.
      </footer>
    </div>
  );
}
