#!/usr/bin/env node
/**
 * boss-client 入口
 */
import { loadDotEnv } from './config/schema.js';
import { main } from './transports/cli/index.js';

loadDotEnv();

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
