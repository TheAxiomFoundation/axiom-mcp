export interface AxiomMcpConfig {
  apiBaseUrl: string;
  apiKey: string | null;
}

export function configFromEnv(): AxiomMcpConfig {
  return {
    apiBaseUrl:
      process.env.AXIOM_API_BASE_URL?.replace(/\/+$/, "") ||
      "https://axiom-api-eta.vercel.app",
    apiKey: process.env.AXIOM_API_KEY || null
  };
}
