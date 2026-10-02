import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server origins besides localhost: the ngrok tunnel for the phone demo, and
  // 127.0.0.1 (a separate origin, handy for testing "another device" on one machine).
  allowedDevOrigins: ["127.0.0.1", "*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.dev"],

  redirects: async () => [
    // wallet.fanout.tech is the payee's address: its home page is their balance (lib/site-url.ts).
    { source: "/", has: [{ type: "host", value: "wallet.fanout.tech" }], destination: "/balance", permanent: false },
    // Payee pages say "balance", never "wallet"; old links still land.
    { source: "/wallet", destination: "/balance", permanent: true },
  ],
};

export default nextConfig;
