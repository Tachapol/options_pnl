import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

const localNetworkOrigins = Object.values(networkInterfaces()).flatMap((addresses) =>
  (addresses ?? []).filter(({ family, internal, address }) =>
    family === "IPv4" && !internal && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address),
  ).map(({ address }) => address),
);

const config: NextConfig = {
  allowedDevOrigins: localNetworkOrigins,
};

export default config;
