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
        <div className="flex min-h-svh flex-col bg-background text-foreground">
          <SiteHeader />
          <main className="flex flex-1 flex-col">
            {/* Hero is exactly one screen, header included (header is 4.5rem). On small
                screens the content is taller than that, so it grows instead of clipping. */}
            <div className="flex min-h-[calc(100svh-4.5rem)] flex-col lg:h-[calc(100svh-4.5rem)]">
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
