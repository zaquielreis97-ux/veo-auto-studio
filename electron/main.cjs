const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

let mainWindow = null;
let serverProcess = null;

function checkServerRunning(port = 3000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => {
      const req2 = http.get(`http://localhost:${port}/api/health`, (res2) => {
        resolve(res2.statusCode === 200);
      });
      req2.on('error', () => resolve(false));
      req2.setTimeout(800, () => {
        req2.destroy();
        resolve(false);
      });
    });
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function killServerProcess() {
  if (serverProcess) {
    try {
      console.log('[Electron] Encerrando processo do servidor backend...');
      if (process.platform === 'win32' && serverProcess.pid) {
        const { execSync } = require('child_process');
        try {
          execSync(`taskkill /pid ${serverProcess.pid} /T /F`, { stdio: 'ignore' });
        } catch (_) {
          serverProcess.kill('SIGTERM');
        }
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch (err) {
      console.error('[Electron] Erro ao encerrar processo do servidor:', err);
    }
    serverProcess = null;
  }
}

async function startEmbeddedServerIfNeeded() {
  const isRunning = await checkServerRunning(3000);
  if (isRunning) {
    console.log('[Electron] Servidor backend já está ativo na porta 3000.');
    return true;
  }

  console.log('[Electron] Servidor backend não detectado na porta 3000. Iniciando servidor local...');

  // Set environment variables for production embedded server
  process.env.PORT = '3000';
  if (app.isPackaged) {
    process.env.NODE_ENV = 'production';
  }

  const rootDir = path.resolve(__dirname, '..');
  const candidatePaths = [
    path.join(__dirname, '../dist/server.cjs'),
    path.join(rootDir, 'dist/server.cjs'),
    path.join(process.resourcesPath || '', 'app.asar', 'dist', 'server.cjs'),
    path.join(process.resourcesPath || '', 'app', 'dist', 'server.cjs'),
    path.join(app.getAppPath ? app.getAppPath() : '', 'dist', 'server.cjs'),
  ];

  let serverBundlePath = null;
  for (const p of candidatePaths) {
    try {
      if (p && fs.existsSync(p)) {
        serverBundlePath = p;
        break;
      }
    } catch (_) {}
  }

  // 1. In-process execution of server.cjs:
  // The Electron main process is already a full Node.js runtime with native ASAR support.
  // Loading server.cjs via require() eliminates all spawn ENOENT errors, eliminates the need for an external node.exe,
  // and starts the Express server instantly on 127.0.0.1:3000.
  if (serverBundlePath) {
    try {
      console.log(`[Electron] Carregando backend em processo: "${serverBundlePath}"...`);
      process.env.NODE_ENV = process.env.NODE_ENV || 'production';
      require(serverBundlePath);
      console.log('[Electron] Módulo backend inicializado no processo principal.');
    } catch (err) {
      console.error('[Electron] Erro ao carregar server.cjs via require:', err);
    }
  } else if (!app.isPackaged) {
    // 2. Dev mode fallback when dist/server.cjs has not been built yet
    const serverTsPath = path.join(rootDir, 'server.ts');
    if (fs.existsSync(serverTsPath)) {
      console.log('[Electron Dev] Iniciando backend a partir de server.ts com tsx...');
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'npx.cmd' : 'npx';
      serverProcess = spawn(cmd, ['tsx', 'server.ts'], {
        cwd: rootDir,
        env: { ...process.env, NODE_ENV: 'development', PORT: '3000' },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      if (serverProcess) {
        serverProcess.stdout.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) console.log(`[Backend] ${msg}`);
        });

        serverProcess.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          if (msg) console.error(`[Backend Erro] ${msg}`);
        });

        serverProcess.on('error', (err) => {
          console.error('[Electron] Falha ao iniciar processo do servidor backend:', err);
        });

        serverProcess.on('exit', (code, signal) => {
          console.log(`[Electron] Processo do servidor finalizado (code: ${code}, signal: ${signal})`);
          serverProcess = null;
        });
      }
    } else {
      console.error('[Electron] Nem dist/server.cjs nem server.ts foram encontrados.');
      return false;
    }
  } else {
    console.error('[Electron] ERRO CRÍTICO: dist/server.cjs não foi encontrado no pacote da aplicação.');
  }

  // Wait for server to become responsive on port 3000
  console.log('[Electron] Aguardando confirmação do servidor na porta 3000...');
  let attempts = 0;
  const maxAttempts = 40; // 40 * 250ms = 10s
  while (attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 250));
    const ready = await checkServerRunning(3000);
    if (ready) {
      console.log(`[Electron] Servidor backend verificado e pronto na porta 3000 após ${attempts + 1} tentativa(s).`);
      return true;
    }
    attempts++;
  }

  console.warn('[Electron] Tempo limite atingido ao aguardar o servidor na porta 3000.');
  return false;
}

async function createWindow() {
  const serverReady = await startEmbeddedServerIfNeeded();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#070a10',
    title: 'Veo Auto Studio — Professional Sales Video Suite',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false,
    },
  });

  // Load URL from local server with fallback
  mainWindow.loadURL('http://127.0.0.1:3000').catch((err) => {
    console.warn('[Electron] Falha ao carregar http://127.0.0.1:3000, tentando http://localhost:3000...', err);
    mainWindow.loadURL('http://localhost:3000').catch(() => {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Secure Storage IPC
const KEY_STORAGE_FILE = path.join(app.getPath('userData'), 'secure_key.dat');

ipcMain.handle('secure:saveApiKey', async (event, apiKey) => {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(apiKey);
      fs.writeFileSync(KEY_STORAGE_FILE, encrypted);
      process.env.GEMINI_API_KEY = apiKey;
      return { success: true };
    } else {
      // Fallback base64 obfuscation for environments without OS keychain
      const buf = Buffer.from(apiKey, 'utf-8');
      fs.writeFileSync(KEY_STORAGE_FILE, buf);
      process.env.GEMINI_API_KEY = apiKey;
      return { success: true, warning: 'OS encryption fallback used' };
    }
  } catch (err) {
    console.error('Failed to securely save API key:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('secure:getApiKey', async () => {
  try {
    if (fs.existsSync(KEY_STORAGE_FILE)) {
      const raw = fs.readFileSync(KEY_STORAGE_FILE);
      if (safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(raw);
        return { success: true, apiKey: decrypted };
      } else {
        return { success: true, apiKey: raw.toString('utf-8') };
      }
    }
    return { success: false, apiKey: null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Native folder picker
ipcMain.handle('dialog:selectDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Selecione a pasta de saída para as campanhas do Veo Auto Studio',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Native files picker (videos/audios)
ipcMain.handle('dialog:selectFiles', async (event, options) => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: options?.filters || [
      { name: 'Vídeos e Áudios', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'aac', 'm4a'] },
      { name: 'Vídeos (*.mp4, *.mov, *.webm, *.mkv)', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'] },
      { name: 'Áudios (*.mp3, *.wav, *.aac, *.m4a)', extensions: ['mp3', 'wav', 'aac', 'm4a'] },
      { name: 'Todos os Arquivos', extensions: ['*'] }
    ],
    title: options?.title || 'Selecionar arquivos de mídia local',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }
  return result.filePaths;
});

// Shell open path in Windows Explorer
ipcMain.handle('shell:openPath', async (event, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    await shell.openPath(folderPath);
    return true;
  }
  return false;
});

ipcMain.handle('shell:showItemInFolder', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

// ==========================================
// GOOGLE OAUTH 2.0 PKCE IPC HANDLERS
// ==========================================
function makeLocalApiRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path: endpoint,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve({ error: 'Resposta inválida do backend local' });
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Tempo limite de requisição ao backend local'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

ipcMain.handle('google-auth:status', async () => {
  try {
    return await makeLocalApiRequest('GET', '/api/auth/google/status');
  } catch (err) {
    return { authenticated: false, error: err.message };
  }
});

ipcMain.handle('google-auth:start', async () => {
  try {
    // Timeout maior para o fluxo do navegador
    return await new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port: 3000,
        path: '/api/auth/google/start',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ error: 'Falha ao processar resposta do login' });
          }
        });
      });
      req.on('error', reject);
      // Timeout do fluxo de login (6 minutos para cobrir os 5 minutos do serviço)
      req.setTimeout(360000, () => {
        req.destroy();
        reject(new Error('Tempo limite de autenticação atingido'));
      });
      req.end();
    });
  } catch (err) {
    return { authenticated: false, error: err.message };
  }
});

ipcMain.handle('google-auth:logout', async () => {
  try {
    return await makeLocalApiRequest('POST', '/api/auth/google/logout');
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('google-auth:cancel', async () => {
  try {
    return await makeLocalApiRequest('POST', '/api/auth/google/cancel');
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('google-auth:setConfig', async (event, payload) => {
  try {
    const body = typeof payload === 'string' ? { clientId: payload } : payload;
    return await makeLocalApiRequest('POST', '/api/auth/google/config', body);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('google-auth:verifyClientId', async (event, clientId) => {
  try {
    const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
    return await makeLocalApiRequest('GET', `/api/auth/google/verify-client-id${query}`);
  } catch (err) {
    return { isValidFormat: false, error: err.message };
  }
});

// ==========================================
// AUTO-UPDATER CONFIGURATION & IPC HANDLERS
// ==========================================
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdaterStatus(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', data);
  }
}

autoUpdater.on('checking-for-update', () => {
  console.log('[AutoUpdater] Verificando atualizações no GitHub Releases...');
  sendUpdaterStatus({ status: 'checking' });
});

autoUpdater.on('update-available', (info) => {
  console.log('[AutoUpdater] Nova versão disponível:', info?.version);
  sendUpdaterStatus({
    status: 'available',
    version: info?.version,
    releaseDate: info?.releaseDate,
    releaseNotes:
      typeof info?.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info?.releaseNotes)
        ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
        : undefined,
  });
});

autoUpdater.on('update-not-available', (info) => {
  console.log('[AutoUpdater] Nenhuma atualização disponível. O app está atualizado:', info?.version || app.getVersion());
  sendUpdaterStatus({
    status: 'not-available',
    version: info?.version || app.getVersion(),
  });
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`[AutoUpdater] Download da atualização: ${progressObj.percent?.toFixed(1)}%`);
  sendUpdaterStatus({
    status: 'downloading',
    percent: progressObj.percent,
    bytesPerSecond: progressObj.bytesPerSecond,
    transferred: progressObj.transferred,
    total: progressObj.total,
  });
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[AutoUpdater] Download concluído com sucesso. Versão pronta:', info?.version);
  sendUpdaterStatus({
    status: 'downloaded',
    version: info?.version,
  });
});

autoUpdater.on('error', (err) => {
  console.error('[AutoUpdater] Erro no updater:', err);
  sendUpdaterStatus({
    status: 'error',
    error: err ? err.message || String(err) : 'Erro desconhecido durante a atualização',
  });
});

// Updater IPC Handlers
ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) {
    return {
      success: false,
      status: 'dev-mode',
      message: 'Verificação de atualizações desativada em ambiente de desenvolvimento (app.isPackaged = false).',
      currentVersion: app.getVersion(),
    };
  }

  try {
    console.log('[IPC] Solicitada verificação manual de atualização...');
    const result = await autoUpdater.checkForUpdates();
    return {
      success: true,
      updateInfo: result?.updateInfo,
      currentVersion: app.getVersion(),
    };
  } catch (err) {
    console.error('[IPC] Erro ao verificar atualização:', err);
    return {
      success: false,
      error: err?.message || 'Erro ao conectar ao GitHub Releases',
      currentVersion: app.getVersion(),
    };
  }
});

ipcMain.handle('updater:download', async () => {
  if (!app.isPackaged) {
    return { success: false, message: 'Download desativado em modo de desenvolvimento.' };
  }

  try {
    console.log('[IPC] Iniciando download do pacote de atualização...');
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    console.error('[IPC] Erro ao baixar atualização:', err);
    return { success: false, error: err?.message || 'Falha no download da atualização' };
  }
});

ipcMain.handle('updater:install', () => {
  console.log('[IPC] Reiniciando aplicativo para aplicar atualização...');
  // isSilent = false, isForceRunAfter = true
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('updater:getVersion', () => {
  return app.getVersion();
});

ipcMain.handle('updater:isPackaged', () => {
  return app.isPackaged;
});

// ==========================================
// APPLICATION LIFECYCLE (CONSOLIDATED)
// ==========================================
app.whenReady().then(async () => {
  await createWindow();

  // Non-blocking auto-check when packaged (waits 4s for UI readiness)
  if (app.isPackaged) {
    setTimeout(() => {
      console.log('[AutoUpdater] Executando verificação de atualização em segundo plano...');
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[AutoUpdater] Verificação automática inicial ignorada silenciosamente:', err?.message);
      });
    }, 4000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  killServerProcess();
});

app.on('will-quit', () => {
  killServerProcess();
});

app.on('window-all-closed', () => {
  killServerProcess();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

process.on('exit', () => {
  killServerProcess();
});

process.on('SIGINT', () => {
  killServerProcess();
  process.exit(0);
});

process.on('SIGTERM', () => {
  killServerProcess();
  process.exit(0);
});
