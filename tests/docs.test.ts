import { describe, it, expect } from 'vitest';
import { docsJsonResponse, readOpenApiJson, renderDocsHtml } from '../src/transports/rest/docs.js';

describe('REST docs', () => {
  it('renders a self-contained HTML doc with all operations', () => {
    const html = renderDocsHtml();
    expect(html).toContain('boss-client API');
    expect(html).toContain('Authorization: Bearer');
    expect((html.match(/class="op"/g) ?? []).length).toBe(16);
    expect(html).toContain('cURL 示例');
    expect(html).toContain('错误码');
    expect(html).toContain('/openapi.json');
  });

  it('exposes machine-readable operation metadata (not raw zod objects)', () => {
    const docs = docsJsonResponse() as { operations: Array<Record<string, unknown>> };
    expect(docs.operations).toHaveLength(16);
    for (const op of docs.operations) {
      expect(Array.isArray(op.requestFields)).toBe(true);
      expect(op.responseSchema).toBeTypeOf('object');
      expect(Array.isArray(op.errors)).toBe(true);
    }
  });

  it('generates OpenAPI with components and no broken #/$defs refs', () => {
    const openapi = readOpenApiJson() as Record<string, unknown>;
    expect(openapi.openapi).toBe('3.1.0');
    const components = openapi.components as { schemas: Record<string, unknown> };
    expect(Object.keys(components.schemas).length).toBeGreaterThan(10);
    const text = JSON.stringify(openapi);
    expect(text).not.toContain('#/$defs/');
    expect(text).toContain('#/components/schemas/ErrorEnvelope');
  });
});
