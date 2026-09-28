import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server origins besides localhost: the ngrok tunnel for the phone demo, and
  // 127.0.0.1 (a separate origin, handy for testing "another device" on one machine).
  allowedDevOrigins: ["127.0.0.1", "*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.dev"],
};

export default nextConfig;
