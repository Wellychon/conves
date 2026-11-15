import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // o monorepo tem lockfile só aqui; evita o Next procurar acima da pasta
  turbopack: { root: path.resolve(import.meta.dirname) },
};

export default config;
