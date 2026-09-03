import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface StoredGoogleSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp in ms
  tokenType: string; // 'Bearer'
  scopes: string[];
  idToken?: string;
  user: {
    id?: string;
    email: string;
    name?: string;
    picture?: string;
  };
}

export interface GooglePublicUser {
  authenticated: boolean;
  email?: string;
  name?: string;
  picture?: string;
  expiresAt?: number;
  scopes?: string[];
  storageType: 'safeStorage' | 'aes-256-gcm' | 'in-memory';
}

function resolveAppDataDir(): string {
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'VeoAutoStudio');
  }
  if (process.env.USERPROFILE) {
    return path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'VeoAutoStudio');
  }
  if (process.env.HOME && process.platform !== 'win32') {
    return path.join(process.env.HOME, '.veoautostudio');
  }
  return path.join(process.cwd(), 'data');
}

class GoogleTokenStorage {
  private inMemorySession: StoredGoogleSession | null = null;
  private storageFilePath: string;
  private masterSecretKey: Buffer;

  constructor() {
    const dataDir = resolveAppDataDir();
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    } catch (_) {}

    this.storageFilePath = path.join(dataDir, 'google_auth.enc');

    // Chave de fallback segura baseada em salt de hardware/usuário da máquina
    const hostHash = crypto
      .createHash('sha256')
      .update(
        `${process.env.USERPROFILE || process.env.HOME || 'veo_user'}:${process.env.COMPUTERNAME || 'machine'}:veo_auto_studio_oauth_master`
      )
      .digest();
    this.masterSecretKey = hostHash;

    // Tenta carregar a sessão persistida na inicialização
    this.loadFromDisk();
  }

  /**
   * Verifica se o Electron safeStorage nativo está disponível
   */
  private getElectronSafeStorage(): any | null {
    try {
      if (process.versions && (process.versions as any).electron) {
        // Tenta requerer electron de forma dinâmica e segura
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const electron = require('electron');
        if (electron && electron.safeStorage && electron.safeStorage.isEncryptionAvailable()) {
          return electron.safeStorage;
        }
      }
    } catch (_) {
      // Fora de ambiente Electron ou seguro indisponível
    }
    return null;
  }

  /**
   * Criptografa dados usando safeStorage ou AES-256-GCM
   */
  private encrypt(plaintext: string): { data: string; method: 'safeStorage' | 'aes-256-gcm' } {
    const safeStorage = this.getElectronSafeStorage();
    if (safeStorage) {
      try {
        const encrypted = safeStorage.encryptString(plaintext);
        return {
          data: encrypted.toString('base64'),
          method: 'safeStorage',
        };
      } catch (err) {
        console.warn('[GoogleTokenStorage] safeStorage falhou, alternando para AES-256-GCM:', (err as any)?.message);
      }
    }

    // Criptografia simétrica autenticada AES-256-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterSecretKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    const payload = JSON.stringify({
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      ciphertext: encrypted,
    });

    return {
      data: Buffer.from(payload, 'utf8').toString('base64'),
      method: 'aes-256-gcm',
    };
  }

  /**
   * Descriptografa dados
   */
  private decrypt(raw: string, method: 'safeStorage' | 'aes-256-gcm'): string | null {
    try {
      if (method === 'safeStorage') {
        const safeStorage = this.getElectronSafeStorage();
        if (safeStorage) {
          const buf = Buffer.from(raw, 'base64');
          return safeStorage.decryptString(buf);
        }
      }

      // Descriptografia AES-256-GCM
      const rawPayload = Buffer.from(raw, 'base64').toString('utf8');
      const { iv, authTag, ciphertext } = JSON.parse(rawPayload);

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterSecretKey, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
      let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error('[GoogleTokenStorage] Erro ao descriptografar sessão:', (err as any)?.message);
      return null;
    }
  }

  /**
   * Carrega do disco
   */
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storageFilePath)) {
        return;
      }
      const rawContent = fs.readFileSync(this.storageFilePath, 'utf8');
      if (!rawContent.trim()) return;

      const envelope = JSON.parse(rawContent);
      if (!envelope || !envelope.data || !envelope.method) return;

      const decryptedJson = this.decrypt(envelope.data, envelope.method);
      if (decryptedJson) {
        const parsed = JSON.parse(decryptedJson);
        this.inMemorySession = parsed;
      }
    } catch (err) {
      console.warn('[GoogleTokenStorage] Não foi possível restaurar sessão do disco:', (err as any)?.message);
    }
  }

  /**
   * Salva credenciais completas de forma criptografada
   */
  public saveSession(session: StoredGoogleSession): void {
    this.inMemorySession = { ...session };
    try {
      const plaintext = JSON.stringify(session);
      const encrypted = this.encrypt(plaintext);
      const envelope = {
        version: 1,
        method: encrypted.method,
        updatedAt: new Date().toISOString(),
        data: encrypted.data,
      };
      fs.writeFileSync(this.storageFilePath, JSON.stringify(envelope, null, 2), 'utf8');
    } catch (err) {
      console.error('[GoogleTokenStorage] Falha ao persistir tokens criptografados:', (err as any)?.message);
    }
  }

  /**
   * Retorna a sessão ativa (Apenas acessível internamente pelo backend!)
   */
  public getSession(): StoredGoogleSession | null {
    return this.inMemorySession;
  }

  /**
   * Atualiza o access_token após um refresh
   */
  public updateAccessToken(newAccessToken: string, expiresInSeconds: number): void {
    if (!this.inMemorySession) return;
    this.inMemorySession.accessToken = newAccessToken;
    this.inMemorySession.expiresAt = Date.now() + expiresInSeconds * 1000;
    this.saveSession(this.inMemorySession);
  }

  /**
   * Limpa a sessão segura (Logout)
   */
  public clearSession(): void {
    this.inMemorySession = null;
    try {
      if (fs.existsSync(this.storageFilePath)) {
        fs.unlinkSync(this.storageFilePath);
      }
    } catch (err) {
      console.warn('[GoogleTokenStorage] Erro ao remover arquivo de sessão:', (err as any)?.message);
    }
  }

  /**
   * Retorna informações públicas seguras para o frontend (sem tokens!)
   */
  public getPublicProfile(): GooglePublicUser {
    if (!this.inMemorySession || !this.inMemorySession.user) {
      return {
        authenticated: false,
        storageType: this.getElectronSafeStorage() ? 'safeStorage' : 'aes-256-gcm',
      };
    }

    return {
      authenticated: true,
      email: this.inMemorySession.user.email,
      name: this.inMemorySession.user.name,
      picture: this.inMemorySession.user.picture,
      expiresAt: this.inMemorySession.expiresAt,
      scopes: this.inMemorySession.scopes,
      storageType: this.getElectronSafeStorage() ? 'safeStorage' : 'aes-256-gcm',
    };
  }
}

export const googleTokenStorage = new GoogleTokenStorage();
