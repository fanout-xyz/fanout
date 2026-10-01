import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server origins besides localhost: the ngrok tunnel for the phone demo, and
  // 127.0.0.1 (a separate origin, handy for testing "another device" on one machine).
  allowedDevOrigins: ["127.0.0.1", "*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.dev"],

  // wallet.fanout.tech is the payee's address: its home page is their balance (lib/site-url.ts).
  async redirects() {
    return [{ source: "/", has: [{ type: "host", value: "wallet.fanout.tech" }], destination: "/wallet", permanent: false }];
  },
};

export default nextConfig;
