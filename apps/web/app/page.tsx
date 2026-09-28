import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero/hero";
import { HowItWorks } from "@/components/landing/how/how-it-works";
import { MotionRoot } from "@/components/landing/motion-root";
import { PayeeSection } from "@/components/landing/payee/payee-section";
import { RaceSection } from "@/components/landing/race/race-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { SmoothScroll } from "@/components/landing/smooth-scroll";

export default function Landing() {
  return (
    <SmoothScroll>
      <MotionRoot>
        <div className="flex min-h-svh flex-col bg-cream text-ink">
          <SiteHeader />
          <main className="flex flex-1 flex-col">
            {/* Hero fills the first screen, header included (header is 4.5rem). */}
            <div className="flex min-h-[calc(100svh-4.5rem)] flex-col">
              <Hero />
            </div>
            <RaceSection />
            <HowItWorks />
            <PayeeSection />
            <FinalCta />
          </main>
          <SiteFooter />
        </div>
      </MotionRoot>
    </SmoothScroll>
  );
}
