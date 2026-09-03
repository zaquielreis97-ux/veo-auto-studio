import React, { useState, useEffect } from 'react';
import {
  Settings,
  Key,
  ShieldCheck,
  Cpu,
  Folder,
  Sliders,
  Check,
  AlertCircle,
  Save,
  Radio,
  ExternalLink,
  Lock,
  Layers,
  Sparkles,
  Download,
  RefreshCw,
  CheckCircle2,
  ArrowUpCircle,
  AlertTriangle,
  User,
  LogIn,
  LogOut,
  Globe,
  HelpCircle,
  Info,
  Search,
} from 'lucide-react';
import { AppSettings, GoogleAuthStatus, UpdaterStatusData } from '../types';

interface SettingsViewProps {
  settings: AppSettings | null;
  googleAuth?: GoogleAuthStatus | null;
  onSaveSettings: (settings: Partial<AppSettings> & { apiKey?: string }) => Promise<void>;
  onTestConnection: (apiKey?: string) => Promise<{ success: boolean; message: string; modelsAvailable?: string[] }>;
  onRefreshGoogleAuth?: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  googleAuth: initialGoogleAuth,
  onSaveSettings,
  onTestConnection,
  onRefreshGoogleAuth,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [authMethod, setAuthMethod] = useState<'apiKey' | 'googleOAuth'>(
    settings?.authMethod || 'apiKey'
  );
  const [googleClientId, setGoogleClientId] = useState(settings?.googleOAuthClientId || '');
  const [googleClientSecret, setGoogleClientSecret] = useState(settings?.googleOAuthClientSecret || '');
  const [googleAuth, setGoogleAuth] = useState<GoogleAuthStatus | null>(initialGoogleAuth || null);
  const [isGoogleLoggingIn, setIsGoogleLoggingIn] = useState(false);
  const [googleLoginMessage, setGoogleLoginMessage] = useState('');
  const [googleLoginError, setGoogleLoginError] = useState('');
  const [clientIdSaved, setClientIdSaved] = useState(false);
  const [showCloudGuide, setShowCloudGuide] = useState(false);
  const [isVerifyingClientId, setIsVerifyingClientId] = useState(false);
  const [clientIdVerification, setClientIdVerification] = useState<{
    isValidFormat: boolean;
    isConfigured: boolean;
    maskedClientId: string;
    projectNumber?: string;
    status: string;
    message: string;
    clientTypeAdvice: string;
  } | null>(null);

  const [selectedModel, setSelectedModel] = useState(settings?.selectedModel || 'veo-3.1-lite-generate-preview');
  const [outputDirectory, setOutputDirectory] = useState(settings?.outputDirectory || '');
  const [maxConcurrency, setMaxConcurrency] = useState(settings?.maxConcurrency || 1);
  const [maxRetries, setMaxRetries] = useState(settings?.maxRetries || 3);
  const [demoMode, setDemoMode] = useState(settings?.demoMode || false);

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; modelsAvailable?: string[] } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Updater states
  const [appVersion, setAppVersion] = useState<string>('1.0.0');
  const [isPackaged, setIsPackaged] = useState<boolean>(true);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatusData['status']>('idle');
  const [availableVersion, setAvailableVersion] = useState<string>('');
  const [downloadPercent, setDownloadPercent] = useState<number>(0);
  const [downloadSpeed, setDownloadSpeed] = useState<string>('');
  const [releaseNotes, setReleaseNotes] = useState<string>('');
  const [updaterError, setUpdaterError] = useState<string>('');
  const [updaterMessage, setUpdaterMessage] = useState<string>('');
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);

  useEffect(() => {
    // Load app version and packaged status from Electron if available
    if (window.electronAPI?.updater) {
      window.electronAPI.updater.getVersion().then((v) => {
        if (v) setAppVersion(v);
      }).catch(() => {});

      window.electronAPI.updater.isPackaged().then((pkg) => {
        setIsPackaged(!!pkg);
      }).catch(() => {});

      // Subscribe to updater status events
      const unsubscribe = window.electronAPI.updater.onStatus((data: UpdaterStatusData) => {
        setUpdaterStatus(data.status);
        if (data.version) setAvailableVersion(data.version);
        if (typeof data.percent === 'number') setDownloadPercent(Math.round(data.percent));
        if (data.bytesPerSecond) {
          const kbps = data.bytesPerSecond / 1024;
          const mbps = kbps / 1024;
          setDownloadSpeed(mbps >= 1 ? `${mbps.toFixed(1)} MB/s` : `${Math.round(kbps)} KB/s`);
        }
        if (data.releaseNotes) setReleaseNotes(data.releaseNotes);
        if (data.error) setUpdaterError(data.error);
        if (data.message) setUpdaterMessage(data.message);
      });

      return () => {
        unsubscribe();
      };
    }
  }, []);

  const handleCheckUpdates = async () => {
    setUpdaterError('');
    setUpdaterMessage('');
    setIsActionLoading(true);
    if (!window.electronAPI?.updater) {
      setUpdaterStatus('dev-mode');
      setUpdaterMessage('Disponível no aplicativo Desktop Windows empacotado.');
      setIsActionLoading(false);
      return;
    }

    try {
      setUpdaterStatus('checking');
      const res = await window.electronAPI.updater.check();
      if (!res.success) {
        if (res.status === 'dev-mode') {
          setUpdaterStatus('dev-mode');
          setUpdaterMessage(res.message || 'Verificação desativada em modo de desenvolvimento.');
        } else {
          setUpdaterStatus('error');
          setUpdaterError(res.error || 'Falha ao verificar atualizações.');
        }
      }
    } catch (err: any) {
      setUpdaterStatus('error');
      setUpdaterError(err?.message || 'Erro ao conectar ao GitHub.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!window.electronAPI?.updater) return;
    setUpdaterError('');
    setIsActionLoading(true);
    try {
      setUpdaterStatus('downloading');
      setDownloadPercent(0);
      const res = await window.electronAPI.updater.download();
      if (!res.success) {
        setUpdaterStatus('error');
        setUpdaterError(res.error || 'Falha ao iniciar download da atualização.');
      }
    } catch (err: any) {
      setUpdaterStatus('error');
      setUpdaterError(err?.message || 'Erro ao baixar atualização.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleInstallUpdate = () => {
    if (window.electronAPI?.updater) {
      window.electronAPI.updater.install();
    }
  };

  const isConnected = settings?.apiKeyConfigured || settings?.hasEnvKey;
  const isGoogleConnected = Boolean(googleAuth?.authenticated);

  const refreshGoogleAuthStatus = async () => {
    try {
      if (window.electronAPI?.googleAuth?.getStatus) {
        const st = await window.electronAPI.googleAuth.getStatus();
        setGoogleAuth(st);
      } else {
        const res = await fetch('/api/auth/google/status');
        if (res.ok) {
          const st = await res.json();
          setGoogleAuth(st);
        }
      }
    } catch (_) {}
  };

  useEffect(() => {
    refreshGoogleAuthStatus();
  }, []);

  const handleStartGoogleLogin = async () => {
    setIsGoogleLoggingIn(true);
    setGoogleLoginError('');
    setGoogleLoginMessage('Abrindo navegador padrão... Faça login na sua conta Google e autorize o Veo Auto Studio.');
    try {
      let result: GoogleAuthStatus;
      if (window.electronAPI?.googleAuth?.start) {
        result = await window.electronAPI.googleAuth.start();
      } else {
        const res = await fetch('/api/auth/google/start', { method: 'POST' });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Falha ao iniciar autenticação');
        }
        result = json.user;
      }

      if (result && result.authenticated) {
        setGoogleAuth(result);
        setAuthMethod('googleOAuth');
        setGoogleLoginMessage('Login concluído com sucesso!');
        await onSaveSettings({ authMethod: 'googleOAuth' });
        if (onRefreshGoogleAuth) {
          await onRefreshGoogleAuth();
        }
      } else {
        throw new Error('Autenticação não concluída.');
      }
    } catch (err: any) {
      setGoogleLoginError(err?.message || 'Falha no login com Google.');
    } finally {
      setIsGoogleLoggingIn(false);
    }
  };

  const handleCancelGoogleLogin = async () => {
    try {
      if (window.electronAPI?.googleAuth?.cancel) {
        await window.electronAPI.googleAuth.cancel();
      } else {
        await fetch('/api/auth/google/cancel', { method: 'POST' });
      }
    } catch (_) {}
    setIsGoogleLoggingIn(false);
    setGoogleLoginMessage('');
    setGoogleLoginError('Login cancelado.');
  };

  const handleGoogleLogout = async () => {
    try {
      if (window.electronAPI?.googleAuth?.logout) {
        await window.electronAPI.googleAuth.logout();
      } else {
        await fetch('/api/auth/google/logout', { method: 'POST' });
      }
      setGoogleAuth({ authenticated: false });
      setAuthMethod('apiKey');
      await onSaveSettings({ authMethod: 'apiKey' });
      if (onRefreshGoogleAuth) {
        await onRefreshGoogleAuth();
      }
    } catch (err: any) {
      console.error('Erro ao sair da conta Google:', err);
    }
  };

  const handleSaveGoogleClientId = async () => {
    try {
      const payload = {
        clientId: googleClientId.trim(),
        clientSecret: googleClientSecret.trim(),
      };
      if (window.electronAPI?.googleAuth?.setConfig) {
        await window.electronAPI.googleAuth.setConfig(payload);
      } else {
        await fetch('/api/auth/google/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      await onSaveSettings({
        googleOAuthClientId: googleClientId.trim(),
        googleOAuthClientSecret: googleClientSecret.trim(),
      });
      setClientIdSaved(true);
      setTimeout(() => setClientIdSaved(false), 2500);
    } catch (err) {
      console.error('Erro ao salvar configurações do Google OAuth:', err);
    }
  };

  const handleVerifyClientId = async () => {
    setIsVerifyingClientId(true);
    setClientIdVerification(null);
    try {
      let result;
      if (window.electronAPI?.googleAuth?.verifyClientId) {
        result = await window.electronAPI.googleAuth.verifyClientId(googleClientId.trim());
      } else {
        const query = googleClientId.trim() ? `?clientId=${encodeURIComponent(googleClientId.trim())}` : '';
        const res = await fetch(`/api/auth/google/verify-client-id${query}`);
        result = await res.json();
      }
      setClientIdVerification(result);
    } catch (err: any) {
      setClientIdVerification({
        isValidFormat: false,
        isConfigured: Boolean(googleClientId.trim()),
        maskedClientId: '',
        status: 'error',
        message: err?.message || 'Falha ao inspecionar Client ID.',
        clientTypeAdvice: 'Verifique sua conexão.',
      });
    } finally {
      setIsVerifyingClientId(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveSettings({
        apiKey: apiKeyInput.trim() || undefined,
        authMethod,
        googleOAuthClientId: googleClientId.trim() || undefined,
        googleOAuthClientSecret: googleClientSecret.trim() || undefined,
        selectedModel,
        outputDirectory,
        maxConcurrency,
        maxRetries,
        demoMode,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection(authMethod === 'apiKey' ? (apiKeyInput.trim() || undefined) : undefined);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'Falha ao testar conexão.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSelectFolder = async () => {
    if (window.electronAPI?.selectDirectory) {
      const selected = await window.electronAPI.selectDirectory();
      if (selected) {
        setOutputDirectory(selected);
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* View Header */}
      <div className="border-b border-slate-800 pb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300 text-xs font-semibold mb-2">
          <Settings className="w-3.5 h-3.5" />
          <span>Painel de Integração & Preferências</span>
        </div>
        <h2 className="text-2xl font-black tracking-tight text-white">
          Configurações do Veo Auto Studio
        </h2>
        <p className="text-xs text-slate-400">
          Gerencie sua chave de API oficial, modelos padrão, pastas de destino e limites de concorrência.
        </p>
      </div>

      {/* 1. Authentication Method Selector & Cards */}
      <div className="space-y-4">
        {/* Method Selector Tabs */}
        <div className="p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setAuthMethod('apiKey')}
            className={`flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
              authMethod === 'apiKey'
                ? 'bg-slate-800 border border-cyan-500/50 shadow-md shadow-cyan-950/30 text-white'
                : 'bg-transparent border border-transparent hover:bg-slate-800/50 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              authMethod === 'apiKey' ? 'bg-cyan-950 text-cyan-400 border border-cyan-800' : 'bg-slate-800 text-slate-400'
            }`}>
              <Key className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold">Chave de API Oficial</span>
                {isConnected && authMethod === 'apiKey' && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">Google AI Studio API Key</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setAuthMethod('googleOAuth')}
            className={`flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
              authMethod === 'googleOAuth'
                ? 'bg-slate-800 border border-indigo-500/50 shadow-md shadow-indigo-950/30 text-white'
                : 'bg-transparent border border-transparent hover:bg-slate-800/50 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              authMethod === 'googleOAuth' ? 'bg-indigo-950 text-indigo-400 border border-indigo-800' : 'bg-slate-800 text-slate-400'
            }`}>
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold">Entrar com Google</span>
                <span className={`w-2 h-2 rounded-full ${isGoogleConnected ? 'bg-emerald-400' : 'bg-slate-600'}`}></span>
              </div>
              <p className="text-[11px] text-slate-400">OAuth 2.0 PKCE Desktop (Oficial)</p>
            </div>
          </button>
        </div>

        {/* Card A: API Key Method */}
        {authMethod === 'apiKey' && (
          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Chave de API Oficial Google Veo / Gemini</h3>
                  <p className="text-[11px] text-slate-400">
                    Processada exclusivamente no processo principal / backend local seguro.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border ${
                    isConnected
                      ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
                      : 'bg-rose-950/80 border-rose-800 text-rose-300 animate-pulse'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{isConnected ? '🟢 API Conectada' : '🔴 Não Configurada'}</span>
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">
                Google AI Studio API Key
              </label>
              <div className="relative">
                <input
                  id="input-api-key"
                  type="password"
                  placeholder={isConnected ? '••••••••••••••••••••••••••••••••••••••••' : 'AIzaSy...'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
                />
                <Lock className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
              <p className="text-[11px] text-slate-500">
                Obtenha sua chave gratuita ou profissional em{' '}
                <a
                  href="https://aistudio.google.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 hover:underline inline-flex items-center gap-0.5"
                >
                  aistudio.google.com <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            </div>

            {/* Action Buttons for API */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                id="btn-save-api-key"
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-950 cursor-pointer"
              >
                {saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                <span>{saveSuccess ? 'Salvo com Sucesso!' : isSaving ? 'Salvando...' : 'Salvar API'}</span>
              </button>

              <button
                id="btn-test-connection"
                type="button"
                onClick={handleTest}
                disabled={isTesting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-all cursor-pointer"
              >
                <Radio className={`w-4 h-4 text-cyan-400 ${isTesting ? 'animate-spin' : ''}`} />
                <span>{isTesting ? 'Validando...' : 'Testar Conexão'}</span>
              </button>
            </div>

            {/* Test Result Feedback */}
            {testResult && (
              <div
                className={`p-4 rounded-xl text-xs space-y-2 border ${
                  testResult.success
                    ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
                    : 'bg-rose-950/40 border-rose-800 text-rose-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold">
                  {testResult.success ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                  )}
                  <span>{testResult.message}</span>
                </div>
                {testResult.modelsAvailable && (
                  <div className="pt-2 border-t border-emerald-800/40 flex flex-wrap gap-1.5 text-[10px]">
                    <span className="text-slate-400">Modelos verificados:</span>
                    {testResult.modelsAvailable.map((m) => (
                      <span key={m} className="px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700 text-emerald-200 font-mono">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Card B: Google OAuth 2.0 PKCE Method */}
        {authMethod === 'googleOAuth' && (
          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-950 border border-indigo-800 flex items-center justify-center text-indigo-400">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Login Oficial com Conta Google</h3>
                  <p className="text-[11px] text-slate-400">
                    Autenticação OAuth 2.0 PKCE no navegador padrão do Windows sem expor chave de API.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border ${
                    isGoogleConnected
                      ? 'bg-emerald-950/80 border-emerald-800 text-emerald-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${isGoogleConnected ? 'bg-emerald-400' : 'bg-slate-500'}`}></span>
                  <span>{isGoogleConnected ? '● Google Conectado' : '○ Não Conectado'}</span>
                </span>
              </div>
            </div>

            {/* If Google Connected: Profile info */}
            {isGoogleConnected && (
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {googleAuth?.picture ? (
                    <img
                      src={googleAuth.picture}
                      alt={googleAuth.name || 'Conta Google'}
                      className="w-11 h-11 rounded-full border border-indigo-500/50 object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-indigo-950 border border-indigo-700 flex items-center justify-center text-indigo-300 font-bold text-sm">
                      {googleAuth?.name ? googleAuth.name.charAt(0).toUpperCase() : <User className="w-5 h-5" />}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">
                        {googleAuth?.name || 'Usuário Google'}
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-300">
                        Ativo
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 font-mono">{googleAuth?.email}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                      <Lock className="w-3 h-3 text-emerald-500" />
                      <span>Tokens criptografados localmente no Desktop (safeStorage)</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={isTesting}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-all cursor-pointer"
                  >
                    <Radio className={`w-3.5 h-3.5 text-cyan-400 ${isTesting ? 'animate-spin' : ''}`} />
                    <span>{isTesting ? 'Testando...' : 'Testar Conexão'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleGoogleLogout}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/80 text-rose-300 text-xs font-bold transition-all cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-400" />
                    <span>Sair da Conta</span>
                  </button>
                </div>
              </div>
            )}

            {/* If Google Not Connected: Login button */}
            {!isGoogleConnected && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70 space-y-3">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Faça login com sua Conta Google no navegador padrão para acessar o Veo Auto Studio.
                    O fluxo oficial via OAuth 2.0 PKCE cria uma sessão autenticada com segurança no aplicativo.
                  </p>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      id="btn-google-login"
                      type="button"
                      onClick={handleStartGoogleLogin}
                      disabled={isGoogleLoggingIn}
                      className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold transition-all shadow-lg shadow-indigo-950 cursor-pointer disabled:opacity-50"
                    >
                      {isGoogleLoggingIn ? (
                        <RefreshCw className="w-4 h-4 animate-spin text-white" />
                      ) : (
                        <LogIn className="w-4 h-4 text-white" />
                      )}
                      <span>{isGoogleLoggingIn ? 'Aguardando no Navegador...' : 'Entrar com Google'}</span>
                    </button>

                    {isGoogleLoggingIn && (
                      <button
                        type="button"
                        onClick={handleCancelGoogleLogin}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition-all cursor-pointer"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>

                  {isGoogleLoggingIn && (
                    <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-800/50 flex items-center gap-2.5 text-xs text-indigo-300 animate-pulse">
                      <Info className="w-4 h-4 flex-shrink-0 text-indigo-400" />
                      <span>{googleLoginMessage || 'Conclua a autorização na aba do Google aberta no seu navegador padrão.'}</span>
                    </div>
                  )}

                  {googleLoginError && (
                    <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/50 flex items-center gap-2.5 text-xs text-rose-300">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                      <span>{googleLoginError}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Test Result Feedback for Google */}
            {testResult && (
              <div
                className={`p-4 rounded-xl text-xs space-y-2 border ${
                  testResult.success
                    ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
                    : 'bg-rose-950/40 border-rose-800 text-rose-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold">
                  {testResult.success ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400" />
                  )}
                  <span>{testResult.message}</span>
                </div>
                {testResult.modelsAvailable && (
                  <div className="pt-2 border-t border-emerald-800/40 flex flex-wrap gap-1.5 text-[10px]">
                    <span className="text-slate-400">Modelos verificados:</span>
                    {testResult.modelsAvailable.map((m) => (
                      <span key={m} className="px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700 text-emerald-200 font-mono">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Client ID Configuration Field */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Google OAuth 2.0 Client ID (Desktop App)</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowCloudGuide(!showCloudGuide)}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>{showCloudGuide ? 'Ocultar Instruções' : 'Como obter no Google Cloud'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="input-google-client-id"
                  type="text"
                  placeholder="ex: 1234567890-abc123def456.apps.googleusercontent.com"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                  className="flex-1 px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handleVerifyClientId}
                  disabled={isVerifyingClientId || !googleClientId.trim()}
                  className="px-3.5 py-2 rounded-xl bg-indigo-950/70 hover:bg-indigo-900/80 border border-indigo-800 text-indigo-200 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-40"
                  title="Verifica o formato e disponibilidade do Client ID de forma segura sem expor segredos"
                >
                  <Search className={`w-3.5 h-3.5 ${isVerifyingClientId ? 'animate-spin' : ''}`} />
                  <span>{isVerifyingClientId ? 'Verificando...' : 'Verificar ID'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveGoogleClientId}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {clientIdSaved ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{clientIdSaved ? 'Salvo!' : 'Salvar'}</span>
                </button>
              </div>

              {/* Client ID Verification Diagnostic Card */}
              {clientIdVerification && (
                <div
                  className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                    clientIdVerification.isValidFormat && clientIdVerification.status !== 'google_rejected'
                      ? 'bg-slate-950/90 border-indigo-800/60 text-slate-200'
                      : 'bg-rose-950/30 border-rose-800 text-rose-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold">
                      {clientIdVerification.isValidFormat && clientIdVerification.status !== 'google_rejected' ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-rose-400" />
                      )}
                      <span>{clientIdVerification.message}</span>
                    </div>
                    {clientIdVerification.maskedClientId && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                        {clientIdVerification.maskedClientId}
                      </span>
                    )}
                  </div>
                  {clientIdVerification.clientTypeAdvice && (
                    <p className="text-[11px] text-slate-400 pl-6 leading-relaxed">
                      {clientIdVerification.clientTypeAdvice}
                    </p>
                  )}
                </div>
              )}

              {/* Optional Client Secret for Web Client IDs */}
              <div className="space-y-1.5 pt-2">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Google Client Secret (Opcional)</span>
                  <span className="text-[10px] font-normal text-slate-400 bg-slate-800/80 border border-slate-700 px-1.5 py-0.5 rounded">
                    Dispensável para Desktop App
                  </span>
                </label>
                <input
                  id="input-google-client-secret"
                  type="password"
                  placeholder="Opcional: somente necessário se seu Client ID no GCP foi criado como 'Aplicativo Web'"
                  value={googleClientSecret}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <p className="text-[11px] text-slate-500">
                Para credenciais criadas como <strong>Aplicativo para computador (Desktop App)</strong> com PKCE S256, o Client Secret <strong>NÃO</strong> é obrigatório nem exigido. Pode ser preenchido acima ou via variável de ambiente <code className="text-slate-400 bg-slate-950 px-1 py-0.5 rounded">GOOGLE_OAUTH_CLIENT_SECRET</code> caso você utilize credenciais do tipo Web.
              </p>
            </div>

            {/* Expandable Step-by-Step Google Cloud Guide */}
            {showCloudGuide && (
              <div className="p-4 rounded-xl bg-slate-950/80 border border-indigo-900/40 space-y-3 text-xs">
                <div className="flex items-center gap-2 font-bold text-indigo-300">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span>Passo a Passo Oficial para Configurar no Google Cloud:</span>
                </div>
                <ol className="space-y-2 text-slate-300 list-decimal list-inside leading-relaxed text-[11px]">
                  <li>
                    Acesse o{' '}
                    <a
                      href="https://console.cloud.google.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400 underline font-semibold inline-flex items-center gap-0.5"
                    >
                      Google Cloud Console <ExternalLink className="w-2.5 h-2.5" />
                    </a>{' '}
                    e crie ou selecione seu projeto.
                  </li>
                  <li>
                    Na biblioteca de APIs, pesquise e ative a <strong className="text-white">Google Generative Language API</strong>.
                  </li>
                  <li>
                    Em <strong className="text-white">APIs e Serviços &gt; Tela de consentimento OAuth</strong> (Google Auth Platform), selecione o tipo de usuário <strong className="text-white">Externo</strong>, informe o nome do app e adicione seu e-mail como <strong className="text-white">Usuário de Teste</strong> (Test User).
                  </li>
                  <li>
                    Em <strong className="text-white">APIs e Serviços &gt; Credenciais &gt; Criar Credenciais &gt; ID do cliente OAuth</strong>, escolha o tipo de aplicativo: <strong className="text-white">Aplicativo para computador (Desktop App)</strong>.
                  </li>
                  <li>
                    Copie o <strong className="text-white">ID do cliente (Client ID)</strong> gerado e cole no campo acima ou defina no arquivo <code className="text-indigo-300">.env</code>.
                  </li>
                </ol>
                <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-500">
                  🔒 <span className="font-semibold text-slate-400">Segurança Garantida:</span> O Veo Auto Studio segue a recomendação RFC 8252 para aplicativos desktop (servidor de loopback HTTP efêmero em 127.0.0.1 em porta aleatória temporária com PKCE SHA-256 e armazenamento seguro).
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Models & Engine Preferences */}
      <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-950 border border-indigo-800 flex items-center justify-center text-indigo-400">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Modelos do Google Veo</h3>
            <p className="text-[11px] text-slate-400">Selecione a versão padrão da engine de geração.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              id: 'veo-3.1-lite-generate-preview',
              name: 'Veo 3.1 Lite',
              desc: 'Geração ultra-rápida e otimizada para anúncios curtos em escala.',
              recommended: true,
            },
            {
              id: 'veo-3.1-generate-preview',
              name: 'Veo 3.1 High Quality',
              desc: 'Máxima resolução, textura e detalhes cinematográficos.',
              recommended: false,
            },
            {
              id: 'veo-2.0-generate-001',
              name: 'Veo 2.0 Stable',
              desc: 'Versão legada com suporte estável padrão.',
              recommended: false,
            },
          ].map((model) => (
            <button
              key={model.id}
              type="button"
              onClick={() => setSelectedModel(model.id)}
              className={`p-4 rounded-xl text-left border transition-all flex flex-col justify-between space-y-2 ${
                selectedModel === model.id
                  ? 'bg-indigo-950/80 border-indigo-500 shadow-md shadow-indigo-950'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">{model.name}</span>
                {model.recommended && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300">
                    Recomendado
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{model.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Output Directory & Concurrency Controls */}
      <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-950 border border-purple-800 flex items-center justify-center text-purple-400">
            <Folder className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Pasta de Saída & Desempenho Local</h3>
            <p className="text-[11px] text-slate-400">
              Onde as campanhas, vídeos .mp4, prompts e roteiros serão gravados.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              Diretório de Armazenamento das Campanhas
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={outputDirectory}
                onChange={(e) => setOutputDirectory(e.target.value)}
                placeholder="Veo Auto Studio/Campanhas/"
                className="flex-1 px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:border-cyan-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSelectFolder}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors flex items-center gap-1.5"
              >
                <Folder className="w-3.5 h-3.5 text-cyan-400" />
                <span>Procurar</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Concorrência Máxima (Tarefas Simultâneas)
              </label>
              <select
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
              >
                <option value={1}>1 tarefa por vez (Recomendado para estabilidade)</option>
                <option value={2}>2 tarefas simultâneas</option>
                <option value={3}>3 tarefas simultâneas (Alto tráfego)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Máximo de Retentativas em Falha
              </label>
              <select
                value={maxRetries}
                onChange={(e) => setMaxRetries(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
              >
                <option value={1}>1 tentativa</option>
                <option value={3}>3 tentativas (com Exponential Backoff)</option>
                <option value={5}>5 tentativas</option>
              </select>
            </div>
          </div>

          {/* Demo Mode Toggle */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Modo de Demonstração (Demo Mode)</span>
              </p>
              <p className="text-[11px] text-slate-400">
                Permite testar todos os fluxos da interface e fila sem consumir créditos da API do Veo.
              </p>
            </div>
            <input
              type="checkbox"
              checked={demoMode}
              onChange={(e) => setDemoMode(e.target.checked)}
              className="w-5 h-5 accent-cyan-500 rounded cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* 4. Automatic Updates Card (electron-updater) */}
      <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-950 border border-indigo-800 flex items-center justify-center text-indigo-400">
              <ArrowUpCircle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Atualizações do Aplicativo</h3>
              <p className="text-[11px] text-slate-400">
                Sistema integrado de auto-update via GitHub Releases (electron-updater + NSIS).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-bold bg-slate-950 border border-slate-800 text-cyan-400">
              <span>Versão Atual: v{appVersion}</span>
            </span>
          </div>
        </div>

        {/* Status Content Display */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-3">
          {updaterStatus === 'idle' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-xs text-slate-300">
                Nenhuma verificação recente. Clique no botão ao lado para consultar novas versões públicas no GitHub.
              </p>
              <button
                type="button"
                onClick={handleCheckUpdates}
                disabled={isActionLoading}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isActionLoading ? 'animate-spin text-cyan-400' : 'text-slate-400'}`} />
                <span>Verificar Atualizações</span>
              </button>
            </div>
          )}

          {updaterStatus === 'checking' && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs text-cyan-300">
                <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Verificando atualizações no GitHub Releases...</span>
              </div>
            </div>
          )}

          {updaterStatus === 'available' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-950 border border-emerald-800 text-emerald-300 text-[11px] font-bold">
                      NOVA VERSÃO DISPONÍVEL
                    </span>
                    <span className="text-xs font-bold text-white">v{availableVersion || 'Nova versão'}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Um novo pacote de instalação está pronto para download.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadUpdate}
                  disabled={isActionLoading}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 text-xs font-black flex items-center justify-center gap-2 shadow-lg shadow-cyan-950/50 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Baixar Atualização</span>
                </button>
              </div>

              {releaseNotes && (
                <div className="mt-2 p-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {releaseNotes}
                </div>
              )}
            </div>
          )}

          {updaterStatus === 'downloading' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-cyan-300 font-semibold flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5 animate-bounce" />
                  <span>Baixando atualização...</span>
                </span>
                <span className="text-white font-mono font-bold">{downloadPercent}% {downloadSpeed ? `(${downloadSpeed})` : ''}</span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${downloadPercent}%` }}
                />
              </div>
            </div>
          )}

          {updaterStatus === 'downloaded' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Atualização pronta para instalação!</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  O aplicativo será reiniciado para concluir a instalação do instalador NSIS.
                </p>
              </div>
              <button
                type="button"
                onClick={handleInstallUpdate}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 text-xs font-black flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Reiniciar e Atualizar</span>
              </button>
            </div>
          )}

          {updaterStatus === 'not-available' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>Você já está utilizando a versão mais recente ({appVersion}).</span>
              </div>
              <button
                type="button"
                onClick={handleCheckUpdates}
                disabled={isActionLoading}
                className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3 h-3 text-slate-400" />
                <span>Verificar Novamente</span>
              </button>
            </div>
          )}

          {updaterStatus === 'dev-mode' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                <span className="text-amber-400 font-semibold">Modo de Desenvolvimento:</span> {updaterMessage || 'O auto-updater atua no executável final instalado (NSIS).'}
              </div>
              <button
                type="button"
                onClick={handleCheckUpdates}
                disabled={isActionLoading}
                className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3 h-3 text-slate-400" />
                <span>Verificar</span>
              </button>
            </div>
          )}

          {updaterStatus === 'error' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-rose-400 font-semibold">
                <AlertTriangle className="w-4 h-4" />
                <span>Não foi possível verificar ou baixar a atualização:</span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                {updaterError || 'Falha de comunicação com o GitHub Releases ou sem conexão à internet.'}
              </p>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleCheckUpdates}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Tentar Novamente</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Save Bar */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 text-xs font-black transition-all shadow-xl shadow-cyan-950 hover:scale-[1.02]"
        >
          {saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{saveSuccess ? 'CONFIGURAÇÕES SALVAS!' : 'SALVAR TODAS AS CONFIGURAÇÕES'}</span>
        </button>
      </div>
    </div>
  );
};
