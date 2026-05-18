import type { BackendTokenResponse, BackendVars } from './types';

export class BackendClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://127.0.0.1:3010') {
    this.baseUrl = baseUrl;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/test/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async waitForReady(timeoutMs: number = 30000, intervalMs: number = 500): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.healthCheck()) {
        return;
      }
      await this.sleep(intervalMs);
    }
    throw new Error(`Backend not ready after ${timeoutMs}ms`);
  }

  async getToken(user: string): Promise<BackendTokenResponse> {
    const res = await fetch(`${this.baseUrl}/api/test/auth/token?user=${encodeURIComponent(user)}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get token for user ${user}: ${text}`);
    }
    return res.json() as Promise<BackendTokenResponse>;
  }

  async getSuiteVars(): Promise<BackendVars> {
    const res = await fetch(`${this.baseUrl}/api/test/suite/vars`);
    if (!res.ok) {
      throw new Error('Failed to get suite vars');
    }
    const data = await res.json();
    return data.vars || {};
  }

  async queryDb(query: string, args: any[] = []): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/test/db/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, args }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DB query failed: ${text}`);
    }
    return res.json();
  }

  async resetDb(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/test/db/reset`, { method: 'POST' });
    if (!res.ok) {
      throw new Error('DB reset failed');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
