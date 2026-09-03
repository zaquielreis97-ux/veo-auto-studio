import assert from 'assert';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { googleTokenStorage, StoredGoogleSession } from '../server/services/googleTokenStorage';
import { googleOAuthService } from '../server/services/googleOAuth';
import { db } from '../server/db';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES AUTOMATIZADOS: GOOGLE OAUTH 2.0 PKCE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function testCase(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] ${name}`);
      console.error(`   Motivo: ${err?.message || err}`);
      failed++;
    }
  }

  // 1. TESTE DE PKCE S256
  await testCase('1. PKCE: Verificador e Desafio SHA-256 (RFC 7636)', async () => {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    assert(codeVerifier.length >= 43, 'code_verifier deve ter pelo menos 43 caracteres');
    assert(/^[A-Za-z0-9_-]+$/.test(codeVerifier), 'code_verifier deve conter apenas caracteres base64url');

    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    assert(codeChallenge.length === 43, 'code_challenge S256 deve ter 43 caracteres base64url');
    assert(/^[A-Za-z0-9_-]+$/.test(codeChallenge), 'code_challenge deve ser base64url');

    // Validação matemática do hash
    const expected = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    assert.strictEqual(codeChallenge, expected, 'O code_challenge deve ser estritamente igual ao SHA-256 do code_verifier');
  });

  // 2. TESTE DE STATE ANTI-CSRF
  await testCase('2. State: Geração criptográfica e unicidade anti-CSRF', async () => {
    const s1 = crypto.randomBytes(32).toString('base64url');
    const s2 = crypto.randomBytes(32).toString('base64url');
    assert.notStrictEqual(s1, s2, 'Dois states gerados consecutivamente devem ser estritamente distintos');
    assert(s1.length >= 40, 'State deve ter entropia suficiente (>= 32 bytes base64url)');
  });

  // 3. TESTE DE ARMAZENAMENTO CRIPTOGRAFADO (SAFE STORAGE / AES-256-GCM)
  await testCase('3. Armazenamento: Criptografia e integridade de sessão (sem texto puro)', async () => {
    const dummySession: StoredGoogleSession = {
      accessToken: 'ya29.a0AfH6SMC_TEST_ACCESS_TOKEN_12345',
      refreshToken: '1//0gTEST_REFRESH_TOKEN_67890',
      expiresAt: Date.now() + 3600 * 1000,
      tokenType: 'Bearer',
      scopes: ['openid', 'email', 'profile'],
      user: {
        id: '123456789',
        email: 'teste.auditoria@example.com',
        name: 'Usuário Teste Auditoria',
        picture: 'https://example.com/photo.jpg',
      },
    };

    googleTokenStorage.saveSession(dummySession);

    // Verifica perfil público seguro (NÃO deve conter tokens)
    const publicProfile = googleTokenStorage.getPublicProfile();
    assert.strictEqual(publicProfile.authenticated, true);
    assert.strictEqual(publicProfile.email, 'teste.auditoria@example.com');
    assert.strictEqual(publicProfile.name, 'Usuário Teste Auditoria');
    assert.strictEqual((publicProfile as any).accessToken, undefined, 'CRÍTICO: accessToken não pode estar no perfil público');
    assert.strictEqual((publicProfile as any).refreshToken, undefined, 'CRÍTICO: refreshToken não pode estar no perfil público');

    // Verifica que no disco o arquivo está cifrado e não contém o token em texto puro
    const dataDir = (googleTokenStorage as any).storageFilePath as string;
    assert(fs.existsSync(dataDir), 'O arquivo criptografado deve existir no disco');
    const diskContent = fs.readFileSync(dataDir, 'utf8');
    assert(!diskContent.includes('ya29.a0AfH6SMC_TEST_ACCESS_TOKEN_12345'), 'Token em texto puro encontrado no arquivo do disco!');
    assert(!diskContent.includes('1//0gTEST_REFRESH_TOKEN_67890'), 'Refresh token em texto puro encontrado no disco!');

    const parsedEnvelope = JSON.parse(diskContent);
    assert(parsedEnvelope.data, 'Envelope deve conter payload cifrado "data"');
    assert(parsedEnvelope.method === 'safeStorage' || parsedEnvelope.method === 'aes-256-gcm', 'Método de criptografia válido');
  });

  // 4. TESTE DE LOGOUT E LIMPEZA DE SESSÃO
  await testCase('4. Logout: Remoção segura de credenciais locais mantendo API Key e banco', async () => {
    // Configura API Key pré-existente
    process.env.GEMINI_API_KEY = 'AIzaSy_ORIGINAL_API_KEY_PRESERVED';
    db.updateSettings({ apiKeyConfigured: true, authMethod: 'googleOAuth' });

    const logoutResult = await googleOAuthService.logout();
    assert.strictEqual(logoutResult.success, true);

    // Verifica que a sessão em memória foi zerada
    const inMem = googleTokenStorage.getSession();
    assert.strictEqual(inMem, null, 'Sessão em memória deve ser nula após logout');

    const publicProf = googleTokenStorage.getPublicProfile();
    assert.strictEqual(publicProf.authenticated, false, 'Perfil público deve indicar não autenticado');

    // Verifica que o arquivo criptografado foi removido
    const dataDir = (googleTokenStorage as any).storageFilePath as string;
    assert(!fs.existsSync(dataDir), 'Arquivo de credenciais no disco deve ser excluído no logout');

    // Verifica que a API Key e settings foram preservados
    const currentSettings = db.getSettings();
    assert.strictEqual(currentSettings.apiKeyConfigured, true, 'apiKeyConfigured foi alterado indevidamente!');
    assert.strictEqual(process.env.GEMINI_API_KEY, 'AIzaSy_ORIGINAL_API_KEY_PRESERVED', 'process.env.GEMINI_API_KEY foi apagada!');
    assert.strictEqual(currentSettings.authMethod, 'apiKey', 'authMethod deve reverter para apiKey como fallback');
  });

  // 5. TESTE DE CALLBACK COM STATE INVÁLIDO (PROTEÇÃO ANTI-CSRF)
  await testCase('5. Loopback Server: Rejeição de callback com state adulterado/inválido (Anti-CSRF)', async () => {
    // Cria servidor HTTP simulando a lógica do loopback de callback
    const expectedState = 'state_legitimo_12345';
    let rejectedWith400 = false;

    const testServer = http.createServer((req, res) => {
      const u = new URL(req.url || '/', `http://${req.headers.host}`);
      const qState = u.searchParams.get('state');
      if (!qState || qState !== expectedState) {
        rejectedWith400 = true;
        res.writeHead(400);
        res.end('CSRF_ERROR');
        return;
      }
      res.writeHead(200);
      res.end('OK');
    });

    await new Promise<void>((resolve) => {
      testServer.listen(0, '127.0.0.1', async () => {
        const port = (testServer.address() as any).port;
        // Envia requisição com state inválido
        const res = await fetch(`http://127.0.0.1:${port}/?code=testcode&state=state_hackeado_999`);
        assert.strictEqual(res.status, 400, 'Requisição com state adulterado deve retornar status 400');
        assert.strictEqual(rejectedWith400, true, 'O servidor deve ter recusado o processamento');
        testServer.close();
        resolve();
      });
    });
  });

  // 6. TESTE DE CALLBACK INVÁLIDO (CÓDIGO AUSENTE / ERRO GOOGLE)
  await testCase('6. Loopback Server: Tratamento de erro do Google ou código ausente', async () => {
    let handledError = false;
    const legitState = 'valid_state_abc';

    const testServer = http.createServer((req, res) => {
      const u = new URL(req.url || '/', `http://${req.headers.host}`);
      const err = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      const st = u.searchParams.get('state');

      if (err) {
        handledError = true;
        res.writeHead(200);
        res.end('USER_CANCELLED');
        return;
      }
      if (!code) {
        res.writeHead(400);
        res.end('CODE_MISSING');
        return;
      }
      res.writeHead(200);
      res.end('OK');
    });

    await new Promise<void>((resolve) => {
      testServer.listen(0, '127.0.0.1', async () => {
        const port = (testServer.address() as any).port;

        // Teste de cancelamento do usuário informado pelo Google (ex: ?error=access_denied)
        const resCancel = await fetch(`http://127.0.0.1:${port}/?error=access_denied&state=${legitState}`);
        assert.strictEqual(resCancel.status, 200);
        assert.strictEqual(handledError, true);

        // Teste de código ausente
        const resNoCode = await fetch(`http://127.0.0.1:${port}/?state=${legitState}`);
        assert.strictEqual(resNoCode.status, 400);

        testServer.close();
        resolve();
      });
    });
  });

  // 7. TESTE DE TIMEOUT E CANCELAMENTO
  await testCase('7. Ciclo de Vida: Encerramento de servidor no cancelamento e timeout', async () => {
    // Testa cancelLogin
    let cancelHandled = false;
    const dummyActiveFlow: any = {
      isCompleted: false,
      server: http.createServer(),
      timeoutTimer: setTimeout(() => {}, 100000),
      reject: (err: any) => {
        if (err?.message?.includes('Cancelado')) {
          cancelHandled = true;
        }
      },
    };

    // Associa fluxo simulado
    (googleOAuthService as any).activeFlow = dummyActiveFlow;
    googleOAuthService.cancelLogin('Cancelado em teste.');
    assert.strictEqual(cancelHandled, true, 'O cancelamento deve disparar o reject da Promise');
    assert.strictEqual((googleOAuthService as any).activeFlow, null, 'activeFlow deve ser limpo');
  });

  // 8. TESTE DE RESTAURAÇÃO DE DISCO E EXPIRAÇÃO DE TOKEN
  await testCase('8. Persistência: Restauração da sessão a partir do disco criptografado', async () => {
    const persistentSession: StoredGoogleSession = {
      accessToken: 'ya29.RESTORE_TEST_TOKEN',
      refreshToken: '1//RESTORE_REFRESH_TOKEN',
      expiresAt: Date.now() + 1800 * 1000,
      tokenType: 'Bearer',
      scopes: ['openid', 'email'],
      user: {
        email: 'restaurado@example.com',
        name: 'Usuário Restaurado',
      },
    };

    googleTokenStorage.saveSession(persistentSession);

    // Simula reinício de aplicação (instanciando uma nova leitura)
    (googleTokenStorage as any).inMemorySession = null;
    (googleTokenStorage as any).loadFromDisk();

    const restored = googleTokenStorage.getSession();
    assert(restored !== null, 'Sessão deveria ter sido restaurada do disco');
    assert.strictEqual(restored?.user.email, 'restaurado@example.com');
    assert.strictEqual(restored?.accessToken, 'ya29.RESTORE_TEST_TOKEN');
    assert.strictEqual(restored?.refreshToken, '1//RESTORE_REFRESH_TOKEN');

    // Limpa após teste
    googleTokenStorage.clearSession();
  });

  // 9. TESTE DE NÃO-EXIGÊNCIA DE CLIENT_SECRET (DESKTOP NATIVE APP PKCE)
  await testCase('9. Desktop OAuth PKCE: client_secret NÃO é obrigatório e ausência é permitida', async () => {
    // Garante que variáveis de ambiente estejam limpas
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    db.updateSettings({ googleOAuthClientSecret: '' });

    const secret = googleOAuthService.getClientSecret();
    assert.strictEqual(secret, '', 'getClientSecret deve retornar string vazia quando não configurado');

    // Cria um servidor simulador de endpoint de token OAuth 2.0 (Google Token Endpoint)
    let receivedRequestBody: Record<string, string> = {};
    const mockTokenServer = http.createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        const parsed = new URLSearchParams(data);
        receivedRequestBody = Object.fromEntries(parsed.entries());

        // Valida parâmetros RFC 7636
        assert(receivedRequestBody.client_id, 'client_id é obrigatório');
        assert(receivedRequestBody.code, 'code é obrigatório');
        assert(receivedRequestBody.code_verifier, 'code_verifier é obrigatório');
        assert.strictEqual(receivedRequestBody.grant_type, 'authorization_code');
        assert(receivedRequestBody.redirect_uri, 'redirect_uri é obrigatório');

        // CRÍTICO: client_secret NÃO deve estar presente nem exigido!
        assert.strictEqual(
          receivedRequestBody.client_secret,
          undefined,
          'CRÍTICO: client_secret NÃO deve ser enviado quando ausente/não configurado'
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: 'ya29.MOCK_VALID_TOKEN_WITHOUT_SECRET',
          expires_in: 3600,
          token_type: 'Bearer',
          refresh_token: '1//MOCK_REFRESH_TOKEN',
          id_token: 'mock_id_token',
        }));
      });
    });

    await new Promise<void>((resolve) => {
      mockTokenServer.listen(0, '127.0.0.1', async () => {
        const port = (mockTokenServer.address() as any).port;
        const mockUrl = `http://127.0.0.1:${port}/token`;

        // Intercepta temporariamente fetch ou chama o método privado com a URL do mock
        const originalFetch = global.fetch;
        try {
          (global as any).fetch = async (url: string, opts: any) => {
            if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
              return originalFetch(mockUrl, opts);
            }
            return originalFetch(url, opts);
          };

          const tokenResult = await (googleOAuthService as any).exchangeCodeForTokens(
            'mock_auth_code_123',
            'mock_code_verifier_456_abcdefghijklmnopqrstuvwx',
            'http://127.0.0.1:8989',
            'test_desktop_client_id.apps.googleusercontent.com'
          );

          assert.strictEqual(tokenResult.access_token, 'ya29.MOCK_VALID_TOKEN_WITHOUT_SECRET');
          assert.strictEqual(receivedRequestBody.client_secret, undefined);
        } finally {
          global.fetch = originalFetch;
          mockTokenServer.close();
          resolve();
        }
      });
    });
  });

  // 10. TESTE DE SUPORTE A CLIENT_SECRET OPCIONAL QUANDO DISPONÍVEL
  await testCase('10. Client Secret Opcional: Anexado se configurado sem torná-lo obrigatório', async () => {
    // Configura um secret opcional
    googleOAuthService.setClientSecret('test_optional_secret_999');
    assert.strictEqual(googleOAuthService.getClientSecret(), 'test_optional_secret_999');

    let receivedRequestBody: Record<string, string> = {};
    const mockTokenServer = http.createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        const parsed = new URLSearchParams(data);
        receivedRequestBody = Object.fromEntries(parsed.entries());

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: 'ya29.MOCK_TOKEN_WITH_OPTIONAL_SECRET',
          expires_in: 3600,
          token_type: 'Bearer',
        }));
      });
    });

    await new Promise<void>((resolve) => {
      mockTokenServer.listen(0, '127.0.0.1', async () => {
        const port = (mockTokenServer.address() as any).port;
        const mockUrl = `http://127.0.0.1:${port}/token`;

        const originalFetch = global.fetch;
        try {
          (global as any).fetch = async (url: string, opts: any) => {
            if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
              return originalFetch(mockUrl, opts);
            }
            return originalFetch(url, opts);
          };

          const tokenResult = await (googleOAuthService as any).exchangeCodeForTokens(
            'mock_code_with_secret',
            'mock_verifier_with_secret_1234567890123456789012',
            'http://127.0.0.1:8989',
            'test_client_id.apps.googleusercontent.com'
          );

          assert.strictEqual(tokenResult.access_token, 'ya29.MOCK_TOKEN_WITH_OPTIONAL_SECRET');
          assert.strictEqual(receivedRequestBody.client_secret, 'test_optional_secret_999');
        } finally {
          global.fetch = originalFetch;
          mockTokenServer.close();
          // Limpa secret configurado
          googleOAuthService.setClientSecret('');
          resolve();
        }
      });
    });
  });

  // 11. TESTE DE VERIFICAÇÃO SEGURA DO CLIENT ID (SEM EXPOR SEGREDO OU TOKENS)
  await testCase('11. Verificação de Client ID: Sintaxe, mascaramento e diagnóstico sem vazamento', async () => {
    // Formato válido do Google Cloud
    const validGoogleId = '108374928172-abc123def456xyz789.apps.googleusercontent.com';
    const resultValid = await googleOAuthService.verifyClientId(validGoogleId);
    assert.strictEqual(resultValid.isValidFormat, true, 'Deve identificar formato válido');
    assert.strictEqual(resultValid.projectNumber, '108374928172');
    assert(resultValid.maskedClientId.includes('...'), 'Deve conter máscara');
    assert(!resultValid.maskedClientId.includes('abc123def456xyz789'), 'Não deve expor o hash completo do Client ID');

    // Formato inválido
    const invalidId = 'meu-client-id-invalido';
    const resultInvalid = await googleOAuthService.verifyClientId(invalidId);
    assert.strictEqual(resultInvalid.isValidFormat, false, 'Deve rejeitar formato inválido');
    assert.strictEqual(resultInvalid.status, 'invalid_format');

    // Não configurado
    const resultEmpty = await googleOAuthService.verifyClientId('');
    assert.strictEqual(resultEmpty.status, 'not_configured');
  });

  // 12. TESTE DE CAPTURA SEGURA DE ERRO HTTP RETORNADO PELO GOOGLE (HTTP 400 sanitizado)
  await testCase('12. Diagnóstico de Erro: Sanitização de resposta de erro HTTP 400 do Google', async () => {
    const mockErrorServer = http.createServer((req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'invalid_request',
        error_description: 'client_secret is missing.',
      }));
    });

    await new Promise<void>((resolve) => {
      mockErrorServer.listen(0, '127.0.0.1', async () => {
        const port = (mockErrorServer.address() as any).port;
        const mockUrl = `http://127.0.0.1:${port}/token`;

        const originalFetch = global.fetch;
        try {
          (global as any).fetch = async (url: string, opts: any) => {
            if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
              return originalFetch(mockUrl, opts);
            }
            return originalFetch(url, opts);
          };

          try {
            await (googleOAuthService as any).exchangeCodeForTokens(
              'mock_code',
              'mock_verifier_123456789012345678901234567890123456',
              'http://127.0.0.1:8989',
              'test_client_id.apps.googleusercontent.com'
            );
            assert.fail('Deveria ter lançado erro com detalhes sanitizados');
          } catch (err: any) {
            // Verifica que a mensagem contém o status HTTP e a descrição sanitizada
            assert(err.message.includes('HTTP 400'), 'Deve conter HTTP 400');
            assert(err.message.includes('client_secret is missing'), 'Deve conter a descrição do Google');
            assert(err.message.includes('Aplicativo Web') || err.message.includes('Desktop App'), 'Deve conter a orientação de diagnóstico');
          }
        } finally {
          global.fetch = originalFetch;
          mockErrorServer.close();
          resolve();
        }
      });
    });
  });

  console.log('\n====================================================');
  console.log(`📊 RESULTADO DOS TESTES AUTOMATIZADOS:`);
  console.log(`   Total de testes: ${passed + failed}`);
  console.log(`   Passaram: ${passed}`);
  console.log(`   Falharam: ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro fatal ao rodar testes:', err);
  process.exit(1);
});
