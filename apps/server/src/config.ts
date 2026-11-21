/** Runtime configuration from environment variables (see README / docker-compose.yml). */
export interface ServerConfig {
  port: number;
  /** Directory with the built web app (served at /). */
  staticDir: string;
  /** Cache directory for geodata responses. */
  dataDir: string;
  cacheTtlDays: number;
  userAgent: string;
  allowedOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT ?? 8080),
    staticDir: env.STATIC_DIR ?? '../web/dist',
    dataDir: env.DATA_DIR ?? './data',
    cacheTtlDays: Number(env.CACHE_TTL_DAYS ?? 30),
    userAgent: env.USER_AGENT ?? 'Kubatur/0.1 (massing study tool)',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
