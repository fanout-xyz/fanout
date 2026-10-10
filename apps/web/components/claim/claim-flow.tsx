"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";
import Link from "next/link";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";
import { PetalsMark } from "@/components/brand/petals-mark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountSetup } from "@/components/payee/account-setup";
import { InstallPrompt } from "@/components/payee/install-prompt";
import { PushPrompt } from "@/components/payee/push-prompt";
import { LocalAmount } from "@/components/payee/local-amount";
import { UsdcOffer } from "@/components/payee/usdc-offer";
import { useAuth } from "@/lib/auth/provider";
import { activeChain } from "@/lib/chains";
import { claimVerifyingContract, config } from "@/lib/config";
import { claimSignerFromKey, parseClaimFragment, signClaim } from "@/lib/fanout/claim-keys";
import { NotFoundError } from "@/lib/fanout/client";
import { useFanoutClient } from "@/lib/fanout/use-fanout-client";
import { languageInfo, type Lang } from "@/lib/i18n/languages";
import { formatDollars, formatDollarsFromUnits, translator, type MessageKey } from "@/lib/i18n/messages";
import { useClaimLanguage } from "@/lib/i18n/use-claim-language";
import { toCents } from "@/lib/money";
import { usePayeeAccount } from "@/lib/payee/payee-account";
import { useLocalCurrency } from "@/lib/use-local-currency";
import { ClaimScreen, type ClaimScreenState } from "./claim-screen";
import { LanguageSwitcher } from "./language-switcher";

// The key lives in the URL fragment (#k=...), which browsers never send to a server.
const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function ClaimFlow({ initialLang = "en" }: { initialLang?: Lang }) {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  const privateKey: Hex | null | undefined = hash === null ? undefined : parseClaimFragment(hash);
  const [lang, setLang] = useClaimLanguage(initialLang);
  const t = translator(lang);
  return (
    <div lang={lang} dir={languageInfo(lang).dir} className="flex flex-1 flex-col">
      {/* Remount per link so state (claiming, success, errors) never carries over to another link. */}
      <ClaimForKey key={privateKey ?? String(privateKey)} privateKey={privateKey} lang={lang} />
      <div className="px-5 pb-6">
        <LanguageSwitcher value={lang} label={t("language")} onChange={setLang} />
      </div>
    </div>
  );
}

type T = ReturnType<typeof translator>;

function ClaimForKey({ privateKey, lang }: { privateKey: Hex | null | undefined; lang: Lang }) {
  const t = useMemo(() => translator(lang), [lang]);
  const claimSigner = privateKey ? claimSignerFromKey(privateKey) : null;

  const client = useFanoutClient();
  const queryClient = useQueryClient();
  const { ready, authenticated, user, login, logout, provider } = useAuth();
  const reduced = useReducedMotion() ?? false;
  const { currency: localCurrency } = useLocalCurrency();
  const [phase, setPhase] = useState<ClaimScreenState>("ready");
  const [error, setError] = useState<string | null>(null);
  const [wantsClaim, setWantsClaim] = useState(false);
  const running = useRef(false);

  const info = useQuery({
    queryKey: ["fanout", "claim", claimSigner],
    queryFn: () => client.getClaim(claimSigner!),
    enabled: !!claimSigner,
    retry: (count, err) => !(err instanceof NotFoundError) && count < 2,
  });

  // Where the money goes: the payee's passkey account (Mera), or their email account as a fallback.
  const payee = usePayeeAccount();
  const recipient = payee.address;

  const runClaim = useCallback(
    async (to: Address) => {
      if (!privateKey || !claimSigner || running.current) return;
      running.current = true;
      setPhase("claiming");
      setError(null);
      try {
        const signature = await signClaim(privateKey, {
          recipient: to,
          claimContract: claimVerifyingContract(),
          chainId: activeChain.id,
        });
        await client.claim(claimSigner, to, signature);
        setPhase("success");
        posthog.capture("claim_completed", {
          amount_usd: Number(info.data?.amount ?? 0n) / 1e6,
          demo_mode: config.useMock,
          // Which currency the payee sees: a proxy for the payout country.
          local_currency: localCurrency ?? "USD",
          // Person properties for retention: split payees from platforms, and know when each started.
          $set: { is_payee: true },
          $set_once: { first_claim_at: new Date().toISOString() },
        });
        // The key stays in the URL: once claimed it's spent (a second claim is refused), and
        // the page needs it to keep showing this payment.
        void queryClient.invalidateQueries({ queryKey: ["fanout"] });
      } catch (err) {
        console.error("[claim] failed", err instanceof Error ? err.message : err);
        setPhase("ready");
        setError(t(humanClaimError(err)));
        void info.refetch();
      } finally {
        running.current = false;
        setWantsClaim(false);
      }
    },
    [privateKey, claimSigner, client, queryClient, info, localCurrency, t],
  );

  // After sign-in (and the account being ready), continue the claim the payee started.
  useEffect(() => {
    if (!(wantsClaim && authenticated && recipient && phase === "ready")) return;
    // Start on the next microtask rather than inside the effect body; `running` guards double starts.
    void Promise.resolve().then(() => runClaim(recipient));
  }, [wantsClaim, authenticated, recipient, phase, runClaim]);

  function onClaim() {
    setWantsClaim(true);
    if (!authenticated) login();
  }

  // --- Dead ends first ---------------------------------------------------------
  if (privateKey === undefined || (claimSigner && info.isPending)) return <Loading label={t("loading")} />;
  if (!privateKey || (info.isError && info.error instanceof NotFoundError)) {
    return <Notice title={t("invalidTitle")} body={t("invalidBody")} />;
  }
  if (info.isError) {
    return (
      <Notice title={t("loadErrorTitle")} body={t("loadErrorBody")}>
        <Button className="w-full" size="lg" onClick={() => void info.refetch()}>
          {t("tryAgain")}
        </Button>
      </Notice>
    );
  }

  const claim = info.data!;
  const platform = config.platformName;
  const amountLabel = formatDollarsFromUnits(lang, claim.amount, config.stablecoin.decimals);

  if (phase !== "success" && claim.status === "claimed") {
    return (
      <Notice title={t("claimedTitle")} body={t("claimedBody", { amount: amountLabel, platform })}>
        {authenticated && <BalanceLink t={t} />}
      </Notice>
    );
  }
  if (phase !== "success" && claim.status === "refunded") {
    return <Notice title={t("expiredTitle")} body={t("expiredBody", { platform, amount: amountLabel })} />;
  }

  // Signed in, but no account on this device yet: set one up, then the effect above claims.
  if (wantsClaim && authenticated && payee.kind === "none" && phase === "ready") {
    return <AccountSetup mode="create" />;
  }

  const waitingForAccount = wantsClaim && authenticated && !recipient;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col">
        <ClaimScreen
          className="h-auto flex-1"
          state={waitingForAccount ? "claiming" : phase}
          amountCents={toCents(claim.amount)}
          platform={platform}
          onClaim={onClaim}
          reduced={reduced}
          showLogo={false}
          actionLabel={t("claimAmount", { amount: amountLabel })}
          hint={!authenticated ? t(provider === "privy" ? "hintPasskey" : "hintEmail") : undefined}
          labels={{ youveBeenPaid: t("youveBeenPaid"), from: (p) => t("from", { platform: p }), claiming: t("claiming"), inBalance: t("inBalance") }}
          formatAmount={(cents) => formatDollars(lang, cents)}
          error={error}
          successAction={
            <>
              {/* Claiming and changing to USDC are separate steps: the claim lands first, then this is offered. */}
              <UsdcOffer amount={claim.amount} source="claim" className="mb-4" />
              <BalanceLink t={t} />
              <InstallPrompt className="mt-4" />
              <PushPrompt source="claim" className="mt-4" />
            </>
          }
          localAmount={<LocalAmount cents={toCents(claim.amount)} />}
        />
      </div>
      {ready && authenticated && phase !== "success" && (
        <p className="px-5 pb-4 text-center text-sm text-muted">
          {t("signedInAs", { email: user?.email ?? "…" })}{" "}
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-sm font-semibold text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("notYou")}
          </button>
        </p>
      )}
    </div>
  );
}

/** Payee-facing wording (a message key); the raw error is logged, never shown. */
function humanClaimError(err: unknown): MessageKey {
  const msg = err instanceof Error ? err.message : "";
  if (/already been claimed/i.test(msg)) return "errAlreadyClaimed";
  if (/different email/i.test(msg)) return "errDifferentEmail";
  if (/sign in/i.test(msg)) return "errSession";
  if (/expired|returned to the sender/i.test(msg)) return "errExpired";
  if (/reach the server|connection/i.test(msg)) return "errOffline";
  if (err instanceof NotFoundError) return "errInvalid";
  return "errGeneric";
}

function BalanceLink({ t }: { t: T }) {
  return (
    <Button asChild size="lg" variant="secondary" className="h-14 w-full">
      <Link href="/balance">{t("seeBalance")}</Link>
    </Button>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5" aria-busy="true" aria-label={label}>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-16 w-56" />
      <Skeleton className="h-8 w-48 rounded-full" />
    </div>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 pb-10 text-center">
      <PetalsMark size={48} color="var(--primary)" cutColor="var(--bg)" />
      <h1 className="font-display text-[28px] leading-tight tracking-[-0.02em]">{title}</h1>
      <p className="text-muted">{body}</p>
      {children && <div className="mt-4 w-full">{children}</div>}
    </div>
  );
}
