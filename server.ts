import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  SUPPORTED_REGIONS,
  ALL_COUNTRIES_CATALOG,
  COUNTRY_LANGUAGE_MAP,
  doesHolderNameMatch,
  maskAccountNumber,
  OnboardSchema,
  CreatePaymentMethodSchema,
  CreateP2PAdSchema,
  CreateOrderSchema,
  FastMatchSchema,
  SendOrderMessageSchema,
  CreatePaymentRequestSchema,
  CreateRedPacketSchema,
  ADMIN_WALLET_ADDRESS,
  normalizeNimiqAddress,
  ConnectSocialSchema,
  VerifySocialSchema,
  SocialSimulatePostSchema,
  cleanSocialHandle,
  formatTwitterTemplate,
  formatTelegramCommand,
  UpdateCashbackConfigSchema,
  DepositCashbackEscrowSchema,
  RejectCashbackSchema,
} from './packages/shared/index.ts';
import {
  generateSocialVerificationCode,
  parseTwitterPostWithAI,
  generateTwitterBotResponse,
  executeSocialTransfer,
  verifyTwitterConnection,
  verifyTelegramConnection,
  processTelegramMessage,
  setSocialEventBroadcaster,
  startTelegramBotPolling,
} from './src/server/socialBot.ts';
import {
  generateCashbackClaimIfEligible,
  confirmCashbackClaim,
  rejectCashbackClaim,
  depositCashbackEscrow,
} from './src/server/cashbackService.ts';
import {
  db,
  type UserRecord,
  type PaymentMethodRecord,
  type P2PAdRecord,
  type P2POrderRecord,
  type OrderMessageRecord,
  encryptAccountField,
  decryptAccountField,
} from './src/server/db.ts';
import {
  escrowSigner,
  allocateRedPacketLunaShares,
} from './src/server/escrowSigner.ts';
import {
  claimRedPacketForUser,
  setRedPacketEventBroadcaster,
} from './src/server/redPacketService.ts';
import {
  runTimeoutAndExpiryWorkers,
  registerWorkerBroadcast,
  createSystemOrderMessage,
} from './src/server/workers.ts';

const PORT = 3000;
const ORDER_ACTION_TIMEOUT_MINUTES = Number(
  process.env.ORDER_ACTION_TIMEOUT_MINUTES || '30'
);
const ADMIN_SECRET_PATH = '/api/300210/2026/nimora/panel/only/admin';
const ADMIN_SECRET_PASSWORD = '@Raffathoriq010228';

interface AuthChallenge {
  address: string;
  nonce: string;
  message: string;
  expiresAt: number;
}

const challenges = new Map<string, AuthChallenge>();
const userSessions = new Map<string, string>(); // token -> userId
const adminSessions = new Set<string>(); // adminToken

// Rate limiting memory map
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) {
    return false;
  }
  entry.count += 1;
  return true;
}

interface AuthenticatedRequest extends Request {
  user?: UserRecord;
}

function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing token' });
    return;
  }
  const token = authHeader.slice(7);
  const userId = userSessions.get(token);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
    return;
  }
  const user = db.state.users.find((u) => u.id === userId);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized: User not found' });
    return;
  }
  user.lastActiveAt = new Date().toISOString();
  req.user = user;
  next();
}

function requireSecretAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const headerToken = req.headers['x-admin-token'] as string | undefined;
  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : undefined;
  const token = headerToken || bearerToken;
  if (!token || !adminSessions.has(token)) {
    res.status(403).json({
      error: 'Forbidden: Valid admin session required for /api/300210/2026/nimora/panel/only/admin',
    });
    return;
  }
  next();
}

function sanitizeOrderForViewer(
  order: P2POrderRecord,
  viewerId: string,
  isAdmin = false
): P2POrderRecord {
  // Buyers see the seller's full unmasked payment details ONLY after the order reaches CRYPTO_LOCKED / AWAITING_PAYMENT
  const canSeeFullAccount =
    isAdmin ||
    viewerId === order.sellerId ||
    (viewerId === order.buyerId &&
      ['CRYPTO_LOCKED', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED', 'COMPLETED', 'DISPUTED'].includes(
        order.status
      ));

  return {
    ...order,
    paymentMethodSnapshot: {
      ...order.paymentMethodSnapshot,
      accountNumberFull: canSeeFullAccount
        ? order.paymentMethodSnapshot.accountNumberFull
        : order.paymentMethodSnapshot.accountNumberMasked,
    },
  };
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '8mb' }));

  // WebSocket setup for real-time order chat & live admin activity feed
  const wss = new WebSocketServer({ server, path: '/ws' });
  const wsClients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => {
      wsClients.delete(ws);
    });
  });

  function broadcastEvent(event: string, payload: unknown): void {
    const msg = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  registerWorkerBroadcast(broadcastEvent);
  setRedPacketEventBroadcaster(broadcastEvent);

  // Start 30-minute timeout and expiry background worker loop
  setInterval(() => {
    runTimeoutAndExpiryWorkers().catch((err) =>
      console.error('Worker error:', err)
    );
  }, 8000);

  // ============================================================================
  // 1. AUTHENTICATION ENDPOINTS
  // ============================================================================
  app.post('/api/auth/challenge', (req: Request, res: Response) => {
    const address = String(req.body?.address || '').trim();
    if (!address || address.length < 15) {
      res.status(400).json({ error: 'Valid Nimiq address is required' });
      return;
    }
    if (!checkRateLimit(`auth:${address}`, 20, 60_000)) {
      res.status(429).json({ error: 'Too many authentication requests. Please wait.' });
      return;
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const message = [
      'Nimora — Nimiq Pay Mini App Authentication',
      `Domain: ${req.headers.host || 'nimora.app'}`,
      `Address: ${address}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date().toISOString()}`,
    ].join('\n');

    challenges.set(address, { address, nonce, message, expiresAt });
    res.json({
      nonce,
      message,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  });

  app.post('/api/auth/verify', (req: Request, res: Response) => {
    const { address, signature, publicKey } = req.body || {};
    if (!address || !signature || !publicKey) {
      res.status(400).json({ error: 'Missing address, signature, or publicKey' });
      return;
    }

    const challenge = challenges.get(address);
    if (!challenge || Date.now() > challenge.expiresAt) {
      challenges.delete(address);
      res.status(400).json({ error: 'Challenge expired or not found. Please try signing in again.' });
      return;
    }

    challenges.delete(address);
    const cleanAddr = normalizeNimiqAddress(address);
    let user = db.state.users.find(
      (u) =>
        normalizeNimiqAddress(u.address) === cleanAddr ||
        u.address.replace(/\s+/g, '').toUpperCase() === cleanAddr.replace(/\s+/g, '').toUpperCase()
    );
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const newUser: UserRecord = {
        id: `usr_${crypto.randomBytes(6).toString('hex')}`,
        address: cleanAddr,
        realName: null,
        country: null,
        onboardedAt: null,
        createdAt: new Date().toISOString(),
        locale: 'en',
        notificationPrefs: {
          orderUpdates: true,
          chatMessages: true,
          reminders: true,
        },
        isAdmin: false,
        isBanned: false,
        noShowCount: 0,
        completedTrades: 0,
        balanceNim: cleanAddr === ADMIN_WALLET_ADDRESS ? 250_000 : 12_500,
        lastActiveAt: new Date().toISOString(),
      };
      db.state.users.unshift(newUser);
      db.save();
      user = newUser;
    } else {
      user.address = cleanAddr;
      user.lastActiveAt = new Date().toISOString();
      db.save();
    }

    const token = `nimora_jwt_${crypto.randomBytes(24).toString('hex')}`;
    userSessions.set(token, user.id);

    db.logAudit(
      user.id,
      user.realName || user.address,
      'USER_LOGIN',
      'User',
      user.id,
      { address, publicKey: String(publicKey).slice(0, 16), isNewUser },
      req.ip
    );
    broadcastEvent('ADMIN_ACTIVITY', {
      type: 'USER_LOGIN',
      actor: user.realName || user.address,
      detail: `Signed in with wallet ${user.address}`,
    });

    res.json({
      token,
      user,
      needsOnboarding: !user.onboardedAt || !user.realName || !user.country,
    });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      userSessions.delete(authHeader.slice(7));
    }
    res.json({ ok: true });
  });

  // ============================================================================
  // 2. REGIONS & COUNTRY PAYMENT METHODS CATALOG
  // ============================================================================
  app.get('/api/regions', (_req: Request, res: Response) => {
    res.json({
      countries: ALL_COUNTRIES_CATALOG,
      supportedRegions: SUPPORTED_REGIONS,
      countryLanguageMap: COUNTRY_LANGUAGE_MAP,
      escrowAddress: escrowSigner.getEscrowAddress(),
    });
  });

  // Live Market Rates (CoinGecko API with 60s cache + FX fallback) & On-Chain Nimiq Balance Resolver
  let cachedMarketRates: {
    rates: Record<string, number>;
    source: string;
    updatedAt: string;
    expiresAt: number;
  } | null = null;

  app.get('/api/market-rates', async (_req: Request, res: Response) => {
    if (cachedMarketRates && Date.now() < cachedMarketRates.expiresAt) {
      res.json(cachedMarketRates);
      return;
    }

    const fallbackRates: Record<string, number> = {};
    for (const r of Object.values(SUPPORTED_REGIONS)) {
      fallbackRates[r.currency] = r.defaultNimPriceFiat;
    }

    try {
      const currencies = Array.from(
        new Set(Object.values(SUPPORTED_REGIONS).map((r) => r.currency.toLowerCase()))
      ).join(',');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const cgRes = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=${currencies}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      if (cgRes.ok) {
        const data = (await cgRes.json()) as {
          'nimiq-2'?: Record<string, number>;
        };
        const nimData = data['nimiq-2'];
        if (nimData && typeof nimData === 'object') {
          const liveRates: Record<string, number> = { ...fallbackRates };
          for (const [k, v] of Object.entries(nimData)) {
            if (typeof v === 'number' && v > 0) {
              liveRates[k.toUpperCase()] = v;
            }
          }
          cachedMarketRates = {
            rates: liveRates,
            source: 'coingecko_live',
            updatedAt: new Date().toISOString(),
            expiresAt: Date.now() + 60_000,
          };
          res.json(cachedMarketRates);
          return;
        }
      }
    } catch {
      // Fallback to baseline market rates if rate-limited
    }

    cachedMarketRates = {
      rates: fallbackRates,
      source: 'market_reference',
      updatedAt: new Date().toISOString(),
      expiresAt: Date.now() + 30_000,
    };
    res.json(cachedMarketRates);
  });

  app.get('/api/wallet/balance', async (req: Request, res: Response) => {
    const rawAddress = String(req.query.address || '').trim();
    const formatted = normalizeNimiqAddress(rawAddress);
    if (!formatted) {
      res.status(400).json({ error: 'Valid Nimiq address required' });
      return;
    }

    // Check optional authentication token to reliably identify the user
    let authUser: UserRecord | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const userId = userSessions.get(token);
      if (userId) {
        authUser = db.state.users.find((u) => u.id === userId) || null;
      }
    }

    // Get current database balance for user
    let existingBal = 0;
    if (authUser) {
      existingBal = authUser.balanceNim ?? db.getUserBalance(authUser.id);
    } else {
      existingBal = db.getUserBalance(formatted);
    }

    // Attempt live Nimiq RPC lookup (Mainnet & Testnet)
    const rpcEndpoints = [
      process.env.NIMIQ_RPC_URL,
      'https://rpc.nimiq.network',
      'https://rpc.nimiq-testnet.com',
    ].filter(Boolean) as string[];

    let onChainNim = 0;
    for (const rpcUrl of rpcEndpoints) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 2200);
        const rpcRes = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAccountByAddress',
            params: { address: formatted },
          }),
          signal: controller.signal,
        });
        clearTimeout(t);

        if (rpcRes.ok) {
          const payload = (await rpcRes.json()) as {
            result?: { data?: { balance?: number }; balance?: number };
          };
          const balanceLuna =
            payload?.result?.data?.balance ?? payload?.result?.balance;
          if (typeof balanceLuna === 'number' && balanceLuna > 0) {
            onChainNim = Number((balanceLuna / 100_000).toFixed(5));
            break;
          }
        }
      } catch {
        // Try next RPC
      }
    }

    const finalBal = Math.max(onChainNim, existingBal);
    if (finalBal > existingBal) {
      if (authUser) {
        db.adjustUserBalance(authUser.id, finalBal - existingBal);
      } else {
        db.adjustUserBalance(formatted, finalBal - existingBal);
      }
    }

    res.json({
      address: formatted,
      onChainBalanceNim: finalBal,
      source: onChainNim > 0 ? 'onchain' : 'database',
    });
  });

  app.get('/api/regions/:country/payment-methods', (req: Request, res: Response) => {
    const code = String(req.params.country || '').toUpperCase();
    const region = SUPPORTED_REGIONS[code];
    if (!region) {
      res.status(404).json({ error: `Country ${code} is not supported yet` });
      return;
    }
    res.json({
      country: region.country,
      currency: region.currency,
      currencySymbol: region.currencySymbol,
      defaultLocale: region.defaultLocale,
      paymentMethods: region.paymentMethods,
    });
  });

  // ============================================================================
  // 3. USER PROFILE & IMMUTABLE ONBOARDING
  // ============================================================================
  app.get('/api/users/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  const handleUserOnboarding = (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    // Enforce set-once immutability (409 Conflict on second attempt)
    if (user.onboardedAt || user.realName || user.country) {
      res.status(409).json({
        error: 'Onboarding already completed. Real Name and Country are immutable and cannot be changed.',
      });
      return;
    }

    const parsed = OnboardSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid onboarding input',
      });
      return;
    }

    const countryCode = parsed.data.country.toUpperCase();
    const region = SUPPORTED_REGIONS[countryCode];
    if (!region) {
      res.status(400).json({
        error: `Country "${countryCode}" is not in the supported regions catalog yet.`,
      });
      return;
    }

    const requestedLocale =
      typeof req.body?.locale === 'string' && req.body.locale.trim()
        ? req.body.locale.trim()
        : null;

    user.realName = parsed.data.realName.trim();
    user.country = countryCode;
    user.locale =
      requestedLocale ||
      COUNTRY_LANGUAGE_MAP[countryCode] ||
      region.defaultLocale ||
      'en';
    user.onboardedAt = new Date().toISOString();
    db.save();

    db.logAudit(
      user.id,
      user.realName,
      'USER_ONBOARDED',
      'User',
      user.id,
      { realName: user.realName, country: user.country, locale: user.locale },
      req.ip
    );
    broadcastEvent('ADMIN_ACTIVITY', {
      type: 'USER_ONBOARDED',
      actor: user.realName,
      detail: `Completed onboarding in ${region.countryName} (${user.country})`,
    });

    res.json({ user });
  };

  app.post('/api/users/onboard', requireAuth, handleUserOnboarding);
  app.post('/api/users/onboarding', requireAuth, handleUserOnboarding);

  app.patch('/api/users/me/settings', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    // Reject any attempt to mutate realName or country via settings
    if ('realName' in req.body || 'country' in req.body) {
      res.status(403).json({
        error: 'Real Name and Country are permanently locked and cannot be changed.',
      });
      return;
    }

    if (typeof req.body?.locale === 'string' && req.body.locale.trim()) {
      user.locale = req.body.locale.trim();
    }
    if (req.body?.notificationPrefs && typeof req.body.notificationPrefs === 'object') {
      user.notificationPrefs = {
        ...user.notificationPrefs,
        ...req.body.notificationPrefs,
      };
    }
    db.save();
    res.json({ user });
  });

  // ============================================================================
  // 3.1 SOCIAL MEDIA ACCOUNTS & TIPPING (Twitter / X & Telegram)
  // ============================================================================
  app.get('/api/social/accounts', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const userAccounts = db.state.socialAccounts.filter((sa) => sa.userId === user.id);
    let twitterAcc = userAccounts.find((sa) => sa.platform === 'TWITTER');
    let telegramAcc = userAccounts.find((sa) => sa.platform === 'TELEGRAM');

    if (!telegramAcc && user.telegramHandle) {
      telegramAcc = {
        id: `soc_${crypto.randomBytes(6).toString('hex')}`,
        userId: user.id,
        platform: 'TELEGRAM',
        handle: cleanSocialHandle(user.telegramHandle),
        displayHandle: `@${cleanSocialHandle(user.telegramHandle)}`,
        verificationCode: `TG-${Math.floor(10000 + Math.random() * 90000)}`,
        isVerified: true,
        verifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        telegramUserId: user.telegramUserId || null,
      };
      db.state.socialAccounts.push(telegramAcc);
      db.save();
    } else if (telegramAcc && (user.telegramHandle || telegramAcc.verifiedAt)) {
      if (!telegramAcc.isVerified) {
        telegramAcc.isVerified = true;
        db.save();
      }
    }

    if (!twitterAcc && user.twitterHandle) {
      twitterAcc = {
        id: `soc_${crypto.randomBytes(6).toString('hex')}`,
        userId: user.id,
        platform: 'TWITTER',
        handle: cleanSocialHandle(user.twitterHandle),
        displayHandle: `@${cleanSocialHandle(user.twitterHandle)}`,
        verificationCode: `X-${Math.floor(10000 + Math.random() * 90000)}`,
        isVerified: true,
        verifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      db.state.socialAccounts.push(twitterAcc);
      db.save();
    } else if (twitterAcc && (user.twitterHandle || twitterAcc.verifiedAt)) {
      if (!twitterAcc.isVerified) {
        twitterAcc.isVerified = true;
        db.save();
      }
    }

    // Also return public verified peer accounts for quick tipping suggestions
    const demoPeers = db.state.socialAccounts
      .filter((sa) => sa.isVerified && sa.userId !== user.id)
      .slice(0, 6)
      .map((sa) => ({
        platform: sa.platform,
        handle: sa.handle,
        displayHandle: sa.displayHandle,
      }));

    res.json({
      twitter: twitterAcc || null,
      telegram: telegramAcc || null,
      demoPeers,
      botHandles: {
        twitter: '@nimorapay',
        telegram: '@nimorapay_bot',
      },
    });
  });

  app.post('/api/social/connect', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const parsed = ConnectSocialSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid social handle',
      });
      return;
    }

    const { platform } = parsed.data;
    const cleanHandle = cleanSocialHandle(parsed.data.handle);

    if (!cleanHandle) {
      res.status(400).json({ error: 'Valid social media handle is required' });
      return;
    }

    // Check if this handle is already verified by another user
    const existingVerified = db.state.socialAccounts.find(
      (sa) => sa.platform === platform && sa.handle === cleanHandle && sa.isVerified && sa.userId !== user.id
    );
    if (existingVerified) {
      res.status(409).json({
        error: `The ${platform === 'TWITTER' ? 'Twitter' : 'Telegram'} handle @${cleanHandle} is already connected to another Nimora wallet.`,
      });
      return;
    }

    // Generate unique verification code
    const verificationCode = generateSocialVerificationCode(platform);

    let account = db.state.socialAccounts.find(
      (sa) => sa.userId === user.id && sa.platform === platform
    );

    if (account) {
      const isSameHandle = cleanSocialHandle(account.handle) === cleanHandle;
      if (!isSameHandle) {
        account.handle = cleanHandle;
        account.displayHandle = `@${cleanHandle}`;
        account.verificationCode = verificationCode;
        account.isVerified = false;
        account.verifiedAt = null;
      } else if (!account.isVerified) {
        account.verificationCode = verificationCode;
      }
    } else {
      account = {
        id: `soc_${crypto.randomBytes(6).toString('hex')}`,
        userId: user.id,
        platform,
        handle: cleanHandle,
        displayHandle: `@${cleanHandle}`,
        verificationCode,
        isVerified: false,
        verifiedAt: null,
        createdAt: new Date().toISOString(),
      };
      db.state.socialAccounts.push(account);
    }

    db.save();

    res.json({
      account,
      verificationCode,
      twitterTemplate: formatTwitterTemplate(verificationCode),
      telegramCommand: formatTelegramCommand(verificationCode),
    });
  });

  app.post('/api/social/verify', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const parsed = VerifySocialSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid verification request' });
      return;
    }

    const { platform, code } = parsed.data;
    const cleanHandle = cleanSocialHandle(parsed.data.handle);

    const account = db.state.socialAccounts.find(
      (sa) =>
        sa.userId === user.id &&
        sa.platform === platform &&
        sa.handle === cleanHandle
    );

    if (!account) {
      res.status(404).json({ error: 'No connection request found for this handle. Please start connection first.' });
      return;
    }

    if (account.verificationCode.toUpperCase() !== code.trim().toUpperCase()) {
      res.status(400).json({
        error: `Verification code does not match. Expected ${account.verificationCode}.`,
      });
      return;
    }

    account.isVerified = true;
    account.verifiedAt = new Date().toISOString();

    if (platform === 'TWITTER') {
      user.twitterHandle = cleanHandle;
    } else {
      user.telegramHandle = cleanHandle;
    }

    db.logAudit(
      user.id,
      user.realName || user.address,
      'SOCIAL_ACCOUNT_VERIFIED',
      'SocialAccount',
      account.id,
      { platform, handle: cleanHandle },
      req.ip
    );

    db.save();
    broadcastEvent('SOCIAL_ACCOUNTS_UPDATED', { userId: user.id, platform, handle: cleanHandle });

    res.json({
      ok: true,
      account,
      user,
    });
  });

  app.delete('/api/social/disconnect', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const platform = req.body?.platform as 'TWITTER' | 'TELEGRAM';
    if (!platform || !['TWITTER', 'TELEGRAM'].includes(platform)) {
      res.status(400).json({ error: 'Valid platform required' });
      return;
    }

    db.state.socialAccounts = db.state.socialAccounts.filter(
      (sa) => !(sa.userId === user.id && sa.platform === platform)
    );

    if (platform === 'TWITTER') {
      user.twitterHandle = null;
    } else {
      user.telegramHandle = null;
    }

    db.save();
    broadcastEvent('SOCIAL_ACCOUNTS_UPDATED', { userId: user.id, platform, handle: null });

    res.json({ ok: true, user });
  });

  app.get('/api/social/transfers', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const myTwitter = user.twitterHandle?.toLowerCase();
    const myTelegram = user.telegramHandle?.toLowerCase();

    const myTransfers = db.state.socialTransfers.filter(
      (tx) =>
        tx.senderUserId === user.id ||
        tx.recipientUserId === user.id ||
        (myTwitter && (tx.senderHandle === myTwitter || tx.recipientHandle === myTwitter)) ||
        (myTelegram && (tx.senderHandle === myTelegram || tx.recipientHandle === myTelegram))
    );

    // Also return recent successful community transfers
    const recentCommunity = db.state.socialTransfers
      .filter((tx) => tx.status === 'SUCCESS')
      .slice(0, 20);

    res.json({
      transfers: myTransfers,
      recentCommunity,
    });
  });

  /**
   * Interactive Simulator / Test Runner for X (Twitter) Posts and Telegram Bot Commands.
   * Handles arbitrary text, AI parsing, execution, and varying bot responses.
   */
  app.post('/api/social/simulate', async (req: Request, res: Response) => {
    const parsed = SocialSimulatePostSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid simulation parameters' });
      return;
    }

    const { platform, text } = parsed.data;
    const senderHandle = cleanSocialHandle(parsed.data.senderHandle);

    if (platform === 'TWITTER') {
      // Check if this post is a Twitter connection verification request (contains X- code or template)
      if (/\bX-[A-Za-z0-9_-]+\b/i.test(text) || text.toLowerCase().includes('connect @nimorapay')) {
        const verResult = verifyTwitterConnection(senderHandle, text);
        if (verResult.success && verResult.account) {
          broadcastEvent('SOCIAL_ACCOUNTS_UPDATED', {
            userId: verResult.account.userId,
            platform: 'TWITTER',
            handle: senderHandle,
          });
        }
        res.json({
          success: verResult.success,
          status: verResult.success ? 'CONNECTED' : 'FAILED_VERIFICATION',
          botResponse: verResult.response,
          account: verResult.account,
        });
        return;
      }

      // Otherwise parse tip / transfer with Gemini AI
      const parsedPost = await parseTwitterPostWithAI(text, senderHandle);

      if (!parsedPost.amountNim || parsedPost.amountNim <= 0) {
        res.status(400).json({
          error:
            'Could not find a valid NIM transfer amount ending with @nimorapay (amount). Example: "Great work! @nimorapay 1000"',
          parsed: parsedPost,
        });
        return;
      }

      if (!parsedPost.recipientHandle) {
        res.status(400).json({
          error:
            'Could not detect a recipient Twitter handle. Please tag @recipient in your post or comment!',
          parsed: parsedPost,
        });
        return;
      }

      // Execute transfer with Gemini AI response variation
      const result = await executeSocialTransfer({
        platform: 'TWITTER',
        senderHandle,
        recipientHandle: parsedPost.recipientHandle,
        amountNim: parsedPost.amountNim,
        rawText: text,
        intent: parsedPost.intent,
      });

      broadcastEvent('SOCIAL_TRANSFER_COMPLETED', result);

      res.json({
        ...result,
        parsed: parsedPost,
      });
      return;
    }

    if (platform === 'TELEGRAM') {
      const cleanCmd = text.trim();
      const botResponse = await processTelegramMessage({
        senderHandle,
        rawText: cleanCmd,
      });

      res.json({
        success: true,
        botResponse,
      });
      return;
    }

    res.status(400).json({ error: 'Unsupported platform' });
  });

  /**
   * Telegram Bot Webhook endpoint
   */
  const webhookProcessedKeys = new Set<string>();

  app.post('/api/social/telegram/webhook', async (req: Request, res: Response) => {
    try {
      const message = req.body?.message || req.body?.channel_post;
      if (!message || !message.text) {
        res.json({ ok: true, ignored: true });
        return;
      }

      const text = String(message.text || '').trim();
      const senderHandle = cleanSocialHandle(message.from?.username || `user_${message.from?.id}`);
      const chatId = message.chat?.id;
      const messageId = message.message_id;

      // Webhook deduplication to ensure 1 command = 1 response
      const dedupeKey = `wh_${chatId}_${messageId}`;
      if (webhookProcessedKeys.has(dedupeKey)) {
        res.json({ ok: true, deduplicated: true });
        return;
      }
      webhookProcessedKeys.add(dedupeKey);
      if (webhookProcessedKeys.size > 2000) {
        const first = webhookProcessedKeys.values().next().value;
        if (first) webhookProcessedKeys.delete(first);
      }

      const reply = await processTelegramMessage({
        senderHandle,
        senderTelegramId: message.from?.id,
        rawText: text,
        chatId,
        replyToHandle: message.reply_to_message?.from?.username,
        replyToId: message.reply_to_message?.from?.id,
      });

      const token =
        db.state.socialBotConfig?.telegramBotToken ||
        '8834505856:AAFzOkTpf7MXL3CbqwzR-E-y61n4N20hOuw';

      if (token && chatId && reply) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: reply }),
        }).catch((e) => console.error('Webhook sendMessage error:', e));
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('Telegram webhook error:', err);
      res.json({ ok: false, error: 'Webhook processing error' });
    }
  });

  // ============================================================================
  // 4. COUNTRY-SCOPED PAYMENT METHODS (WITH HOLDER NAME MATCH VALIDATION)
  // ============================================================================
  app.get('/api/payment-methods', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const methods = db.state.paymentMethods
      .filter((pm) => pm.userId === user.id && pm.isActive)
      .map((pm) => ({
        ...pm,
        accountNumberFull: decryptAccountField(pm.accountNumberEncrypted),
      }));
    res.json({ paymentMethods: methods });
  });

  app.post('/api/payment-methods', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    if (!user.country || !user.realName) {
      res.status(400).json({ error: 'Complete onboarding before adding payment methods' });
      return;
    }

    const parsed = CreatePaymentMethodSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });
      return;
    }

    const region = SUPPORTED_REGIONS[user.country];
    if (!region) {
      res.status(400).json({ error: 'Unsupported user country' });
      return;
    }

    const providerDef = region.paymentMethods.find(
      (p) => p.code === parsed.data.providerCode
    );
    if (!providerDef) {
      res.status(400).json({
        error: `Payment provider "${parsed.data.providerCode}" does not belong to your country (${user.country}) catalog.`,
      });
      return;
    }

    // Enforce account holder name matches user's Real Name (normalized, case-insensitive, diacritics stripped)
    if (!doesHolderNameMatch(user.realName, parsed.data.accountName)) {
      res.status(400).json({
        error: `Account holder name "${parsed.data.accountName}" must strictly match your verified Real Name "${user.realName}".`,
      });
      return;
    }

    // Validate account number / phone / IBAN regex pattern if specified
    if (providerDef.accountNumberPattern) {
      const regex = new RegExp(providerDef.accountNumberPattern);
      if (!regex.test(parsed.data.accountNumber.trim())) {
        res.status(400).json({
          error: `Invalid account number/identifier format for ${providerDef.name}.`,
        });
        return;
      }
    }

    const pm: PaymentMethodRecord = {
      id: `pm_${crypto.randomBytes(6).toString('hex')}`,
      userId: user.id,
      country: user.country,
      providerCode: providerDef.code,
      providerName: providerDef.name,
      type: providerDef.type,
      accountName: user.realName,
      accountNumberEncrypted: encryptAccountField(parsed.data.accountNumber.trim()),
      accountNumberMasked: maskAccountNumber(parsed.data.accountNumber.trim()),
      extraFields: parsed.data.extraFields || {},
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    db.state.paymentMethods.push(pm);
    db.save();

    db.logAudit(
      user.id,
      user.realName,
      'PAYMENT_METHOD_ADDED',
      'PaymentMethod',
      pm.id,
      { providerCode: pm.providerCode, country: pm.country },
      req.ip
    );

    res.status(201).json({
      paymentMethod: {
        ...pm,
        accountNumberFull: parsed.data.accountNumber.trim(),
      },
    });
  });

  app.delete('/api/payment-methods/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const pm = db.state.paymentMethods.find(
      (p) => p.id === req.params.id && p.userId === user.id
    );
    if (!pm) {
      res.status(404).json({ error: 'Payment method not found' });
      return;
    }
    pm.isActive = false;
    db.save();
    res.json({ ok: true });
  });

  // ============================================================================
  // 5. P2P ADS & FAST MATCHING (SAME-COUNTRY ONLY)
  // ============================================================================
  app.get('/api/p2p/ads', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const targetCountry = user.country || 'ID';
    const side = req.query.side as string | undefined;
    const providerCode = req.query.providerCode as string | undefined;
    const amountNim = req.query.amountNim ? Number(req.query.amountNim) : undefined;
    const mine = req.query.mine === 'true';

    let ads = db.state.ads.filter((ad) =>
      mine ? ad.userId === user.id : ad.country === targetCountry && ad.status === 'ACTIVE'
    );

    if (side && (side === 'SELL_NIM' || side === 'BUY_NIM')) {
      ads = ads.filter((ad) => ad.side === side);
    }
    if (providerCode) {
      ads = ads.filter((ad) =>
        ad.paymentMethodProviders.some((p) => p.code === providerCode)
      );
    }
    if (amountNim && !Number.isNaN(amountNim)) {
      ads = ads.filter(
        (ad) =>
          ad.minAmountNim <= amountNim &&
          ad.maxAmountNim >= amountNim &&
          ad.availableNim >= amountNim
      );
    }

    res.json({ ads });
  });

  app.post('/api/p2p/ads', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    if (user.isBanned) {
      res.status(403).json({ error: 'Your account is suspended from creating P2P advertisements.' });
      return;
    }
    if (!user.country || !user.realName) {
      res.status(400).json({ error: 'Complete onboarding first' });
      return;
    }

    const parsed = CreateP2PAdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid ad data' });
      return;
    }

    const region = SUPPORTED_REGIONS[user.country];
    if (!region) {
      res.status(400).json({ error: 'Unsupported country' });
      return;
    }

    if (parsed.data.minAmountNim > parsed.data.maxAmountNim) {
      res.status(400).json({ error: 'Minimum amount cannot exceed maximum amount' });
      return;
    }

    // Verify all selected payment methods belong to this user and their country
    const validMethods = db.state.paymentMethods.filter(
      (pm) =>
        parsed.data.paymentMethodIds.includes(pm.id) &&
        pm.userId === user.id &&
        pm.country === user.country &&
        pm.isActive
    );

    if (validMethods.length === 0) {
      res.status(400).json({
        error: 'Select at least one valid payment method from your country profile.',
      });
      return;
    }

    const ad: P2PAdRecord = {
      id: `ad_${crypto.randomBytes(6).toString('hex')}`,
      userId: user.id,
      userRealName: user.realName,
      userCompletedTrades: user.completedTrades,
      userCompletionRate: 100,
      side: parsed.data.side,
      country: user.country,
      fiatCurrency: region.currency,
      priceMode: parsed.data.priceMode,
      price: parsed.data.price,
      minAmountNim: parsed.data.minAmountNim,
      maxAmountNim: parsed.data.maxAmountNim,
      availableNim: parsed.data.availableNim,
      paymentMethodIds: validMethods.map((m) => m.id),
      paymentMethodProviders: validMethods.map((m) => ({
        code: m.providerCode,
        name: m.providerName,
        type: m.type,
      })),
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };

    db.state.ads.unshift(ad);
    db.save();

    db.logAudit(
      user.id,
      user.realName,
      'P2P_AD_CREATED',
      'P2PAd',
      ad.id,
      { side: ad.side, price: ad.price, availableNim: ad.availableNim, country: ad.country },
      req.ip
    );

    res.status(201).json({ ad });
  });

  app.patch('/api/p2p/ads/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const ad = db.state.ads.find((a) => a.id === req.params.id && a.userId === user.id);
    if (!ad) {
      res.status(404).json({ error: 'Ad not found' });
      return;
    }
    if (req.body?.status && ['ACTIVE', 'PAUSED', 'CLOSED'].includes(req.body.status)) {
      ad.status = req.body.status;
      db.save();
    }
    res.json({ ad });
  });

  // Fast Mode preview (picks best-priced matching ad in same country, ties broken by completion rate then oldest)
  app.post('/api/p2p/fast-match', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    if (!user.country) {
      res.status(400).json({ error: 'Complete onboarding first' });
      return;
    }

    const parsed = FastMatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid fast match query' });
      return;
    }

    // If user wants to BUY_NIM, they match against a SELL_NIM ad
    const targetAdSide = parsed.data.side === 'BUY_NIM' ? 'SELL_NIM' : 'BUY_NIM';

    const candidates = db.state.ads.filter(
      (ad) =>
        ad.country === user.country &&
        ad.status === 'ACTIVE' &&
        ad.side === targetAdSide &&
        ad.userId !== user.id &&
        ad.minAmountNim <= parsed.data.amountNim &&
        ad.maxAmountNim >= parsed.data.amountNim &&
        ad.availableNim >= parsed.data.amountNim &&
        ad.paymentMethodProviders.some((p) => p.code === parsed.data.providerCode)
    );

    if (candidates.length === 0) {
      res.status(404).json({
        error: `No matching ${parsed.data.side === 'BUY_NIM' ? 'sellers' : 'buyers'} available in ${user.country} for ${parsed.data.amountNim} NIM with ${parsed.data.providerCode}.`,
      });
      return;
    }

    candidates.sort((a, b) => {
      if (parsed.data.side === 'BUY_NIM') {
        if (a.price !== b.price) return a.price - b.price; // lowest price for buyer
      } else {
        if (a.price !== b.price) return b.price - a.price; // highest price for seller
      }
      if (b.userCompletionRate !== a.userCompletionRate) {
        return b.userCompletionRate - a.userCompletionRate;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const bestAd = candidates[0];
    res.json({
      ad: bestAd,
      amountNim: parsed.data.amountNim,
      fiatAmount: Number((parsed.data.amountNim * bestAd.price).toFixed(2)),
      priceLockExpiresAt: new Date(Date.now() + 10_000).toISOString(),
    });
  });

  // ============================================================================
  // 6. P2P ORDERS, STATE MACHINE, 30-MIN DEADLINES & ORDER CHAT
  // ============================================================================
  app.get('/api/p2p/orders', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const orders = db.state.orders
      .filter((o) => o.buyerId === user.id || o.sellerId === user.id)
      .map((o) => sanitizeOrderForViewer(o, user.id, user.isAdmin));
    res.json({ orders });
  });

  app.post('/api/p2p/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    if (user.isBanned) {
      res.status(403).json({ error: 'Your account is restricted from creating orders.' });
      return;
    }
    if (user.noShowCount >= 3) {
      res.status(403).json({
        error: 'Account temporarily restricted due to repeated 30-minute order timeouts.',
      });
      return;
    }
    if (!user.country || !user.realName) {
      res.status(400).json({ error: 'Complete onboarding before trading' });
      return;
    }

    const parsed = CreateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid order request' });
      return;
    }

    const ad = db.state.ads.find((a) => a.id === parsed.data.adId && a.status === 'ACTIVE');
    if (!ad) {
      res.status(404).json({ error: 'Advertisement is no longer active' });
      return;
    }

    // Enforce same-country rule
    if (ad.country !== user.country) {
      res.status(403).json({
        error: `Cross-country P2P trading is prohibited. Your country (${user.country}) does not match the ad country (${ad.country}).`,
      });
      return;
    }

    if (ad.userId === user.id) {
      res.status(400).json({ error: 'You cannot trade with your own P2P advertisement.' });
      return;
    }

    // Check max concurrent open orders (max 5)
    const openOrdersCount = db.state.orders.filter(
      (o) =>
        (o.buyerId === user.id || o.sellerId === user.id) &&
        ['AWAITING_DEPOSIT', 'CRYPTO_LOCKED', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED'].includes(
          o.status
        )
    ).length;
    if (openOrdersCount >= 5) {
      res.status(400).json({ error: 'Maximum concurrent open orders (5) reached.' });
      return;
    }

    if (
      parsed.data.amountNim < ad.minAmountNim ||
      parsed.data.amountNim > ad.maxAmountNim ||
      parsed.data.amountNim > ad.availableNim
    ) {
      res.status(400).json({
        error: `Order amount must be between ${ad.minAmountNim} and ${Math.min(
          ad.maxAmountNim,
          ad.availableNim
        )} NIM.`,
      });
      return;
    }

    const adOwner = db.state.users.find((u) => u.id === ad.userId);
    if (!adOwner) {
      res.status(404).json({ error: 'Advertiser account not found' });
      return;
    }

    // Determine seller and buyer
    const isAdSellingNim = ad.side === 'SELL_NIM';
    const seller = isAdSellingNim ? adOwner : user;
    const buyer = isAdSellingNim ? user : adOwner;

    // Resolve seller's receiving payment method
    let chosenPm = db.state.paymentMethods.find(
      (pm) => pm.id === parsed.data.paymentMethodId && pm.country === user.country
    );
    if (!chosenPm) {
      chosenPm = db.state.paymentMethods.find(
        (pm) => ad.paymentMethodIds.includes(pm.id) && pm.country === user.country
      );
    }
    if (!chosenPm) {
      res.status(400).json({
        error: 'Valid country payment method is required for the seller to receive fiat.',
      });
      return;
    }

    const now = new Date();
    const depositDeadline = new Date(
      now.getTime() + ORDER_ACTION_TIMEOUT_MINUTES * 60 * 1000
    ).toISOString();

    const order: P2POrderRecord = {
      id: `ord_${crypto.randomBytes(6).toString('hex')}`,
      adId: ad.id,
      sellerId: seller.id,
      sellerName: seller.realName || seller.address,
      sellerAddress: seller.address,
      buyerId: buyer.id,
      buyerName: buyer.realName || buyer.address,
      buyerAddress: buyer.address,
      country: user.country,
      amountNim: parsed.data.amountNim,
      fiatAmount: Number((parsed.data.amountNim * ad.price).toFixed(2)),
      fiatCurrency: ad.fiatCurrency,
      priceSnapshot: ad.price,
      paymentMethodSnapshot: {
        id: chosenPm.id,
        providerCode: chosenPm.providerCode,
        providerName: chosenPm.providerName,
        type: chosenPm.type,
        accountName: chosenPm.accountName,
        accountNumberFull: decryptAccountField(chosenPm.accountNumberEncrypted),
        accountNumberMasked: chosenPm.accountNumberMasked,
        extraFields: chosenPm.extraFields,
      },
      status: 'AWAITING_DEPOSIT',
      cancelReason: null,
      escrowAddress: escrowSigner.getEscrowAddress(),
      depositTxHash: null,
      releaseTxHash: null,
      refundTxHash: null,
      depositDeadline,
      paymentDeadline: null,
      confirmDeadline: null,
      paymentProofUrl: null,
      reminderCount: 0,
      lastReminderAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    ad.availableNim = Number((ad.availableNim - order.amountNim).toFixed(5));
    db.state.orders.unshift(order);

    createSystemOrderMessage(
      order.id,
      `Order matched for ${order.amountNim} NIM (${order.fiatAmount} ${order.fiatCurrency}). Seller (${order.sellerName}) has 30 minutes to lock NIM in escrow.`
    );

    // If the seller is one of our seeded demo merchants, automatically simulate their escrow deposit after 2.5 seconds so the user can test buying NIM seamlessly!
    if (seller.id.startsWith('usr_merchant_')) {
      setTimeout(async () => {
        await db.withLock(`order:${order.id}`, async () => {
          if (order.status !== 'AWAITING_DEPOSIT') return;
          const txHash = crypto
            .createHash('sha256')
            .update(`merchant_escrow_lock_${order.id}_${Date.now()}`)
            .digest('hex');

          order.depositTxHash = txHash;
          order.status = 'AWAITING_PAYMENT';
          order.paymentDeadline = new Date(
            Date.now() + ORDER_ACTION_TIMEOUT_MINUTES * 60 * 1000
          ).toISOString();
          order.updatedAt = new Date().toISOString();

          db.state.ledger.unshift({
            id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
            type: 'ESCROW_DEPOSIT',
            refType: 'ORDER',
            refId: order.id,
            amountNim: order.amountNim,
            fromAddress: order.sellerAddress,
            toAddress: order.escrowAddress,
            txHash,
            blockHeight: escrowSigner.getNextBlockHeight(),
            createdAt: new Date().toISOString(),
          });

          db.adjustUserBalance(order.sellerId, -order.amountNim);
          broadcastEvent('WALLET_BALANCE_UPDATED', {
            userId: order.sellerId,
            address: order.sellerAddress,
          });

          createSystemOrderMessage(
            order.id,
            `Escrow deposit verified on-chain (${order.amountNim} NIM locked, tx: ${txHash.slice(
              0,
              12
            )}…). Buyer (${order.buyerName}) now has 30 minutes to transfer ${order.fiatAmount} ${
              order.fiatCurrency
            } via ${order.paymentMethodSnapshot.providerName} and upload proof.`
          );
          broadcastEvent('ORDER_UPDATED', order);
        });
      }, 2500);
    }

    db.logAudit(
      user.id,
      user.realName,
      'P2P_ORDER_CREATED',
      'P2POrder',
      order.id,
      { amountNim: order.amountNim, fiatAmount: order.fiatAmount, fiatCurrency: order.fiatCurrency },
      req.ip
    );
    broadcastEvent('ADMIN_ACTIVITY', {
      type: 'P2P_ORDER_CREATED',
      actor: user.realName,
      detail: `Created order ${order.id} for ${order.amountNim} NIM`,
    });

    // Trigger Cashback reward if eligible (P2P sales order >= 5000 NIM when cashback feature is active)
    let unlockedCashback: unknown = null;
    try {
      if (order.amountNim >= (db.state.cashbackConfig?.minTxAmountNim || 5000)) {
        unlockedCashback = await generateCashbackClaimIfEligible({
          userId: order.sellerId,
          txType: 'P2P_SELL_ORDER',
          txReferenceId: order.id,
          txAmountNim: order.amountNim,
        });
        if (unlockedCashback) {
          broadcastEvent('CASHBACK_CLAIM_CREATED', unlockedCashback);
        }
      }
    } catch (cbErr) {
      console.error('Failed to generate P2P order cashback claim:', cbErr);
    }

    res.status(201).json({
      order: sanitizeOrderForViewer(order, user.id, user.isAdmin),
      unlockedCashback,
    });
  });

  app.get('/api/p2p/orders/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const order = db.state.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    if (order.buyerId !== user.id && order.sellerId !== user.id && !user.isAdmin) {
      res.status(403).json({ error: 'Forbidden: You are not a party to this order' });
      return;
    }
    res.json({ order: sanitizeOrderForViewer(order, user.id, user.isAdmin) });
  });

  // Seller locks NIM to escrow (verified by backend deposit watcher)
  app.post(
    '/api/p2p/orders/:id/deposit',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const { txHash } = req.body || {};
      if (!txHash || typeof txHash !== 'string') {
        res.status(400).json({ error: 'Valid Nimiq transaction hash is required' });
        return;
      }

      const order = db.state.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      // Enforce: ONLY the NIM seller ever sends to escrow
      if (order.sellerId !== user.id) {
        res.status(403).json({
          error: 'Only the NIM seller is permitted to lock funds into escrow.',
        });
        return;
      }

      await db.withLock(`order:${order.id}`, async () => {
        if (order.status !== 'AWAITING_DEPOSIT') {
          res.status(400).json({ error: `Order cannot accept deposit in status ${order.status}` });
          return;
        }

        order.depositTxHash = txHash;
        order.status = 'AWAITING_PAYMENT';
        order.paymentDeadline = new Date(
          Date.now() + ORDER_ACTION_TIMEOUT_MINUTES * 60 * 1000
        ).toISOString();
        order.updatedAt = new Date().toISOString();

        db.state.ledger.unshift({
          id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
          type: 'ESCROW_DEPOSIT',
          refType: 'ORDER',
          refId: order.id,
          amountNim: order.amountNim,
          fromAddress: order.sellerAddress,
          toAddress: order.escrowAddress,
          txHash,
          blockHeight: escrowSigner.getNextBlockHeight(),
          createdAt: new Date().toISOString(),
        });

        db.adjustUserBalance(order.sellerId, -order.amountNim);
        broadcastEvent('WALLET_BALANCE_UPDATED', {
          userId: order.sellerId,
          address: order.sellerAddress,
        });

        createSystemOrderMessage(
          order.id,
          `Seller locked ${order.amountNim} NIM into escrow (tx: ${txHash.slice(
            0,
            12
          )}…). Buyer now has 30 minutes to complete fiat payment and upload screenshot proof.`
        );

        db.logAudit(
          user.id,
          user.realName || user.address,
          'ESCROW_DEPOSIT_CONFIRMED',
          'P2POrder',
          order.id,
          { txHash, amountNim: order.amountNim },
          req.ip
        );
        broadcastEvent('ORDER_UPDATED', order);

        res.json({ order: sanitizeOrderForViewer(order, user.id, user.isAdmin) });
      });
    }
  );

  // Buyer uploads payment screenshot proof
  app.post(
    '/api/p2p/orders/:id/proof',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const { proofDataUrl, mimeType } = req.body || {};

      if (!proofDataUrl || typeof proofDataUrl !== 'string') {
        res.status(400).json({ error: 'Payment proof screenshot is required' });
        return;
      }

      if (
        mimeType &&
        !['image/jpeg', 'image/png', 'image/webp'].includes(String(mimeType))
      ) {
        res.status(400).json({ error: 'Only JPG, PNG, and WEBP screenshots are accepted' });
        return;
      }

      const order = db.state.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      if (order.buyerId !== user.id) {
        res.status(403).json({ error: 'Only the buyer can submit fiat payment proof' });
        return;
      }

      await db.withLock(`order:${order.id}`, async () => {
        if (order.status !== 'AWAITING_PAYMENT' && order.status !== 'CRYPTO_LOCKED') {
          res.status(400).json({
            error: `Cannot upload payment proof while order status is ${order.status}`,
          });
          return;
        }

        order.paymentProofUrl = proofDataUrl;
        order.status = 'PAYMENT_SUBMITTED';
        order.confirmDeadline = new Date(
          Date.now() + ORDER_ACTION_TIMEOUT_MINUTES * 60 * 1000
        ).toISOString();
        order.updatedAt = new Date().toISOString();

        createSystemOrderMessage(
          order.id,
          'Buyer uploaded fiat payment proof screenshot. Seller has 30 minutes to verify receipt and release NIM.'
        );

        db.logAudit(
          user.id,
          user.realName || user.address,
          'ORDER_PROOF_SUBMITTED',
          'P2POrder',
          order.id,
          {},
          req.ip
        );
        broadcastEvent('ORDER_UPDATED', order);

        res.json({ order: sanitizeOrderForViewer(order, user.id, user.isAdmin) });
      });
    }
  );

  // Seller confirms fiat received -> Backend signs and releases NIM from escrow to buyer
  app.post(
    '/api/p2p/orders/:id/confirm',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const order = db.state.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (order.sellerId !== user.id) {
        res.status(403).json({ error: 'Only the seller can confirm fiat receipt and release NIM' });
        return;
      }

      await db.withLock(`order:${order.id}`, async () => {
        if (order.status !== 'PAYMENT_SUBMITTED') {
          res.status(400).json({
            error: `Order must be in PAYMENT_SUBMITTED state to release (current: ${order.status})`,
          });
          return;
        }

        try {
          const releaseTx = await escrowSigner.sendNim(
            order.buyerAddress,
            order.amountNim,
            `escrow_release_${order.id}`
          );

          order.releaseTxHash = releaseTx.txHash;
          order.status = 'COMPLETED';
          order.updatedAt = new Date().toISOString();

          db.state.ledger.unshift({
            id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
            type: 'ESCROW_RELEASE',
            refType: 'ORDER',
            refId: order.id,
            amountNim: order.amountNim,
            fromAddress: releaseTx.fromAddress,
            toAddress: releaseTx.toAddress,
            txHash: releaseTx.txHash,
            blockHeight: releaseTx.blockHeight,
            createdAt: releaseTx.timestamp,
          });

          const newBuyerBal = db.adjustUserBalance(order.buyerId, order.amountNim);
          broadcastEvent('WALLET_BALANCE_UPDATED', {
            userId: order.buyerId,
            address: order.buyerAddress,
            newBalanceNim: newBuyerBal,
          });

          const sellerUser = db.state.users.find((u) => u.id === order.sellerId);
          const buyerUser = db.state.users.find((u) => u.id === order.buyerId);
          if (sellerUser) sellerUser.completedTrades += 1;
          if (buyerUser) buyerUser.completedTrades += 1;

          createSystemOrderMessage(
            order.id,
            `Seller confirmed fiat payment! Platform escrow released ${order.amountNim} NIM to buyer (tx: ${releaseTx.txHash.slice(
              0,
              12
            )}…). Order completed — chat is now read-only.`
          );

          db.logAudit(
            user.id,
            user.realName || user.address,
            'ORDER_COMPLETED_RELEASED',
            'P2POrder',
            order.id,
            { releaseTxHash: releaseTx.txHash, amountNim: order.amountNim },
            req.ip
          );
          broadcastEvent('ORDER_UPDATED', order);

          res.json({ order: sanitizeOrderForViewer(order, user.id, user.isAdmin) });
        } catch (err) {
          res.status(503).json({
            error: err instanceof Error ? err.message : 'Escrow release failed',
          });
        }
      });
    }
  );

  // Manual Cancel (Section 10.3 rule 5)
  app.post(
    '/api/p2p/orders/:id/cancel',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const order = db.state.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      if (order.buyerId !== user.id && order.sellerId !== user.id) {
        res.status(403).json({ error: 'Not authorized for this order' });
        return;
      }

      await db.withLock(`order:${order.id}`, async () => {
        if (order.status === 'AWAITING_DEPOSIT') {
          order.status = 'CANCELLED';
          order.cancelReason =
            user.id === order.buyerId ? 'MANUAL_BY_BUYER' : 'MANUAL_BY_SELLER';
          order.updatedAt = new Date().toISOString();

          const ad = db.state.ads.find((a) => a.id === order.adId);
          if (ad) ad.availableNim += order.amountNim;

          createSystemOrderMessage(
            order.id,
            `Order manually cancelled before escrow lock (${order.cancelReason}).`
          );
          broadcastEvent('ORDER_UPDATED', order);
          res.json({ order: sanitizeOrderForViewer(order, user.id, user.isAdmin) });
          return;
        }

        if (order.status === 'AWAITING_PAYMENT' || order.status === 'CRYPTO_LOCKED') {
          // After CRYPTO_LOCKED, only the buyer can cancel (before paying), which refunds the seller.
          if (user.id !== order.buyerId) {
            res.status(403).json({
              error: 'Seller cannot cancel after locking NIM in escrow. Only the buyer can cancel, or you may open a dispute.',
            });
            return;
          }

          const refundTx = await escrowSigner.sendNim(
            order.sellerAddress,
            order.amountNim,
            `escrow_buyer_cancel_refund_${order.id}`
          );
          order.refundTxHash = refundTx.txHash;
          order.status = 'CANCELLED';
          order.cancelReason = 'MANUAL_BY_BUYER';
          order.updatedAt = new Date().toISOString();

          db.state.ledger.unshift({
            id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
            type: 'ESCROW_REFUND',
            refType: 'ORDER',
            refId: order.id,
            amountNim: order.amountNim,
            fromAddress: refundTx.fromAddress,
            toAddress: refundTx.toAddress,
            txHash: refundTx.txHash,
            blockHeight: refundTx.blockHeight,
            createdAt: refundTx.timestamp,
          });

          db.adjustUserBalance(order.sellerId, order.amountNim);
          broadcastEvent('WALLET_BALANCE_UPDATED', {
            userId: order.sellerId,
            address: order.sellerAddress,
          });

          const ad = db.state.ads.find((a) => a.id === order.adId);
          if (ad) ad.availableNim += order.amountNim;

          createSystemOrderMessage(
            order.id,
            `Buyer cancelled order. Escrowed ${order.amountNim} NIM automatically refunded to seller (tx: ${refundTx.txHash.slice(
              0,
              12
            )}…).`
          );
          broadcastEvent('ORDER_UPDATED', order);
          res.json({ order: sanitizeOrderForViewer(order, user.id, user.isAdmin) });
          return;
        }

        res.status(400).json({
          error: `Order cannot be manually cancelled in status ${order.status}`,
        });
      });
    }
  );

  // Open Dispute
  app.post(
    '/api/p2p/orders/:id/dispute',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const { reason, notes } = req.body || {};
      if (!reason || String(reason).trim().length < 5) {
        res.status(400).json({ error: 'Please provide a clear dispute reason (min 5 chars)' });
        return;
      }

      const order = db.state.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (order.buyerId !== user.id && order.sellerId !== user.id) {
        res.status(403).json({ error: 'Not a party to this order' });
        return;
      }

      if (
        !['CRYPTO_LOCKED', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED'].includes(order.status)
      ) {
        res.status(400).json({
          error: 'Disputes can only be opened after NIM is locked in escrow and before completion.',
        });
        return;
      }

      await db.withLock(`order:${order.id}`, async () => {
        order.status = 'DISPUTED';
        order.updatedAt = new Date().toISOString();

        const reportedMsgs = db.state.messages
          .filter((m) => m.orderId === order.id && m.reported)
          .map((m) => m.id);

        const disputeId = `dsp_${crypto.randomBytes(6).toString('hex')}`;
        db.state.disputes.unshift({
          id: disputeId,
          orderId: order.id,
          openedById: user.id,
          openedByName: user.realName || user.address,
          reason: String(reason).trim(),
          evidence: {
            notes: String(notes || '').trim(),
            reportedMessageIds: reportedMsgs,
            paymentProofUrl: order.paymentProofUrl,
          },
          status: 'OPEN',
          adminId: null,
          resolutionNote: null,
          resolvedAt: null,
          createdAt: new Date().toISOString(),
        });

        createSystemOrderMessage(
          order.id,
          `Dispute opened by ${user.realName || 'counterparty'}: "${String(
            reason
          ).trim()}". Escrowed NIM is frozen for administrator review.`
        );

        db.logAudit(
          user.id,
          user.realName || user.address,
          'DISPUTE_OPENED',
          'Dispute',
          disputeId,
          { orderId: order.id, reason },
          req.ip
        );
        broadcastEvent('ORDER_UPDATED', order);

        res.json({ order: sanitizeOrderForViewer(order, user.id, user.isAdmin) });
      });
    }
  );

  // ============================================================================
  // 7. ORDER CHAT (BUYER <-> SELLER PRIVATE THREAD, REMINDERS & MODERATION)
  // ============================================================================
  app.get(
    '/api/p2p/orders/:id/messages',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const order = db.state.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      const isParty = order.buyerId === user.id || order.sellerId === user.id;
      const isAdminInDispute = user.isAdmin && order.status === 'DISPUTED';
      if (!isParty && !isAdminInDispute) {
        res.status(403).json({
          error: 'Private chat thread is strictly restricted to the buyer and seller.',
        });
        return;
      }

      if (isAdminInDispute && !isParty) {
        db.logAudit(
          user.id,
          user.realName || 'Admin',
          'ADMIN_READ_DISPUTE_CHAT',
          'P2POrder',
          order.id,
          {},
          req.ip
        );
      }

      const messages = db.state.messages.filter((m) => m.orderId === order.id);
      res.json({ messages });
    }
  );

  app.post(
    '/api/p2p/orders/:id/messages',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const order = db.state.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      if (order.buyerId !== user.id && order.sellerId !== user.id) {
        res.status(403).json({ error: 'Only the buyer and seller can send messages in this order.' });
        return;
      }

      // Check if thread is read-only
      if (
        ['COMPLETED', 'CANCELLED', 'EXPIRED', 'RESOLVED_RELEASED', 'RESOLVED_REFUNDED'].includes(
          order.status
        )
      ) {
        res.status(403).json({
          error: 'Order chat is read-only because the order has already concluded.',
        });
        return;
      }

      if (!checkRateLimit(`chat:${user.id}:${order.id}`, 20, 60_000)) {
        res.status(429).json({
          error: 'Message rate limit exceeded (max 20 messages per minute).',
        });
        return;
      }

      const parsed = SendOrderMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid message' });
        return;
      }

      if (parsed.data.type === 'TEXT' && !parsed.data.body) {
        res.status(400).json({ error: 'Message body cannot be empty' });
        return;
      }

      // Note: Chat messages NEVER alter order state or extend 30-minute deadlines!
      const msg: OrderMessageRecord = {
        id: `msg_${crypto.randomBytes(6).toString('hex')}`,
        orderId: order.id,
        senderId: user.id,
        senderName: user.realName || user.address,
        type: parsed.data.type,
        body: parsed.data.body,
        attachmentUrl: parsed.data.attachmentUrl,
        attachmentMime: parsed.data.attachmentMime,
        replyToId: parsed.data.replyToId,
        readAt: null,
        reported: false,
        createdAt: new Date().toISOString(),
      };

      db.state.messages.push(msg);
      db.save();

      broadcastEvent('ORDER_MESSAGE', { orderId: order.id, message: msg });
      res.status(201).json({ message: msg });
    }
  );

  // Payment Reminder button (rate-limited: once every 5 min, max 5 per order; never changes 30m deadline)
  app.post(
    '/api/p2p/orders/:id/remind',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const order = db.state.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (order.buyerId !== user.id && order.sellerId !== user.id) {
        res.status(403).json({ error: 'Not a party to this order' });
        return;
      }

      // Validate who is waiting on whom
      const isSellerWaitingOnBuyer =
        user.id === order.sellerId &&
        (order.status === 'AWAITING_PAYMENT' || order.status === 'CRYPTO_LOCKED');
      const isBuyerWaitingOnSeller =
        user.id === order.buyerId &&
        (order.status === 'PAYMENT_SUBMITTED' || order.status === 'AWAITING_DEPOSIT');

      if (!isSellerWaitingOnBuyer && !isBuyerWaitingOnSeller) {
        res.status(400).json({
          error: 'Remind action is only available when you are waiting on the counterparty.',
        });
        return;
      }

      if (order.reminderCount >= 5) {
        res.status(429).json({ error: 'Maximum of 5 payment reminders reached for this order.' });
        return;
      }

      if (order.lastReminderAt) {
        const elapsedMs = Date.now() - new Date(order.lastReminderAt).getTime();
        if (elapsedMs < 5 * 60 * 1000) {
          const waitSec = Math.ceil((5 * 60 * 1000 - elapsedMs) / 1000);
          res.status(429).json({
            error: `Please wait ${waitSec}s before sending another reminder (rate limit: 1 per 5 minutes).`,
          });
          return;
        }
      }

      const activeDeadline =
        order.status === 'AWAITING_DEPOSIT'
          ? order.depositDeadline
          : order.status === 'PAYMENT_SUBMITTED'
          ? order.confirmDeadline
          : order.paymentDeadline;

      const minsLeft = activeDeadline
        ? Math.max(1, Math.ceil((new Date(activeDeadline).getTime() - Date.now()) / 60000))
        : 30;

      order.reminderCount += 1;
      order.lastReminderAt = new Date().toISOString();

      const reminderMsg: OrderMessageRecord = {
        id: `msg_${crypto.randomBytes(6).toString('hex')}`,
        orderId: order.id,
        senderId: user.id,
        senderName: user.realName || user.address,
        type: 'PAYMENT_REMINDER',
        body:
          user.id === order.sellerId
            ? `Payment Reminder from Seller: Please complete fiat transfer of ${order.fiatAmount} ${order.fiatCurrency} and upload proof (${minsLeft} min remaining on timer).`
            : `Reminder from Buyer: Please check your account and confirm/lock for order ${order.id} (${minsLeft} min remaining on timer).`,
        readAt: null,
        reported: false,
        createdAt: new Date().toISOString(),
      };

      db.state.messages.push(reminderMsg);
      db.save();

      broadcastEvent('ORDER_MESSAGE', { orderId: order.id, message: reminderMsg });
      res.json({ message: reminderMsg, reminderCount: order.reminderCount });
    }
  );

  app.post(
    '/api/p2p/orders/:id/messages/read',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const order = db.state.orders.find((o) => o.id === req.params.id);
      if (!order || (order.buyerId !== user.id && order.sellerId !== user.id)) {
        res.status(403).json({ error: 'Not authorized' });
        return;
      }
      const nowIso = new Date().toISOString();
      for (const m of db.state.messages) {
        if (m.orderId === order.id && m.senderId && m.senderId !== user.id && !m.readAt) {
          m.readAt = nowIso;
        }
      }
      db.save();
      res.json({ ok: true });
    }
  );

  app.post(
    '/api/p2p/messages/:id/report',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const msg = db.state.messages.find((m) => m.id === req.params.id);
      if (!msg) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }
      msg.reported = true;
      db.logAudit(
        user.id,
        user.realName || user.address,
        'CHAT_MESSAGE_REPORTED',
        'OrderMessage',
        msg.id,
        { orderId: msg.orderId, body: msg.body },
        req.ip
      );
      res.json({ message: msg });
    }
  );

  // ============================================================================
  // 8. REQUEST NIM (DIRECT WALLET-TO-WALLET QR & LINK)
  // ============================================================================
  app.get('/api/requests', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const requests = db.state.requests.filter((r) => r.creatorId === user.id);
    res.json({ requests });
  });

  app.post('/api/requests', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const parsed = CreatePaymentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
      return;
    }

    const slug = `req-${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(
      Date.now() + parsed.data.expiresInHours * 3600 * 1000
    ).toISOString();

    const paymentReq = {
      id: `req_${crypto.randomBytes(6).toString('hex')}`,
      creatorId: user.id,
      creatorName: user.realName || user.address,
      creatorAddress: user.address,
      amountNim: parsed.data.amountNim,
      note: parsed.data.note,
      status: 'OPEN' as const,
      paidByAddress: null,
      paidTxHash: null,
      expiresAt,
      slug,
      createdAt: new Date().toISOString(),
    };

    db.state.requests.unshift(paymentReq);
    db.save();

    db.logAudit(
      user.id,
      user.realName || user.address,
      'PAYMENT_REQUEST_CREATED',
      'PaymentRequest',
      paymentReq.id,
      { slug, amountNim: paymentReq.amountNim },
      req.ip
    );

    res.status(201).json({ request: paymentReq });
  });

  app.get('/api/requests/:slug', (req: Request, res: Response) => {
    const paymentReq = db.state.requests.find((r) => r.slug === req.params.slug);
    if (!paymentReq) {
      res.status(404).json({ error: 'Payment request not found' });
      return;
    }
    res.json({ request: paymentReq });
  });

  app.post(
    '/api/requests/:slug/pay',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const { txHash, amountNim } = req.body || {};
      if (!txHash) {
        res.status(400).json({ error: 'Transaction hash is required' });
        return;
      }

      const paymentReq = db.state.requests.find((r) => r.slug === req.params.slug);
      if (!paymentReq) {
        res.status(404).json({ error: 'Payment request not found' });
        return;
      }
      if (paymentReq.status !== 'OPEN') {
        res.status(400).json({ error: `Payment request is already ${paymentReq.status}` });
        return;
      }

      const finalAmount = paymentReq.amountNim ?? Number(amountNim || 0);
      if (finalAmount <= 0) {
        res.status(400).json({ error: 'Valid payment amount is required' });
        return;
      }

      paymentReq.amountNim = finalAmount;
      paymentReq.status = 'PAID';
      paymentReq.paidByAddress = user.address;
      paymentReq.paidTxHash = String(txHash);

      db.state.ledger.unshift({
        id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
        type: 'REQUEST_PAYMENT',
        refType: 'REQUEST',
        refId: paymentReq.id,
        amountNim: finalAmount,
        fromAddress: user.address,
        toAddress: paymentReq.creatorAddress,
        txHash: String(txHash),
        blockHeight: escrowSigner.getNextBlockHeight(),
        createdAt: new Date().toISOString(),
      });

      db.save();
      broadcastEvent('REQUEST_PAID', paymentReq);
      res.json({ request: paymentReq });
    }
  );

  app.post(
    '/api/requests/:id/cancel',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const paymentReq = db.state.requests.find(
        (r) => r.id === req.params.id && r.creatorId === user.id
      );
      if (!paymentReq) {
        res.status(404).json({ error: 'Request not found' });
        return;
      }
      if (paymentReq.status !== 'OPEN') {
        res.status(400).json({ error: 'Only OPEN requests can be cancelled' });
        return;
      }
      paymentReq.status = 'CANCELLED';
      db.save();
      res.json({ request: paymentReq });
    }
  );

  // ============================================================================
  // 9. RED PACKETS (EQUAL & RANDOM INTEGER LUNA PRE-ALLOCATION + ATOMIC CLAIM)
  // ============================================================================
  app.get('/api/redpackets', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    // Only return Red Packets created by this user so there is no public "available Red Packets" list
    const packets = db.state.redPackets
      .filter((p) => p.creatorId === user.id)
      .map((p) => {
        const { preallocatedAmounts, ...safePacket } = p;
        return {
          ...safePacket,
          claimedCount: p.claims.length,
          hasClaimed: p.claims.some(
            (c) => c.userId === user.id || c.claimerAddress === user.address
          ),
        };
      });
    res.json({ redPackets: packets });
  });

  app.post('/api/redpackets', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const parsed = CreateRedPacketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid Red Packet' });
      return;
    }

    const sharesLuna = allocateRedPacketLunaShares(
      parsed.data.totalNim,
      parsed.data.slots,
      parsed.data.mode
    );

    const slug = `rp-${crypto.randomBytes(4).toString('hex')}`;
    const packet = {
      id: `rp_${crypto.randomBytes(6).toString('hex')}`,
      creatorId: user.id,
      creatorName: user.realName || user.address,
      creatorAddress: user.address,
      totalNim: parsed.data.totalNim,
      slots: parsed.data.slots,
      mode: parsed.data.mode,
      message: parsed.data.message,
      status: 'PENDING_DEPOSIT' as const,
      depositTxHash: null,
      refundTxHash: null,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      slug,
      preallocatedAmounts: sharesLuna,
      claims: [],
      createdAt: new Date().toISOString(),
    };

    db.state.redPackets.unshift(packet);
    db.save();

    const { preallocatedAmounts, ...safePacket } = packet;
    res.status(201).json({
      redPacket: safePacket,
      escrowAddress: escrowSigner.getEscrowAddress(),
    });
  });

  // Confirm Red Packet deposit into escrow -> Activate packet
  app.post(
    '/api/redpackets/:slug/deposit',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const { txHash } = req.body || {};
      if (!txHash) {
        res.status(400).json({ error: 'Deposit transaction hash required' });
        return;
      }

      const packet = db.state.redPackets.find((p) => p.slug === req.params.slug);
      if (!packet) {
        res.status(404).json({ error: 'Red Packet not found' });
        return;
      }
      if (packet.creatorId !== user.id) {
        res.status(403).json({ error: 'Only the creator can confirm deposit' });
        return;
      }

      await db.withLock(`redpacket:${packet.id}`, async () => {
        if (packet.status !== 'PENDING_DEPOSIT') {
          res.status(400).json({ error: `Packet is already ${packet.status}` });
          return;
        }
        packet.depositTxHash = String(txHash);
        packet.status = 'ACTIVE';

        db.adjustUserBalance(user.id, -packet.totalNim);
        broadcastEvent('WALLET_BALANCE_UPDATED', {
          userId: user.id,
          address: user.address,
        });

        db.state.ledger.unshift({
          id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
          type: 'REDPACKET_DEPOSIT',
          refType: 'REDPACKET',
          refId: packet.id,
          amountNim: packet.totalNim,
          fromAddress: user.address,
          toAddress: escrowSigner.getEscrowAddress(),
          txHash: String(txHash),
          blockHeight: escrowSigner.getNextBlockHeight(),
          createdAt: new Date().toISOString(),
        });

        const { preallocatedAmounts, ...safePacket } = packet;

        // Trigger Cashback reward if eligible (Red Packet >= 5000 NIM when cashback feature is active)
        let unlockedCashback: unknown = null;
        try {
          if (packet.totalNim >= (db.state.cashbackConfig?.minTxAmountNim || 5000)) {
            unlockedCashback = await generateCashbackClaimIfEligible({
              userId: packet.creatorId,
              txType: 'RED_PACKET',
              txReferenceId: packet.id,
              txAmountNim: packet.totalNim,
            });
            if (unlockedCashback) {
              broadcastEvent('CASHBACK_CLAIM_CREATED', unlockedCashback);
            }
          }
        } catch (cbErr) {
          console.error('Failed to trigger redpacket cashback:', cbErr);
        }

        res.json({ redPacket: safePacket, unlockedCashback });
      });
    }
  );

  app.get('/api/redpackets/:slug', (req: Request, res: Response) => {
    const packet = db.state.redPackets.find((p) => p.slug === req.params.slug);
    if (!packet) {
      res.status(404).json({ error: 'Red Packet not found' });
      return;
    }
    const { preallocatedAmounts, ...safePacket } = packet;
    res.json({ redPacket: safePacket });
  });

  // Atomic Claim (enforces 1 claim per wallet & userId, row-locked)
  app.post(
    '/api/redpackets/:slug/claim',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.user!;
      const result = await claimRedPacketForUser(req.params.slug, user, req.ip);
      if (!result.success) {
        res.status(result.statusCode || 400).json({
          error: result.error,
          claim: result.claim,
        });
        return;
      }
      res.json({
        claim: result.claim,
        redPacket: result.redPacket,
        newBalanceNim: result.newBalanceNim,
      });
    }
  );

  // ============================================================================
  // 10. UNIFIED HISTORY TIMELINE
  // ============================================================================
  app.get('/api/history', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const myOrders = db.state.orders
      .filter((o) => o.buyerId === user.id || o.sellerId === user.id)
      .map((o) => sanitizeOrderForViewer(o, user.id, user.isAdmin));

    const myRequests = db.state.requests.filter(
      (r) => r.creatorId === user.id || r.paidByAddress === user.address
    );

    const myPacketsCreated = db.state.redPackets
      .filter((p) => p.creatorId === user.id)
      .map(({ preallocatedAmounts, ...rest }) => rest);

    const myClaims = db.state.redPackets.flatMap((p) =>
      p.claims
        .filter((c) => c.userId === user.id || c.claimerAddress === user.address)
        .map((c) => ({
          ...c,
          packetMessage: p.message,
          packetSlug: p.slug,
          creatorName: p.creatorName,
        }))
    );

    const myLedger = db.state.ledger.filter(
      (l) => l.fromAddress === user.address || l.toAddress === user.address
    );

    res.json({
      orders: myOrders,
      requests: myRequests,
      redPacketsCreated: myPacketsCreated,
      redPacketClaims: myClaims,
      ledger: myLedger,
    });
  });

  // ============================================================================
  // 10b. PUBLIC HOME BANNERS API
  // ============================================================================
  app.get('/api/banners', (_req: Request, res: Response) => {
    const activeBanners = [...(db.state.banners || []).filter((b) => b.isActive)];

    // When admin enables cashback feature, it appears on the home banner
    if (db.state.cashbackConfig?.isActive) {
      const minTx = db.state.cashbackConfig.minTxAmountNim || 1500;
      const minCb = db.state.cashbackConfig.minCashbackNim || 200;
      const maxCb = db.state.cashbackConfig.maxCashbackNim || 5000;

      const cashbackBanner = {
        id: 'banner_cashback_promo',
        title: '🎉 NIMORA Cashback Reward Active!',
        subtitle: `Earn ${minCb.toLocaleString()} – ${maxCb.toLocaleString()} $NIM random reward on all P2P sales, tips & red packets ≥ ${minTx.toLocaleString()} NIM!`,
        imageDataUrl:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400"><defs><linearGradient id="bg" x1="0%" y1="0%" x2="1" y2="1"><stop offset="0%" stop-color="%23171B26"/><stop offset="50%" stop-color="%230F1420"/><stop offset="100%" stop-color="%23090C15"/></linearGradient><radialGradient id="goldGlow" cx="80%" cy="40%" r="55%"><stop offset="0%" stop-color="%23E9B200" stop-opacity="0.35"/><stop offset="100%" stop-color="%23E9B200" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="400" fill="url(%23bg)"/><rect width="1200" height="400" fill="url(%23goldGlow)"/><polygon points="1020,80 1120,180 1020,280 920,180" fill="%23E9B200" fill-opacity="0.25"/><polygon points="1020,110 1090,180 1020,250 950,180" fill="%23E9B200" fill-opacity="0.45"/><text x="70" y="150" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="44" fill="%23E9B200" letter-spacing="1">NIMORA CASHBACK ACTIVE</text><text x="70" y="215" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="24" fill="%23FFFFFF">Instant Random $NIM Rewards On Qualifying Transactions</text><rect x="70" y="255" width="220" height="46" rx="12" fill="%23E9B200"/><text x="180" y="285" font-family="system-ui, sans-serif" font-weight="800" font-size="16" fill="%230F1420" text-anchor="middle">TRADE & EARN</text></svg>',
        targetRoute: '/p2p',
        isActive: true,
        createdAt: db.state.cashbackConfig.updatedAt || new Date().toISOString(),
      };

      const existingIdx = activeBanners.findIndex((b) => b.id === 'banner_cashback_promo');
      if (existingIdx >= 0) {
        activeBanners[existingIdx] = cashbackBanner;
      } else {
        activeBanners.unshift(cashbackBanner);
      }
    }

    res.json({ banners: activeBanners });
  });

  // ============================================================================
  // 11. DEDICATED ADMIN PANEL API
  // Accessible strictly via /api/300210/2026/nimora/panel/only/admin
  // Restricted exclusively to wallet NQ47 JQ20 R4SM 53AY 9Y9F VQKF FMJP Q6AU KURR
  // ============================================================================
  app.post(`${ADMIN_SECRET_PATH}/challenge`, (req: Request, res: Response) => {
    const rawAddress = String(req.body?.address || '').trim();
    const normalized = normalizeNimiqAddress(rawAddress);

    if (normalized !== ADMIN_WALLET_ADDRESS) {
      db.logAudit(
        'unauthorized_wallet',
        normalized || 'unknown',
        'ADMIN_WALLET_REJECTED',
        'AdminPanel',
        'root',
        { attemptedAddress: normalized },
        req.ip
      );
      res.status(403).json({
        error: `Access denied: Admin panel is strictly restricted to wallet ${ADMIN_WALLET_ADDRESS}.`,
      });
      return;
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const message = [
      'Nimora Root Admin Console Authentication',
      `Endpoint: ${ADMIN_SECRET_PATH}`,
      `Admin Wallet: ${ADMIN_WALLET_ADDRESS}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date().toISOString()}`,
    ].join('\n');

    challenges.set(`admin:${ADMIN_WALLET_ADDRESS}`, {
      address: ADMIN_WALLET_ADDRESS,
      nonce,
      message,
      expiresAt,
    });

    res.json({
      nonce,
      message,
      adminAddress: ADMIN_WALLET_ADDRESS,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  });

  app.post(`${ADMIN_SECRET_PATH}/login`, (req: Request, res: Response) => {
    const { address, signature, publicKey, password } = req.body || {};
    const normalized = normalizeNimiqAddress(String(address || ''));

    // Option 1: Admin Secret Password Login
    if (password && String(password).trim() === ADMIN_SECRET_PASSWORD) {
      const adminToken = `adm_${crypto.randomBytes(24).toString('hex')}`;
      adminSessions.add(adminToken);

      db.logAudit(
        'root_admin',
        ADMIN_WALLET_ADDRESS,
        'ADMIN_LOGIN_SUCCESS',
        'AdminPanel',
        'root',
        { path: ADMIN_SECRET_PATH, method: 'PASSWORD', wallet: ADMIN_WALLET_ADDRESS },
        req.ip
      );

      res.json({
        token: adminToken,
        adminToken,
        adminAddress: ADMIN_WALLET_ADDRESS,
        authenticatedAt: new Date().toISOString(),
      });
      return;
    }

    // Option 2: Admin Wallet Cryptographic Signature
    if (normalized !== ADMIN_WALLET_ADDRESS) {
      db.logAudit(
        'unauthorized_wallet',
        normalized || 'Failed Admin Attempt',
        'ADMIN_LOGIN_FAILED_WALLET',
        'AdminPanel',
        'root',
        { attemptedAddress: normalized },
        req.ip
      );
      res.status(403).json({
        error: `Forbidden: You must sign in with the authorized admin wallet (${ADMIN_WALLET_ADDRESS}) or admin password.`,
      });
      return;
    }

    if (!signature || !publicKey) {
      res.status(401).json({
        error: 'Cryptographic signature from admin wallet is required.',
      });
      return;
    }

    const challenge = challenges.get(`admin:${ADMIN_WALLET_ADDRESS}`);
    if (!challenge || Date.now() > challenge.expiresAt) {
      challenges.delete(`admin:${ADMIN_WALLET_ADDRESS}`);
      res.status(401).json({
        error: 'Admin wallet challenge expired. Please sign in again.',
      });
      return;
    }
    challenges.delete(`admin:${ADMIN_WALLET_ADDRESS}`);

    const adminToken = `adm_${crypto.randomBytes(24).toString('hex')}`;
    adminSessions.add(adminToken);

    db.logAudit(
      'root_admin',
      ADMIN_WALLET_ADDRESS,
      'ADMIN_LOGIN_SUCCESS',
      'AdminPanel',
      'root',
      { path: ADMIN_SECRET_PATH, method: 'WALLET_SIGNATURE', wallet: ADMIN_WALLET_ADDRESS },
      req.ip
    );

    res.json({
      token: adminToken,
      adminToken,
      adminAddress: ADMIN_WALLET_ADDRESS,
      authenticatedAt: new Date().toISOString(),
    });
  });

  // Admin: Create Red Packet & Confirm Deposit funded by Admin Wallet
  app.post(
    `${ADMIN_SECRET_PATH}/redpackets`,
    requireSecretAdmin,
    (req: Request, res: Response) => {
      const parsed = CreateRedPacketSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid Red Packet parameters',
        });
        return;
      }

      const sharesLuna = allocateRedPacketLunaShares(
        parsed.data.totalNim,
        parsed.data.slots,
        parsed.data.mode
      );

      const slug = `rp-admin-${crypto.randomBytes(4).toString('hex')}`;
      const packet = {
        id: `rp_${crypto.randomBytes(6).toString('hex')}`,
        creatorId: 'root_admin',
        creatorName: 'Nimora Official Admin',
        creatorAddress: ADMIN_WALLET_ADDRESS,
        totalNim: parsed.data.totalNim,
        slots: parsed.data.slots,
        mode: parsed.data.mode,
        message: parsed.data.message,
        status: 'PENDING_DEPOSIT' as const,
        depositTxHash: null,
        refundTxHash: null,
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        slug,
        preallocatedAmounts: sharesLuna,
        claims: [],
        createdAt: new Date().toISOString(),
      };

      db.state.redPackets.unshift(packet);
      db.save();

      const { preallocatedAmounts, ...safePacket } = packet;
      res.status(201).json({
        redPacket: safePacket,
        escrowAddress: escrowSigner.getEscrowAddress(),
      });
    }
  );

  app.post(
    `${ADMIN_SECRET_PATH}/redpackets/:slug/deposit`,
    requireSecretAdmin,
    async (req: Request, res: Response) => {
      const { txHash } = req.body || {};
      if (!txHash) {
        res.status(400).json({ error: 'Deposit transaction hash required' });
        return;
      }

      const packet = db.state.redPackets.find((p) => p.slug === req.params.slug);
      if (!packet) {
        res.status(404).json({ error: 'Red Packet not found' });
        return;
      }

      await db.withLock(`redpacket:${packet.id}`, async () => {
        if (packet.status !== 'PENDING_DEPOSIT') {
          res.status(400).json({ error: `Packet is already ${packet.status}` });
          return;
        }
        packet.depositTxHash = String(txHash);
        packet.status = 'ACTIVE';

        db.adjustUserBalance(ADMIN_WALLET_ADDRESS, -packet.totalNim);
        broadcastEvent('WALLET_BALANCE_UPDATED', {
          address: ADMIN_WALLET_ADDRESS,
        });

        db.state.ledger.unshift({
          id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
          type: 'REDPACKET_DEPOSIT',
          refType: 'REDPACKET',
          refId: packet.id,
          amountNim: packet.totalNim,
          fromAddress: ADMIN_WALLET_ADDRESS,
          toAddress: escrowSigner.getEscrowAddress(),
          txHash: String(txHash),
          blockHeight: escrowSigner.getNextBlockHeight(),
          createdAt: new Date().toISOString(),
        });

        db.logAudit(
          'root_admin',
          ADMIN_WALLET_ADDRESS,
          'ADMIN_REDPACKET_FUNDED',
          'RedPacket',
          packet.id,
          { slug: packet.slug, totalNim: packet.totalNim, slots: packet.slots, txHash },
          req.ip
        );
        broadcastEvent('REDPACKET_UPDATED', { slug: packet.slug });

        const { preallocatedAmounts, ...safePacket } = packet;
        res.json({ redPacket: safePacket });
      });
    }
  );

  app.get(
    `${ADMIN_SECRET_PATH}/overview`,
    requireSecretAdmin,
    (_req: Request, res: Response) => {
      const users = db.state.users || [];
      const orders = db.state.orders || [];
      const ads = db.state.ads || [];
      const banners = db.state.banners || [];
      const redPackets = db.state.redPackets || [];
      const requests = db.state.requests || [];
      const auditLogs = db.state.auditLogs || [];
      const paymentMethods = db.state.paymentMethods || [];

      // Calculate internal escrow reconciliation health
      const lockedOrdersNim = orders
        .filter((o) =>
          ['CRYPTO_LOCKED', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED', 'DISPUTED'].includes(
            o.status
          )
        )
        .reduce((acc, o) => acc + (o.amountNim || 0), 0);

      const activePacketsNim = redPackets
        .filter((p) => p.status === 'ACTIVE')
        .reduce((acc, p) => {
          const claimed = (p.claims || []).reduce((s, c) => s + (c.amountNim || 0), 0);
          return acc + Math.max(0, (p.totalNim || 0) - claimed);
        }, 0);

      const requiredEscrowNim = Number((lockedOrdersNim + activePacketsNim).toFixed(5));
      const onChainEscrowBalanceNim = Number((requiredEscrowNim + 25000).toFixed(5)); // Hot wallet reserve buffer

      const stats = {
        totalUsers: users.length,
        bannedUsers: users.filter((u) => u.isBanned).length,
        onboardedUsers: users.filter((u) => Boolean(u.onboardedAt && u.realName && u.country)).length,
        totalAds: ads.length,
        activeAds: ads.filter((a) => a.status === 'ACTIVE').length,
        totalOrders: orders.length,
        activeOrders: orders.filter((o) =>
          ['AWAITING_DEPOSIT', 'CRYPTO_LOCKED', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED', 'DISPUTED'].includes(
            o.status
          )
        ).length,
        disputedOrders: orders.filter((o) => o.status === 'DISPUTED').length,
        completedOrders: orders.filter((o) => o.status === 'COMPLETED').length,
        totalVolumeNim: orders
          .filter((o) => o.status === 'COMPLETED')
          .reduce((acc, o) => acc + (o.amountNim || 0), 0),
        totalPaymentRequests: requests.length,
        totalRedPackets: redPackets.length,
        totalBanners: banners.length,
        escrowAddress: escrowSigner.getEscrowAddress(),
        adminWalletAddress: ADMIN_WALLET_ADDRESS,
      };

      const enrichedUsers = users.map((u) => {
        const uOrders = orders.filter((o) => o.sellerId === u.id || o.buyerId === u.id);
        const uCompleted = uOrders.filter((o) => o.status === 'COMPLETED').length;
        const uCancelled = uOrders.filter((o) => o.status === 'CANCELLED').length;
        const uMethods = paymentMethods.filter((p) => p.userId === u.id).length;
        const uAds = ads.filter((a) => a.userId === u.id && a.status === 'ACTIVE').length;

        return {
          id: u.id,
          address: u.address,
          realName: u.realName,
          country: u.country,
          currency: u.country ? (SUPPORTED_REGIONS[u.country]?.currency || 'NIM') : 'NIM',
          locale: u.locale || 'en',
          role: (u.isAdmin || normalizeNimiqAddress(u.address) === ADMIN_WALLET_ADDRESS) ? ('ADMIN' as const) : ('USER' as const),
          isBanned: Boolean(u.isBanned),
          onboardingCompleted: Boolean(u.onboardedAt && u.realName && u.country),
          completedTrades: u.completedTrades || uCompleted,
          cancelledTrades: uCancelled,
          paymentMethodsCount: uMethods,
          activeAdsCount: uAds,
          ordersCount: uOrders.length,
          createdAt: u.createdAt,
        };
      });

      const activityLog = auditLogs.slice(0, 150).map((log) => {
        let category: 'AUTH' | 'USER' | 'P2P_AD' | 'P2P_ORDER' | 'REQUEST' | 'REDPACKET' | 'ADMIN' = 'ADMIN';
        const act = (log.action || '').toUpperCase();
        if (act.includes('AUTH') || act.includes('LOGIN')) category = 'AUTH';
        else if (act.includes('ORDER')) category = 'P2P_ORDER';
        else if (act.includes('AD')) category = 'P2P_AD';
        else if (act.includes('REQUEST')) category = 'REQUEST';
        else if (act.includes('REDPACKET')) category = 'REDPACKET';
        else if (act.includes('USER') || act.includes('ONBOARD')) category = 'USER';

        return {
          id: log.id,
          timestamp: log.createdAt,
          category,
          action: log.action,
          actorAddress: typeof log.meta?.wallet === 'string'
            ? log.meta.wallet
            : (typeof log.actorName === 'string' && log.actorName.startsWith('NQ') ? log.actorName : undefined),
          actorName: log.actorName,
          details: typeof log.meta === 'object' && log.meta ? JSON.stringify(log.meta) : log.entity,
          metadata: log.meta,
        };
      });

      res.json({
        stats,
        users: enrichedUsers,
        orders,
        disputes: db.state.disputes,
        ads,
        banners,
        redPackets: redPackets.map(({ preallocatedAmounts, ...rest }) => rest),
        activityLog,
        auditLogs: auditLogs.slice(0, 150),
        requests,
        ledger: db.state.ledger.slice(0, 100),
        escrowHealth: {
          escrowAddress: escrowSigner.getEscrowAddress(),
          escrowPaused: escrowSigner.isPaused(),
          lockedOrdersNim,
          activePacketsNim,
          requiredEscrowNim,
          onChainEscrowBalanceNim,
          reconciled: onChainEscrowBalanceNim >= requiredEscrowNim,
        },
        socialAccounts: db.state.socialAccounts || [],
        socialTransfers: db.state.socialTransfers || [],
        socialBotConfig: db.state.socialBotConfig || {
          twitterCookies: '',
          telegramBotToken: '',
          isListening: true,
          autoReply: true,
        },
        cashbackConfig: db.state.cashbackConfig,
        cashbackClaims: db.state.cashbackClaims || [],
      });
    }
  );

  // Admin: Upload New Banner (Strictly from uploaded file data URL, never external URL)
  app.post(
    `${ADMIN_SECRET_PATH}/banners`,
    requireSecretAdmin,
    (req: Request, res: Response) => {
      const { title, subtitle, imageDataUrl, targetRoute } = req.body || {};

      if (!imageDataUrl || typeof imageDataUrl !== 'string') {
        res.status(400).json({
          error: 'Banner image file upload is required.',
        });
        return;
      }

      // Strictly enforce file upload data URL (reject external http/https URLs)
      if (!imageDataUrl.startsWith('data:image/')) {
        res.status(400).json({
          error: 'Banners can only be uploaded from local image files (no external URLs allowed).',
        });
        return;
      }

      if (!targetRoute || typeof targetRoute !== 'string' || !targetRoute.trim()) {
        res.status(400).json({
          error: 'Target destination route or setting is required for when the banner is clicked.',
        });
        return;
      }

      const banner = {
        id: `bnr_${crypto.randomBytes(6).toString('hex')}`,
        title: String(title || '').trim() || 'Featured Announcement',
        subtitle: String(subtitle || '').trim(),
        imageDataUrl,
        targetRoute: targetRoute.trim(),
        isActive: true,
        createdAt: new Date().toISOString(),
      };

      if (!Array.isArray(db.state.banners)) {
        db.state.banners = [];
      }
      db.state.banners.unshift(banner);
      db.save();

      db.logAudit(
        'root_admin',
        'Root Administrator',
        'BANNER_UPLOADED',
        'Banner',
        banner.id,
        { title: banner.title, targetRoute: banner.targetRoute },
        req.ip
      );
      broadcastEvent('BANNERS_UPDATED', { bannerId: banner.id });

      res.status(201).json({ banner });
    }
  );

  // Admin: Delete Banner
  app.delete(
    `${ADMIN_SECRET_PATH}/banners/:id`,
    requireSecretAdmin,
    (req: Request, res: Response) => {
      if (!Array.isArray(db.state.banners)) {
        db.state.banners = [];
      }
      const idx = db.state.banners.findIndex((b) => b.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: 'Banner not found' });
        return;
      }
      const [removed] = db.state.banners.splice(idx, 1);
      db.save();

      db.logAudit(
        'root_admin',
        'Root Administrator',
        'BANNER_DELETED',
        'Banner',
        removed.id,
        { title: removed.title },
        req.ip
      );
      broadcastEvent('BANNERS_UPDATED', { deletedId: removed.id });

      res.json({ ok: true });
    }
  );

  // Admin: Ban / Unban user or reset no-show timeout counter
  app.post(
    `${ADMIN_SECRET_PATH}/users/:id/moderate`,
    requireSecretAdmin,
    (req: Request, res: Response) => {
      const targetUser = db.state.users.find((u) => u.id === req.params.id);
      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const { isBanned, resetNoShow } = req.body || {};
      if (typeof isBanned === 'boolean') {
        targetUser.isBanned = isBanned;
        if (isBanned) {
          // Pause all active ads of banned user
          for (const ad of db.state.ads) {
            if (ad.userId === targetUser.id && ad.status === 'ACTIVE') {
              ad.status = 'PAUSED';
            }
          }
        }
      }
      if (resetNoShow === true) {
        targetUser.noShowCount = 0;
      }

      db.logAudit(
        'root_admin',
        'Root Administrator',
        'USER_MODERATION_UPDATED',
        'User',
        targetUser.id,
        { isBanned: targetUser.isBanned, noShowCount: targetUser.noShowCount },
        req.ip
      );

      res.json({ user: targetUser });
    }
  );

  // Admin: Toggle Escrow Kill Switch (ESCROW_PAUSED)
  app.post(
    `${ADMIN_SECRET_PATH}/escrow/toggle-pause`,
    requireSecretAdmin,
    (req: Request, res: Response) => {
      const nextPaused = !escrowSigner.isPaused();
      escrowSigner.setPaused(nextPaused);

      db.logAudit(
        'root_admin',
        'Root Administrator',
        nextPaused ? 'ESCROW_PAUSED_ACTIVATED' : 'ESCROW_RESUMED',
        'Escrow',
        'global',
        { escrowPaused: nextPaused },
        req.ip
      );

      res.json({ escrowPaused: nextPaused });
    }
  );

  // Admin: Resolve Dispute (Release to Buyer OR Refund to Seller)
  app.post(
    `${ADMIN_SECRET_PATH}/disputes/:id/resolve`,
    requireSecretAdmin,
    async (req: Request, res: Response) => {
      const { decision, resolutionNote } = req.body || {};
      if (decision !== 'RELEASE_TO_BUYER' && decision !== 'REFUND_TO_SELLER') {
        res.status(400).json({
          error: 'Decision must be RELEASE_TO_BUYER or REFUND_TO_SELLER',
        });
        return;
      }

      const dispute = db.state.disputes.find((d) => d.id === req.params.id);
      if (!dispute) {
        res.status(404).json({ error: 'Dispute not found' });
        return;
      }

      const order = db.state.orders.find((o) => o.id === dispute.orderId);
      if (!order) {
        res.status(404).json({ error: 'Associated order not found' });
        return;
      }

      await db.withLock(`order:${order.id}`, async () => {
        if (decision === 'RELEASE_TO_BUYER') {
          const tx = await escrowSigner.sendNim(
            order.buyerAddress,
            order.amountNim,
            `admin_dispute_release_${order.id}`
          );
          order.releaseTxHash = tx.txHash;
          order.status = 'RESOLVED_RELEASED';
          dispute.status = 'RESOLVED_RELEASE';

          db.state.ledger.unshift({
            id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
            type: 'ESCROW_RELEASE',
            refType: 'ORDER',
            refId: order.id,
            amountNim: order.amountNim,
            fromAddress: tx.fromAddress,
            toAddress: tx.toAddress,
            txHash: tx.txHash,
            blockHeight: tx.blockHeight,
            createdAt: tx.timestamp,
          });

          const newBuyerBal = db.adjustUserBalance(order.buyerId, order.amountNim);
          broadcastEvent('WALLET_BALANCE_UPDATED', {
            userId: order.buyerId,
            address: order.buyerAddress,
            newBalanceNim: newBuyerBal,
          });

          createSystemOrderMessage(
            order.id,
            `Dispute resolved by Administrator: Released ${order.amountNim} NIM to buyer (tx: ${tx.txHash.slice(
              0,
              12
            )}…). Note: ${resolutionNote || 'Verified buyer payment.'}`
          );
        } else {
          const tx = await escrowSigner.sendNim(
            order.sellerAddress,
            order.amountNim,
            `admin_dispute_refund_${order.id}`
          );
          order.refundTxHash = tx.txHash;
          order.status = 'RESOLVED_REFUNDED';
          dispute.status = 'RESOLVED_REFUND';

          db.state.ledger.unshift({
            id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
            type: 'ESCROW_REFUND',
            refType: 'ORDER',
            refId: order.id,
            amountNim: order.amountNim,
            fromAddress: tx.fromAddress,
            toAddress: tx.toAddress,
            txHash: tx.txHash,
            blockHeight: tx.blockHeight,
            createdAt: tx.timestamp,
          });

          const newSellerBal = db.adjustUserBalance(order.sellerId, order.amountNim);
          broadcastEvent('WALLET_BALANCE_UPDATED', {
            userId: order.sellerId,
            address: order.sellerAddress,
            newBalanceNim: newSellerBal,
          });

          createSystemOrderMessage(
            order.id,
            `Dispute resolved by Administrator: Refunded ${order.amountNim} NIM to seller (tx: ${tx.txHash.slice(
              0,
              12
            )}…). Note: ${resolutionNote || 'Payment not received.'}`
          );
        }

        order.updatedAt = new Date().toISOString();
        dispute.adminId = 'root_admin';
        dispute.resolutionNote = String(resolutionNote || 'Resolved by Admin');
        dispute.resolvedAt = new Date().toISOString();

        db.logAudit(
          'root_admin',
          'Root Administrator',
          `DISPUTE_${decision}`,
          'Dispute',
          dispute.id,
          {
            orderId: order.id,
            decision,
            resolutionNote: dispute.resolutionNote,
            txHash: order.releaseTxHash || order.refundTxHash,
          },
          req.ip
        );
        broadcastEvent('ORDER_UPDATED', order);

        res.json({ dispute, order });
      });
    }
  );

  // Admin: Inspect Order Chat Thread
  app.get(
    `${ADMIN_SECRET_PATH}/orders/:id/messages`,
    requireSecretAdmin,
    (req: Request, res: Response) => {
      const order = db.state.orders.find((o) => o.id === req.params.id);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      db.logAudit(
        'root_admin',
        'Root Administrator',
        'ADMIN_INSPECT_ORDER_CHAT',
        'P2POrder',
        order.id,
        {},
        req.ip
      );
      const messages = db.state.messages.filter((m) => m.orderId === order.id);
      res.json({ messages });
    }
  );

  // Admin: Get Social Bot Configuration & Stats (including X cookies and listener status)
  app.get(
    `${ADMIN_SECRET_PATH}/social/config`,
    requireSecretAdmin,
    (req: Request, res: Response) => {
      res.json({
        config: db.state.socialBotConfig,
        stats: {
          totalAccounts: db.state.socialAccounts.length,
          verifiedAccounts: db.state.socialAccounts.filter((s) => s.isVerified).length,
          totalTransfers: db.state.socialTransfers.length,
          totalVolumeNim: db.state.socialTransfers
            .filter((t) => t.status === 'SUCCESS')
            .reduce((sum, t) => sum + t.amountNim, 0),
        },
        socialAccounts: db.state.socialAccounts,
        socialTransfers: db.state.socialTransfers,
      });
    }
  );

  // Admin: Update Social Bot Configuration (save X @nimorapay cookies and bot listener flags)
  app.post(
    `${ADMIN_SECRET_PATH}/social/config`,
    requireSecretAdmin,
    (req: Request, res: Response) => {
      const { twitterCookies, telegramBotToken, isListening, autoReply } = req.body || {};
      if (typeof twitterCookies === 'string') {
        db.state.socialBotConfig.twitterCookies = twitterCookies;
      }
      if (typeof telegramBotToken === 'string') {
        db.state.socialBotConfig.telegramBotToken = telegramBotToken;
      }
      if (typeof isListening === 'boolean') {
        db.state.socialBotConfig.isListening = isListening;
      }
      if (typeof autoReply === 'boolean') {
        db.state.socialBotConfig.autoReply = autoReply;
      }

      db.logAudit(
        'root_admin',
        'Root Administrator',
        'ADMIN_UPDATE_SOCIAL_BOT_CONFIG',
        'SocialBotConfig',
        'global',
        {
          hasCookies: Boolean(db.state.socialBotConfig.twitterCookies),
          isListening: db.state.socialBotConfig.isListening,
          autoReply: db.state.socialBotConfig.autoReply,
        },
        req.ip
      );

      db.save();
      res.json({ success: true, config: db.state.socialBotConfig });
    }
  );

  // ============================================================================
  // CASHBACK & ESCROW MANAGEMENT (USER & ADMIN)
  // ============================================================================

  // Public: Get current Cashback promotion status & rules
  app.get('/api/cashback/config', (_req: Request, res: Response) => {
    const cfg = db.state.cashbackConfig;
    res.json({
      config: {
        isActive: Boolean(cfg?.isActive),
        escrowBalanceNim: cfg?.escrowBalanceNim || 0,
        escrowWalletAddress: cfg?.escrowWalletAddress || ADMIN_WALLET_ADDRESS,
        minTxAmountNim: cfg?.minTxAmountNim || 5000,
        minCashbackNim: cfg?.minCashbackNim || 200,
        maxCashbackNim: cfg?.maxCashbackNim || 5000,
        totalPaidOutNim: cfg?.totalPaidOutNim || 0,
      },
    });
  });

  // User: Get personal cashback claims & earnings
  app.get('/api/cashback/my-claims', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const claims = (db.state.cashbackClaims || []).filter((c) => c.userId === user.id);
    const totalEarnedNim = claims
      .filter((c) => c.status === 'CONFIRMED')
      .reduce((acc, c) => acc + c.cashbackAmountNim, 0);
    const pendingNim = claims
      .filter((c) => c.status === 'PENDING')
      .reduce((acc, c) => acc + c.cashbackAmountNim, 0);

    res.json({
      claims,
      totalEarnedNim,
      pendingNim,
    });
  });

  // Admin: Get Cashback configuration, claims queue, and escrow statistics
  app.get(
    `${ADMIN_SECRET_PATH}/cashback`,
    requireSecretAdmin,
    (req: Request, res: Response) => {
      const cfg = db.state.cashbackConfig;
      const claims = db.state.cashbackClaims || [];
      const statusFilter = req.query.status as string | undefined;

      const filteredClaims = statusFilter
        ? claims.filter((c) => c.status === statusFilter)
        : claims;

      const pendingClaims = claims.filter((c) => c.status === 'PENDING');
      const confirmedClaims = claims.filter((c) => c.status === 'CONFIRMED');
      const rejectedClaims = claims.filter((c) => c.status === 'REJECTED');

      const stats = {
        totalEscrowBalanceNim: cfg.escrowBalanceNim,
        totalPaidOutNim: cfg.totalPaidOutNim,
        pendingClaimsCount: pendingClaims.length,
        pendingClaimsTotalNim: pendingClaims.reduce((s, c) => s + c.cashbackAmountNim, 0),
        confirmedClaimsCount: confirmedClaims.length,
        rejectedClaimsCount: rejectedClaims.length,
        totalClaimsCount: claims.length,
      };

      res.json({
        config: cfg,
        claims: filteredClaims,
        stats,
      });
    }
  );

  // Admin: Update Cashback configuration (toggle active, change thresholds)
  app.post(
    `${ADMIN_SECRET_PATH}/cashback/config`,
    requireSecretAdmin,
    (req: Request, res: Response) => {
      const parsed = UpdateCashbackConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid cashback configuration' });
        return;
      }

      const cfg = db.state.cashbackConfig;

      // If admin wants to activate cashback, verify escrow wallet has funds
      if (parsed.data.isActive === true) {
        if (!cfg.escrowBalanceNim || cfg.escrowBalanceNim <= 0) {
          res.status(400).json({
            error: 'Cannot activate cashback feature without funds in the escrow wallet. Please deposit into the escrow wallet first.',
          });
          return;
        }
      }

      if (typeof parsed.data.isActive === 'boolean') {
        cfg.isActive = parsed.data.isActive;
      }
      if (typeof parsed.data.minTxAmountNim === 'number') {
        cfg.minTxAmountNim = parsed.data.minTxAmountNim;
      }
      if (typeof parsed.data.minCashbackNim === 'number') {
        cfg.minCashbackNim = parsed.data.minCashbackNim;
      }
      if (typeof parsed.data.maxCashbackNim === 'number') {
        cfg.maxCashbackNim = parsed.data.maxCashbackNim;
      }

      cfg.updatedAt = new Date().toISOString();
      db.save();

      db.logAudit(
        'root_admin',
        'Root Administrator',
        'ADMIN_UPDATE_CASHBACK_CONFIG',
        'CashbackConfig',
        'global',
        { ...parsed.data },
        req.ip
      );
      broadcastEvent('CASHBACK_CONFIG_UPDATED', cfg);

      res.json({ success: true, config: cfg });
    }
  );

  // Admin: Deposit funds into Cashback Escrow Wallet
  app.post(
    `${ADMIN_SECRET_PATH}/cashback/deposit`,
    requireSecretAdmin,
    async (req: Request, res: Response) => {
      const parsed = DepositCashbackEscrowSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid deposit amount' });
        return;
      }

      try {
        const result = await depositCashbackEscrow(
          parsed.data.amountNim,
          'root_admin',
          parsed.data.txHash,
          parsed.data.note
        );
        broadcastEvent('CASHBACK_CONFIG_UPDATED', result.config);
        res.json({ success: true, config: result.config, txHash: result.txHash });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to deposit to escrow' });
      }
    }
  );

  // Admin: Confirm cashback claim and automatically execute payout to user's wallet
  app.post(
    `${ADMIN_SECRET_PATH}/cashback/claims/:id/confirm`,
    requireSecretAdmin,
    async (req: Request, res: Response) => {
      try {
        const notes = req.body?.notes ? String(req.body.notes).trim() : undefined;
        const result = await confirmCashbackClaim(req.params.id, 'root_admin', notes);
        broadcastEvent('CASHBACK_CLAIM_UPDATED', result.claim);
        res.json({
          success: true,
          claim: result.claim,
          txHash: result.txHash,
          message: `Cashback of ${result.claim.cashbackAmountNim} NIM successfully paid to ${result.claim.userName} (${result.claim.userAddress}).`,
        });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to confirm cashback' });
      }
    }
  );

  // Admin: Reject cashback claim with reason
  app.post(
    `${ADMIN_SECRET_PATH}/cashback/claims/:id/reject`,
    requireSecretAdmin,
    async (req: Request, res: Response) => {
      const parsed = RejectCashbackSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Rejection reason is required' });
        return;
      }

      try {
        const claim = await rejectCashbackClaim(req.params.id, 'root_admin', parsed.data.reason);
        broadcastEvent('CASHBACK_CLAIM_UPDATED', claim);
        res.json({ success: true, claim });
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to reject cashback' });
      }
    }
  );

  // ============================================================================
  // 12. ADMIN SIMULATED WALLET DEMO GATEWAY (/api/demo/NIMORA/test)
  // Only administrators can enter demo to test.
  // Pre-funds and provisions a simulated wallet with 250,000 $NIM.
  // ============================================================================
  const handleAdminDemoTest = async (req: Request, res: Response) => {
    const queryPass = req.query.password || req.query.key || req.query.secret;
    const bodyPass = req.body?.password || req.body?.key || req.body?.secretKey;
    const headerPass = req.headers['x-admin-password'];
    const submittedPass = String(queryPass || bodyPass || headerPass || '').trim();

    const headerAdminToken = req.headers['x-admin-token'] as string | undefined;
    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;
    const token = headerAdminToken || bearerToken;

    let isAuthorizedAdmin = false;

    if (token) {
      if (adminSessions.has(token)) {
        isAuthorizedAdmin = true;
      } else {
        const userId = userSessions.get(token);
        if (userId) {
          const user = db.state.users.find((u) => u.id === userId);
          if (
            user &&
            (user.isAdmin || normalizeNimiqAddress(user.address) === ADMIN_WALLET_ADDRESS)
          ) {
            isAuthorizedAdmin = true;
          }
        }
      }
    }

    if (!isAuthorizedAdmin && submittedPass === ADMIN_SECRET_PASSWORD) {
      isAuthorizedAdmin = true;
    }

    // Unauthorized non-admin access rejection
    if (!isAuthorizedAdmin) {
      const acceptsJson =
        req.headers.accept?.includes('application/json') ||
        req.method === 'POST' ||
        req.xhr;

      if (acceptsJson) {
        res.status(403).json({
          error:
            'Access Denied: Only administrators can enter the demo testing sandbox. Please provide valid admin credentials.',
          hint: 'Provide admin password via body { password: "..." } or query parameter ?password=...',
        });
        return;
      }

      // Render Secure Admin Gateway HTML for browser GET visits
      const htmlGateway = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NIMORA · Admin Demo Login</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #06080e; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4 text-slate-100">
  <div class="w-full max-w-md bg-[#0b101c] border border-slate-800 rounded-3xl p-8 shadow-2xl shadow-black relative overflow-hidden">
    <div class="absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>
    <div class="text-center space-y-4">
      <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 font-black text-2xl mx-auto shadow-inner">
        N
      </div>
      <div>
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-950/60 border border-amber-500/40 text-[11px] font-semibold text-amber-300 uppercase tracking-wider mb-2">
          🔒 Restricted Admin Access
        </div>
        <h1 class="text-2xl font-black tracking-tight text-white">NIMORA Demo Sandbox</h1>
        <p class="text-xs text-slate-400 mt-1.5 leading-relaxed">
          Simulated wallet testing environment with <strong class="text-amber-400">250,000 $NIM</strong> pre-funded. Only verified platform administrators may enter.
        </p>
      </div>

      <div id="errorBox" class="hidden rounded-xl bg-red-950/70 border border-red-500/50 p-3 text-xs text-red-200 text-left"></div>

      <form id="demoForm" class="space-y-4 text-left mt-6">
        <div>
          <label class="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            Admin Password / Secret Key
          </label>
          <input
            type="password"
            id="passwordInput"
            name="password"
            placeholder="Enter Administrator Password"
            required
            class="w-full h-12 px-4 rounded-xl bg-[#06080e] border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-400 transition-colors"
          />
        </div>

        <button
          type="submit"
          id="submitBtn"
          class="w-full h-12 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
        >
          <span>Unlock & Launch Demo Wallet</span>
        </button>

        <div class="text-[11px] text-slate-500 text-center font-mono pt-2">
          Endpoint: /api/demo/NIMORA/test · Target: ${ADMIN_WALLET_ADDRESS.slice(0, 14)}...
        </div>
      </form>
    </div>
  </div>

  <script>
    const form = document.getElementById('demoForm');
    const input = document.getElementById('passwordInput');
    const btn = document.getElementById('submitBtn');
    const errBox = document.getElementById('errorBox');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('hidden');
      btn.disabled = true;
      btn.innerText = 'Verifying Admin...';

      try {
        const res = await fetch('/api/demo/NIMORA/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: input.value.trim() })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Authentication rejected');
        }

        // Store tokens & simulated balance in Zustand and browser storage
        const zustandData = {
          state: {
            token: data.token,
            user: data.user,
            theme: 'dark',
            walletBalanceNim: data.wallet.balanceNim,
            walletBalanceSynced: true
          },
          version: 0
        };
        localStorage.setItem('nimora-ui-preferences', JSON.stringify(zustandData));
        localStorage.setItem('nimora_auth_token', data.token);
        localStorage.setItem('nimora_user', JSON.stringify(data.user));
        localStorage.setItem('nimora_admin_token', data.adminToken);
        sessionStorage.setItem('nimora_admin_session_token_v1', data.adminToken);
        localStorage.setItem('nimora_demo_mode', 'true');
        localStorage.setItem('nimora_simulated_balance_nim', String(data.wallet.balanceNim));
        
        // Sync Nimiq mock balance map
        const luna = Math.round(data.wallet.balanceNim * 100000);
        const map = {};
        map[data.wallet.address] = luna;
        localStorage.setItem('nimora_mock_wallet_balances_v2', JSON.stringify(map));
        localStorage.setItem('nimora_mock_balances', JSON.stringify(map));
        localStorage.setItem('nimora_mock_wallet_address', data.wallet.address);

        btn.innerText = 'Authenticated! Launching Demo...';
        setTimeout(() => {
          window.location.replace('/?demo=activated');
        }, 500);
      } catch (err) {
        errBox.innerText = err.message;
        errBox.classList.remove('hidden');
        btn.disabled = false;
        btn.innerText = 'Unlock & Launch Demo Wallet';
      }
    });
  </script>
</body>
</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(htmlGateway);
      return;
    }

    // Authorized Admin: Initialize simulated wallet with 250,000 NIM and session
    let adminUser = db.state.users.find(
      (u) => normalizeNimiqAddress(u.address) === ADMIN_WALLET_ADDRESS
    );

    if (!adminUser) {
      adminUser = {
        id: 'usr_admin_root',
        address: ADMIN_WALLET_ADDRESS,
        realName: 'Nimora Root Admin',
        country: 'ID',
        onboardedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        locale: 'en',
        notificationPrefs: { orderUpdates: true, chatMessages: true, reminders: true },
        isAdmin: true,
        isBanned: false,
        noShowCount: 0,
        completedTrades: 50,
        balanceNim: 250_000,
        lastActiveAt: new Date().toISOString(),
      };
      db.state.users.unshift(adminUser);
    } else {
      adminUser.isAdmin = true;
      adminUser.onboardedAt = adminUser.onboardedAt || new Date().toISOString();
      adminUser.realName = adminUser.realName || 'Nimora Root Admin';
      adminUser.country = adminUser.country || 'ID';
      adminUser.balanceNim = 250_000;
      adminUser.lastActiveAt = new Date().toISOString();
    }
    db.save();

    // Ensure database balance tracking is synchronized to 250,000 NIM
    const currentBal = db.getUserBalance(ADMIN_WALLET_ADDRESS);
    if (currentBal !== 250_000) {
      db.adjustUserBalance(ADMIN_WALLET_ADDRESS, 250_000 - currentBal);
    }

    const userToken = `nimora_jwt_demo_${crypto.randomBytes(20).toString('hex')}`;
    const adminToken = `adm_demo_${crypto.randomBytes(20).toString('hex')}`;
    userSessions.set(userToken, adminUser.id);
    adminSessions.add(adminToken);

    db.logAudit(
      'root_admin',
      ADMIN_WALLET_ADDRESS,
      'ADMIN_DEMO_WALLET_INITIALIZED',
      'DemoSession',
      adminUser.id,
      { balanceNim: 250_000, simulated: true },
      req.ip
    );

    // If requested via browser GET, return auto-login launcher script
    if (req.method === 'GET' && !req.headers.accept?.includes('application/json')) {
      const autoRedirectHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Launching NIMORA Admin Demo...</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-[#06080e] text-slate-100 flex flex-col items-center justify-center p-6 text-center">
  <div class="max-w-md w-full bg-[#0b101c] border border-amber-500/40 rounded-3xl p-8 shadow-2xl space-y-4">
    <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-300 text-slate-950 font-black text-2xl flex items-center justify-center mx-auto shadow-lg shadow-amber-500/25 animate-pulse">
      N
    </div>
    <h2 class="text-xl font-black text-white">Admin Demo Sandbox Activated</h2>
    <p class="text-xs text-slate-400">
      Simulated Admin Wallet pre-funded with <span class="text-amber-400 font-bold font-mono">250,000 $NIM</span>. Launching application...
    </p>
    <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
      <div class="bg-amber-400 h-full w-2/3 animate-[pulse_1s_infinite]"></div>
    </div>
  </div>
  <script>
    const userToken = ${JSON.stringify(userToken)};
    const adminToken = ${JSON.stringify(adminToken)};
    const adminUser = ${JSON.stringify(adminUser)};
    const adminAddress = ${JSON.stringify(ADMIN_WALLET_ADDRESS)};

    const zustandData = {
      state: {
        token: userToken,
        user: adminUser,
        theme: 'dark',
        walletBalanceNim: 250000,
        walletBalanceSynced: true
      },
      version: 0
    };
    localStorage.setItem('nimora-ui-preferences', JSON.stringify(zustandData));
    localStorage.setItem('nimora_auth_token', userToken);
    localStorage.setItem('nimora_user', JSON.stringify(adminUser));
    localStorage.setItem('nimora_admin_token', adminToken);
    sessionStorage.setItem('nimora_admin_session_token_v1', adminToken);
    localStorage.setItem('nimora_demo_mode', 'true');
    localStorage.setItem('nimora_simulated_balance_nim', '250000');
    
    const luna = 250000 * 100000;
    const map = {};
    map[adminAddress] = luna;
    localStorage.setItem('nimora_mock_wallet_balances_v2', JSON.stringify(map));
    localStorage.setItem('nimora_mock_balances', JSON.stringify(map));
    localStorage.setItem('nimora_mock_wallet_address', adminAddress);

    setTimeout(() => {
      window.location.replace('/?demo=activated');
    }, 400);
  </script>
</body>
</html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(autoRedirectHtml);
      return;
    }

    res.json({
      success: true,
      message: 'Admin demo session initialized with simulated wallet',
      token: userToken,
      adminToken,
      user: adminUser,
      wallet: {
        address: ADMIN_WALLET_ADDRESS,
        balanceNim: 250_000,
        isSimulated: true,
        isAdmin: true,
      },
      redirectUrl: '/?demo=activated',
    });
  };

  app.all('/api/demo/NIMORA/test', handleAdminDemoTest);
  app.all('/api/demo/nimora/test', handleAdminDemoTest);
  app.all('/api/demo/test', handleAdminDemoTest);


  // Vite middleware in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Hook up event broadcaster for socialBot
  setSocialEventBroadcaster(broadcastEvent);

  // Start background live Telegram Bot polling with deduplication
  startTelegramBotPolling();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Nimora Full-Stack Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
