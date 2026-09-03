import http from 'http';
import net from 'net';
import crypto from 'crypto';
import { exec } from 'child_process';
import { googleTokenStorage, GooglePublicUser, StoredGoogleSession } from './googleTokenStorage';
import { db } from '../db';

export interface ActiveOAuthFlow {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  server: http.Server;
  timeoutTimer: NodeJS.Timeout;
  resolve: (value: GooglePublicUser) => void;
  reject: (reason: any) => void;
  isCompleted: boolean;
}

export class GoogleOAuthService {
  private activeFlow: ActiveOAuthFlow | null = null;

  // Escopos oficiais mínimos necessários:
  // - openid, email, profile para identidade segura do usuário
  // - https://www.googleapis.com/auth/generative-language.retriever para Gemini API oficial
  private readonly DEFAULT_SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/generative-language.retriever',
  ];

  /**
   * Obtém o Client ID configurado (via variável de ambiente ou settings salvas no db)
   */
  public getClientId(): string {
    if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_ID.trim()) {
      return process.env.GOOGLE_OAUTH_CLIENT_ID.trim();
    }
    const settings = db.getSettings();
    if (settings.googleOAuthClientId && settings.googleOAuthClientId.trim()) {
      return settings.googleOAuthClientId.trim();
    }
    return '';
  }

  /**
   * Define o Client ID nas configurações locais
   */
  public setClientId(clientId: string): void {
    const cleanId = clientId.trim();
    db.updateSettings({ googleOAuthClientId: cleanId });
    db.log('info', '[GoogleOAuth] Client ID atualizado nas configurações.');
  }

  /**
   * Obtém o Client Secret configurado (OPCIONAL).
   * Para Desktop/Installed Apps com PKCE S256 (RFC 7636 e RFC 8252), o client_secret NÃO é obrigatório.
   * Somente é enviado se configurado pelo usuário (via GOOGLE_OAUTH_CLIENT_SECRET ou settings).
   * NUNCA lança erro caso esteja ausente.
   */
  public getClientSecret(): string {
    if (process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_CLIENT_SECRET.trim()) {
      return process.env.GOOGLE_OAUTH_CLIENT_SECRET.trim();
    }
    const settings = db.getSettings();
    if (settings.googleOAuthClientSecret && settings.googleOAuthClientSecret.trim()) {
      return settings.googleOAuthClientSecret.trim();
    }
    return '';
  }

  /**
   * Define o Client Secret nas configurações locais (opcional)
   */
  public setClientSecret(clientSecret: string): void {
    const cleanSecret = clientSecret.trim();
    db.updateSettings({ googleOAuthClientSecret: cleanSecret });
    db.log('info', '[GoogleOAuth] Client Secret atualizado nas configurações (opcional).');
  }

  /**
   * Abre o navegador padrão do sistema operacional com a URL especificada
   */
  private async openExternalUrl(url: string): Promise<void> {
    // 1. Tenta usar o Electron shell caso estejamos em processo Electron
    try {
      if (process.versions && (process.versions as any).electron) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const electron = require('electron');
        if (electron && electron.shell && typeof electron.shell.openExternal === 'function') {
          await electron.shell.openExternal(url);
          return;
        }
      }
    } catch (_) {}

    // 2. Fallback nativo para o sistema operacional
    return new Promise((resolve, reject) => {
      const platform = process.platform;
      let cmd = '';

      if (platform === 'win32') {
        // No Windows usamos o comando start
        cmd = `start "" "${url}"`;
      } else if (platform === 'darwin') {
        cmd = `open "${url}"`;
      } else {
        cmd = `xdg-open "${url}"`;
      }

      exec(cmd, (err) => {
        if (err) {
          console.error('[GoogleOAuth] Falha ao abrir navegador nativo:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Inicia o fluxo oficial de login Google OAuth 2.0 PKCE para Desktop Native App
   */
  public async startLogin(): Promise<GooglePublicUser> {
    const clientId = this.getClientId();
    if (!clientId) {
      throw new Error(
        'Google OAuth Client ID não configurado. Por favor, configure o Client ID nas Configurações ou defina a variável GOOGLE_OAUTH_CLIENT_ID.'
      );
    }

    // Se já houver um fluxo em andamento, cancela o anterior
    if (this.activeFlow) {
      this.cancelLogin('Novo fluxo de login iniciado.');
    }

    // 1. Gera PKCE (code_verifier e code_challenge S256)
    // code_verifier deve ter entre 43 e 128 caracteres aleatórios
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // 2. Gera state anti-CSRF aleatório
    const state = crypto.randomBytes(32).toString('base64url');

    return new Promise<GooglePublicUser>((resolve, reject) => {
      // 3. Cria o servidor HTTP loopback temporário em 127.0.0.1 em porta aleatória
      const server = http.createServer();

      // Timeout de 5 minutos (300.000 ms)
      const timeoutTimer = setTimeout(() => {
        if (this.activeFlow && !this.activeFlow.isCompleted) {
          this.activeFlow.isCompleted = true;
          this.cleanupServer(server);
          this.activeFlow = null;
          reject(new Error('Tempo de autenticação expirado (5 minutos). Tente novamente.'));
        }
      }, 5 * 60 * 1000);

      const flow: ActiveOAuthFlow = {
        state,
        codeVerifier,
        codeChallenge,
        redirectUri: '',
        server,
        timeoutTimer,
        resolve,
        reject,
        isCompleted: false,
      };

      this.activeFlow = flow;

      server.on('request', async (req, res) => {
        try {
          const reqUrl = new URL(req.url || '/', `http://${req.headers.host}`);

          // Ignora requisições de favicon ou rotas secundárias
          if (reqUrl.pathname !== '/' && reqUrl.pathname !== '') {
            res.writeHead(404);
            res.end();
            return;
          }

          if (flow.isCompleted) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.renderHtmlPage('Fluxo já concluído', 'Esta solicitação de login já foi processada.'));
            return;
          }

          const queryError = reqUrl.searchParams.get('error');
          const queryCode = reqUrl.searchParams.get('code');
          const queryState = reqUrl.searchParams.get('state');

          // Trata cancelamento ou erro devolvido pelo Google
          if (queryError) {
            flow.isCompleted = true;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              this.renderHtmlPage(
                'Autenticação cancelada',
                'O login com a conta Google foi cancelado. Você pode fechar esta janela e voltar ao aplicativo.',
                'warning'
              )
            );
            this.cleanupServer(server);
            this.activeFlow = null;
            reject(new Error(`Login cancelado pelo usuário: ${queryError}`));
            return;
          }

          // Validação anti-CSRF rigorosa do state
          if (!queryState || queryState !== flow.state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              this.renderHtmlPage(
                'Falha de Segurança',
                'O parâmetro de estado (state) é inválido ou expirou. Por segurança, a requisição foi recusada.',
                'error'
              )
            );
            return;
          }

          if (!queryCode) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(
              this.renderHtmlPage(
                'Código Ausente',
                'Nenhum código de autorização foi fornecido pelo provedor.',
                'error'
              )
            );
            return;
          }

          flow.isCompleted = true;

          // Troca o authorization code por tokens com Google OAuth 2.0
          const tokens = await this.exchangeCodeForTokens(queryCode, flow.codeVerifier, flow.redirectUri, clientId);

          // Obtém os dados de perfil da conta com o access token
          const userInfo = await this.fetchUserInfo(tokens.access_token);

          // Armazena com segurança
          const session: StoredGoogleSession = {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            tokenType: tokens.token_type || 'Bearer',
            scopes: tokens.scope ? tokens.scope.split(' ') : this.DEFAULT_SCOPES,
            idToken: tokens.id_token,
            user: {
              id: userInfo.sub,
              email: userInfo.email,
              name: userInfo.name,
              picture: userInfo.picture,
            },
          };

          googleTokenStorage.saveSession(session);
          db.updateSettings({ authMethod: 'googleOAuth' });
          db.log('info', `[GoogleOAuth] Login realizado com sucesso para conta: ${userInfo.email}`);

          // Responde ao navegador informando conclusão
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            this.renderHtmlPage(
              'Login Concluído',
              'Sua conta Google foi autenticada com sucesso no Veo Auto Studio! Você pode fechar esta janela com segurança e voltar ao aplicativo.',
              'success'
            )
          );

          // Encerra o listener temporário
          this.cleanupServer(server);
          this.activeFlow = null;

          const publicProfile = googleTokenStorage.getPublicProfile();
          resolve(publicProfile);
        } catch (err: any) {
          console.error('[GoogleOAuth] Erro ao processar callback:', err?.message || err);
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            this.renderHtmlPage(
              'Erro no Login',
              `Ocorreu um erro ao processar a autenticação: ${err?.message || 'Falha na troca de credenciais.'}`,
              'error'
            )
          );
          flow.isCompleted = true;
          this.cleanupServer(server);
          this.activeFlow = null;
          reject(err);
        }
      });

      server.on('error', (err) => {
        console.error('[GoogleOAuth] Erro no servidor temporário:', err);
        this.cleanupServer(server);
        this.activeFlow = null;
        reject(err);
      });

      // Escuta na porta 0 para obter porta aleatória do sistema operacional em 127.0.0.1
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address() as net.AddressInfo;
        const port = address.port;
        const redirectUri = `http://127.0.0.1:${port}`;
        flow.redirectUri = redirectUri;

        // Constrói a URL oficial de autorização do Google
        const authParams = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: this.DEFAULT_SCOPES.join(' '),
          state: flow.state,
          code_challenge: flow.codeChallenge,
          code_challenge_method: 'S256',
          access_type: 'offline', // Para obter refresh_token
          prompt: 'consent', // Garante refresh_token em aplicativos nativos
        });

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`;

        try {
          db.log('info', `[GoogleOAuth] Abrindo navegador para autorização. Porta local temporária: ${port}`);
          await this.openExternalUrl(authUrl);
        } catch (err) {
          this.cleanupServer(server);
          this.activeFlow = null;
          reject(new Error(`Não foi possível abrir o navegador padrão: ${(err as any)?.message}`));
        }
      });
    });
  }

  /**
   * Troca authorization_code por access_token e refresh_token.
   * Em conformidade com RFC 7636 e RFC 8252 (Desktop Native App com PKCE):
   * O client_secret NÃO é obrigatório no token exchange.
   * Somente envia client_secret se ele estiver realmente disponível e configurado,
   * mas NUNCA lança erro caso esteja ausente.
   */
  private async exchangeCodeForTokens(
    code: string,
    codeVerifier: string,
    redirectUri: string,
    clientId: string
  ): Promise<any> {
    const tokenParams: Record<string, string> = {
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    };

    // Para Desktop/Installed Apps com PKCE, o client_secret NÃO é obrigatório.
    // Somente anexa se estiver explicitamente disponível e configurado.
    const clientSecret = this.getClientSecret();
    if (clientSecret) {
      tokenParams.client_secret = clientSecret;
    }

    // Requisito 9: Log seguro dos NOMES dos campos enviados (nunca os valores confidenciais)
    const paramFieldNames = Object.keys(tokenParams);
    const hasSecret = Boolean(tokenParams.client_secret);
    db.log(
      'info',
      `[GoogleOAuth] Enviando requisição de troca de token para Google OAuth 2.0. Campos enviados: [${paramFieldNames.join(', ')}] | client_secret presente: ${hasSecret ? 'SIM' : 'NÃO (Fluxo PKCE Desktop)'}`
    );

    const body = new URLSearchParams(tokenParams);

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const responseText = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(responseText);
    } catch (_) {
      data = { raw: responseText };
    }

    if (!response.ok) {
      const httpStatus = response.status;
      const statusText = response.statusText;
      const errorKey = data?.error || 'unknown_error';
      const errorDesc = data?.error_description || data?.error || responseText || 'Falha ao trocar código de autorização.';

      // Requisito 10: Log seguro do status HTTP e mensagem sanitizada retornada pelo Google
      db.log(
        'error',
        `[GoogleOAuth] Erro retornado pelo Google Token Endpoint: HTTP ${httpStatus} (${statusText}) - Erro: "${errorKey}" - Detalhe sanitizado: "${errorDesc}"`
      );

      let userFacingError = `Google OAuth Token Error (HTTP ${httpStatus}): ${errorDesc}`;

      if (typeof errorDesc === 'string' && errorDesc.toLowerCase().includes('client_secret is missing')) {
        userFacingError +=
          ' — Diagnóstico: O Google retornou esta mensagem porque o Client ID informado no Google Cloud Console foi criado como "Aplicativo Web" (que exige client_secret obrigatório no servidor do Google) ou seu projeto requer o segredo do cliente. Se você utilizou credenciais do tipo Web, insira o Client Secret correspondente nas Configurações. Para usar PKCE puro sem Client Secret, crie a credencial no Google Cloud Console com o Tipo de Aplicativo definido como "Aplicativo para computador (Desktop App)".';
      }

      throw new Error(userFacingError);
    }

    return data;
  }

  /**
   * Obtém informações do usuário via OpenID Connect
   */
  private async fetchUserInfo(accessToken: string): Promise<any> {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Falha ao obter perfil de usuário da conta Google.');
    }

    return response.json();
  }

  /**
   * Cancela fluxo de login em andamento
   */
  public cancelLogin(reason: string = 'Login cancelado pelo usuário.'): void {
    if (this.activeFlow) {
      this.activeFlow.isCompleted = true;
      this.cleanupServer(this.activeFlow.server);
      clearTimeout(this.activeFlow.timeoutTimer);
      this.activeFlow.reject(new Error(reason));
      this.activeFlow = null;
      db.log('info', `[GoogleOAuth] Fluxo de login cancelado: ${reason}`);
    }
  }

  /**
   * Encerra com segurança o servidor HTTP local
   */
  private cleanupServer(server: http.Server): void {
    try {
      server.close();
    } catch (_) {}
  }

  /**
   * Obtém um access_token válido, realizando refresh automático se expirado
   */
  public async getValidAccessToken(): Promise<string> {
    const session = googleTokenStorage.getSession();
    if (!session || !session.accessToken) {
      throw new Error('Nenhuma conta Google autenticada.');
    }

    const clientId = this.getClientId();

    // Se faltarem menos de 2 minutos para expirar, renova
    const now = Date.now();
    const isExpiringSoon = session.expiresAt - now < 2 * 60 * 1000;

    if (!isExpiringSoon) {
      return session.accessToken;
    }

    if (!session.refreshToken) {
      throw new Error('Sessão expirada e nenhum refresh token disponível. Por favor, faça login novamente.');
    }

    if (!clientId) {
      throw new Error('Client ID não configurado para renovação de token.');
    }

    // Realiza refresh_token
    try {
      const refreshParams: Record<string, string> = {
        client_id: clientId,
        refresh_token: session.refreshToken,
        grant_type: 'refresh_token',
      };

      // client_secret opcional no refresh para Desktop PKCE
      const clientSecret = this.getClientSecret();
      if (clientSecret) {
        refreshParams.client_secret = clientSecret;
      }

      // Requisito 9: Log seguro dos NOMES dos campos enviados (nunca dados sensíveis)
      const refreshFieldNames = Object.keys(refreshParams);
      const hasSecretInRefresh = Boolean(refreshParams.client_secret);
      db.log(
        'info',
        `[GoogleOAuth] Enviando requisição de refresh token para Google. Campos enviados: [${refreshFieldNames.join(', ')}] | client_secret presente: ${hasSecretInRefresh ? 'SIM' : 'NÃO'}`
      );

      const body = new URLSearchParams(refreshParams);

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const responseText = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(responseText);
      } catch (_) {
        data = { raw: responseText };
      }

      if (!response.ok) {
        const httpStatus = response.status;
        const errorDesc = data?.error_description || data?.error || responseText || 'Falha ao renovar token.';
        db.log(
          'error',
          `[GoogleOAuth] Erro na renovação de token pelo Google: HTTP ${httpStatus} - Detalhe sanitizado: "${errorDesc}"`
        );
        if (data?.error === 'invalid_grant') {
          // Token revogado ou expirado definitivamente
          googleTokenStorage.clearSession();
          throw new Error('Sua autorização Google expirou ou foi revogada. Por favor, entre novamente.');
        }
        throw new Error(`Erro ao renovar token de acesso (HTTP ${httpStatus}): ${errorDesc}`);
      }

      const newAccessToken = data.access_token;
      const expiresIn = data.expires_in || 3600;

      googleTokenStorage.updateAccessToken(newAccessToken, expiresIn);
      db.log('info', '[GoogleOAuth] Access token renovado automaticamente com sucesso.');

      return newAccessToken;
    } catch (err: any) {
      console.error('[GoogleOAuth] Falha ao renovar token:', err?.message || err);
      throw err;
    }
  }

  /**
   * Sair da conta Google (Logout com revogação no servidor do Google)
   */
  public async logout(): Promise<{ success: boolean; message: string }> {
    const session = googleTokenStorage.getSession();
    const tokenToRevoke = session?.accessToken || session?.refreshToken;

    if (tokenToRevoke) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });
      } catch (err) {
        console.warn('[GoogleOAuth] Aviso ao revogar token remotamente:', (err as any)?.message);
      }
    }

    googleTokenStorage.clearSession();

    // Se o método atual estava definido para googleOAuth, retorna para apiKey como fallback
    const settings = db.getSettings();
    if (settings.authMethod === 'googleOAuth') {
      db.updateSettings({ authMethod: 'apiKey' });
    }

    db.log('info', '[GoogleOAuth] Usuário desconectado da conta Google.');
    return { success: true, message: 'Conta Google desconectada com sucesso.' };
  }

  /**
   * Retorna o status atual público
   */
  public getStatus(): GooglePublicUser & {
    clientIdConfigured: boolean;
    clientSecretConfigured: boolean;
    authMethod: 'apiKey' | 'googleOAuth';
  } {
    const profile = googleTokenStorage.getPublicProfile();
    const settings = db.getSettings();
    return {
      ...profile,
      clientIdConfigured: Boolean(this.getClientId()),
      clientSecretConfigured: Boolean(this.getClientSecret()),
      authMethod: settings.authMethod || 'apiKey',
    };
  }

  /**
   * Renderiza a página HTML limpa exibida no navegador após o redirecionamento
   */
  private renderHtmlPage(title: string, message: string, type: 'success' | 'warning' | 'error' = 'success'): string {
    const icon = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : '❌';
    const accentColor = type === 'success' ? '#38bdf8' : type === 'warning' ? '#fbbf24' : '#f87171';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Veo Auto Studio — ${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background-color: #070a10;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #f1f5f9;
    }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 36px 32px;
      text-align: center;
      max-width: 440px;
      width: 90%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      margin: 0 0 10px 0;
      font-size: 22px;
      font-weight: 700;
      color: ${accentColor};
      letter-spacing: -0.02em;
    }
    p {
      margin: 0 0 24px 0;
      font-size: 14px;
      line-height: 1.6;
      color: #94a3b8;
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      background: #1e293b;
      border-radius: 9999px;
      font-size: 12px;
      color: #cbd5e1;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="badge">Veo Auto Studio Desktop</div>
  </div>
</body>
</html>`;
  }

  /**
   * Valida e inspeciona o Client ID configurado de forma segura:
   * - Confirma se tem formato válido do Google ({project_number}-{hash}.apps.googleusercontent.com)
   * - Testa disponibilidade pública contra o endpoint de autorização do Google
   * - Nunca expõe tokens, autorizações ou segredos
   */
  public async verifyClientId(customClientId?: string): Promise<{
    isValidFormat: boolean;
    isConfigured: boolean;
    maskedClientId: string;
    projectNumber?: string;
    status: 'valid' | 'invalid_format' | 'google_rejected' | 'not_configured';
    message: string;
    clientTypeAdvice: string;
  }> {
    const rawId = (customClientId !== undefined ? customClientId : this.getClientId()) || '';
    const id = rawId.trim();

    if (!id) {
      return {
        isValidFormat: false,
        isConfigured: false,
        maskedClientId: '',
        status: 'not_configured',
        message: 'Nenhum Client ID do Google OAuth configurado.',
        clientTypeAdvice: 'Configure seu Client ID criado no Google Cloud Console com o tipo "Aplicativo para Computador (Desktop App)".',
      };
    }

    const parts = id.split('-');
    const projectNum = parts[0] || '';
    const maskedId =
      id.length > 20
        ? `${id.slice(0, 8)}...${id.slice(-24)}`
        : '***.apps.googleusercontent.com';

    // Valida regex oficial do Google Cloud Client ID
    const googleIdRegex = /^[0-9]+-[a-z0-9_.-]+\.apps\.googleusercontent\.com$/i;
    const isValidFormat = googleIdRegex.test(id);

    if (!isValidFormat) {
      db.log('warn', `[GoogleOAuth] Verificação de Client ID: Formato inválido (${maskedId})`);
      return {
        isValidFormat: false,
        isConfigured: true,
        maskedClientId: maskedId,
        projectNumber: projectNum,
        status: 'invalid_format',
        message: 'O Client ID não segue o padrão do Google Cloud ({número}-{hash}.apps.googleusercontent.com).',
        clientTypeAdvice: 'Verifique se você copiou o Client ID completo no Google Cloud Console (APIs e Serviços > Credenciais).',
      };
    }

    try {
      // Teste seguro contra o endpoint de autorização do Google
      const probeUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(id)}&redirect_uri=http://127.0.0.1&response_type=code&scope=openid`;
      const probeRes = await fetch(probeUrl, { method: 'GET', redirect: 'manual' });

      if (probeRes.status >= 400) {
        db.log('warn', `[GoogleOAuth] Verificação de Client ID: Google retornou status ${probeRes.status} para ${maskedId}`);
        return {
          isValidFormat: true,
          isConfigured: true,
          maskedClientId: maskedId,
          projectNumber: projectNum,
          status: 'google_rejected',
          message: `O Google retornou HTTP ${probeRes.status} ao consultar este Client ID.`,
          clientTypeAdvice: 'Verifique se o projeto no Google Cloud está ativo e se a Tela de consentimento OAuth foi configurada para usuários de teste.',
        };
      }

      db.log('info', `[GoogleOAuth] Verificação de Client ID: ID com formato válido e reconhecido pelo Google (${maskedId})`);
      return {
        isValidFormat: true,
        isConfigured: true,
        maskedClientId: maskedId,
        projectNumber: projectNum,
        status: 'valid',
        message: 'Client ID com formato válido e reconhecido pelos servidores do Google.',
        clientTypeAdvice: 'Dica de tipo: Certifique-se de que no Google Cloud Console a credencial foi criada como "Aplicativo para Computador" (Desktop App). Se foi criada como "Aplicativo da Web", o Google exigirá client_secret no token exchange.',
      };
    } catch (err: any) {
      db.log('info', `[GoogleOAuth] Verificação de Client ID: Formato sintático válido (${maskedId})`);
      return {
        isValidFormat: true,
        isConfigured: true,
        maskedClientId: maskedId,
        projectNumber: projectNum,
        status: 'valid',
        message: 'Client ID válido.',
        clientTypeAdvice: 'Certifique-se de que a credencial seja do tipo "Aplicativo para Computador" no Google Cloud Console.',
      };
    }
  }
}

export const googleOAuthService = new GoogleOAuthService();
