/**
 * CredentialManager: manages API keys securely.
 * Uses OS keychain (via keytar) when available,
 * with an AES-256-GCM encrypted file fallback.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Buffer } from 'node:buffer';

const SERVICE_NAME = 'knots-app';
const ALGORITHM = 'aes-256-gcm';

interface KeytarModule {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export interface CredentialManagerConfig {
  /** Directory to store encrypted fallback keys when keychain is unavailable. */
  dataDir?: string;
  /** Custom service name for keychain. Default: 'knots-app'. */
  serviceName?: string;
}

export class CredentialManager {
  private readonly serviceName: string;
  private readonly fallbackFilePath?: string;
  private keytarModule: KeytarModule | null = null;
  private keytarChecked = false;
  private encryptionKey?: Buffer;

  constructor(config?: CredentialManagerConfig) {
    this.serviceName = config?.serviceName ?? SERVICE_NAME;
    if (config?.dataDir) {
      this.fallbackFilePath = path.join(config.dataDir, '.credentials.enc');
    }
  }

  /**
   * Check whether native OS keychain is available.
   */
  async isKeychainAvailable(): Promise<boolean> {
    await this.ensureKeytar();
    return this.keytarModule !== null;
  }

  /**
   * Store an API key for a provider.
   */
  async setApiKey(provider: string, apiKey: string): Promise<void> {
    await this.ensureKeytar();

    if (this.keytarModule) {
      try {
        await this.keytarModule.setPassword(this.serviceName, provider, apiKey);
        return;
      } catch {
        // Fall back to encrypted file if keytar call fails
      }
    }

    this.setFallbackKey(provider, apiKey);
  }

  /**
   * Retrieve an API key for a provider. Returns null if not found.
   */
  async getApiKey(provider: string): Promise<string | null> {
    await this.ensureKeytar();

    if (this.keytarModule) {
      try {
        const password = await this.keytarModule.getPassword(this.serviceName, provider);
        if (password !== null) return password;
      } catch {
        // Fall through to fallback
      }
    }

    return this.getFallbackKey(provider);
  }

  /**
   * Delete an API key for a provider. Returns true if removed.
   */
  async deleteApiKey(provider: string): Promise<boolean> {
    await this.ensureKeytar();

    let deleted = false;
    if (this.keytarModule) {
      try {
        deleted = await this.keytarModule.deletePassword(this.serviceName, provider);
      } catch {
        // Fall through
      }
    }

    const fallbackDeleted = this.deleteFallbackKey(provider);
    return deleted || fallbackDeleted;
  }

  /**
   * Check if an API key exists for a provider.
   */
  async hasApiKey(provider: string): Promise<boolean> {
    const key = await this.getApiKey(provider);
    return key !== null && key.length > 0;
  }

  // ─── Native Keytar Detection ──────────────────────────────────────────

  private async ensureKeytar(): Promise<void> {
    if (this.keytarChecked) return;
    this.keytarChecked = true;

    try {
      // Dynamic import so lack of keytar / native bindings won't crash on load
      // @ts-ignore
      const mod = await import('keytar');
      this.keytarModule = (mod.default ?? mod) as KeytarModule;
    } catch {
      this.keytarModule = null;
    }
  }

  // ─── Encrypted File Fallback (AES-256-GCM) ────────────────────────────

  private getFallbackPath(): string {
    if (this.fallbackFilePath) return this.fallbackFilePath;
    const home = os.homedir();
    const knotsDir = path.join(home, '.knots');
    if (!fs.existsSync(knotsDir)) {
      fs.mkdirSync(knotsDir, { recursive: true });
    }
    return path.join(knotsDir, '.credentials.enc');
  }

  private getEncryptionKey(): Buffer {
    if (!this.encryptionKey) {
      // Derive a machine-stable key using user/hostname seed
      const seed = `${os.hostname()}:${os.userInfo().username}:${this.serviceName}`;
      this.encryptionKey = crypto.scryptSync(seed, 'knots-salt-v1', 32);
    }
    return this.encryptionKey;
  }

  private loadFallbackStore(): Record<string, string> {
    const filePath = this.getFallbackPath();
    if (!fs.existsSync(filePath)) return {};

    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const payload = JSON.parse(fileContent) as {
        iv: string;
        tag: string;
        data: string;
      };

      const key = this.getEncryptionKey();
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(payload.iv, 'hex'),
      );
      decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

      let decrypted = decipher.update(payload.data, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');

      return JSON.parse(decrypted) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private saveFallbackStore(store: Record<string, string>): void {
    const filePath = this.getFallbackPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const json = JSON.stringify(store);
    let encrypted = cipher.update(json, 'utf-8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    const payload = {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted,
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  private getFallbackKey(provider: string): string | null {
    const store = this.loadFallbackStore();
    return store[provider] ?? null;
  }

  private setFallbackKey(provider: string, apiKey: string): void {
    const store = this.loadFallbackStore();
    store[provider] = apiKey;
    this.saveFallbackStore(store);
  }

  private deleteFallbackKey(provider: string): boolean {
    const store = this.loadFallbackStore();
    if (provider in store) {
      delete store[provider];
      this.saveFallbackStore(store);
      return true;
    }
    return false;
  }
}
