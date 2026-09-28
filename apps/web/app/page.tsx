import { Hero } from "@/components/landing/hero/hero";
import { SiteHeader } from "@/components/landing/site-header";
import { SmoothScroll } from "@/components/landing/smooth-scroll";

export default function Landing() {
  return (
    <SmoothScroll>
      <div className="flex min-h-svh flex-col bg-cream text-ink">
        <SiteHeader />
        <main className="flex flex-1 flex-col">
          <Hero />
        </main>
      </div>
    </SmoothScroll>
  );
}
