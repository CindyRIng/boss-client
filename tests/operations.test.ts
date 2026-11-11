import { describe, it, expect } from 'vitest';
import { OPERATIONS, mcpTools, cliCommands } from '../src/api/operations.js';

describe('operations registry', () => {
  it('has unique ids / paths / mcp names', () => {
    const ids = OPERATIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    const mcp = mcpTools().map((t) => t.name);
    expect(new Set(mcp).size).toBe(mcp.length);
    const restKeys = OPERATIONS.map((o) => `${o.rest.method} ${o.rest.path}`);
    expect(new Set(restKeys).size).toBe(restKeys.length);
  });

  it('all operations have output schema and cli/mcp mapping', () => {
    expect(OPERATIONS.length).toBeGreaterThanOrEqual(16);
    for (const op of OPERATIONS) {
      expect(op.output).toBeTruthy();
      expect(op.cli.command.length).toBeGreaterThan(0);
      expect(op.mcp.name.startsWith('boss_')).toBe(true);
    }
  });

  it('health is public, others require bearer', () => {
    expect(OPERATIONS.find((o) => o.id === 'health.get')?.auth).toBe('none');
    for (const op of OPERATIONS.filter((o) => o.id !== 'health.get')) expect(op.auth).toBe('bearer');
  });

  it('cli commands are derived from operations', () => {
    expect(cliCommands().length).toBe(OPERATIONS.length);
    expect(cliCommands().every((c) => c.command.startsWith('boss '))).toBe(true);
  });
});
