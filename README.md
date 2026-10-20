# Nimora — Nimiq Pay Mini App (Full Stack)

Nimora is a mobile-first Nimiq Pay Mini App combining three core pillars:
1. **Local P2P Trading**: Buy or sell NIM for local fiat currency, matched strictly within the same country and protected by a platform escrow wallet with a 30-minute auto-cancel timer.
2. **Request NIM**: Create a direct wallet-to-wallet payment request shared as a versioned QR code (`nimora://request?id=<slug>&v=1`) and HTTPS link.
3. **Red Packet**: Send NIM to 2–200 people using an Equal or Lucky Random split (pre-allocated in integer luna using the Double-Mean algorithm), claimed via QR or link.

---

## 1. Setup & Running Locally

### Prerequisites
- Node.js 20+
- Optional Nimiq Pay mobile app or browser sandbox (`VITE_MOCK_SDK=true` enabled by default for browser preview)

### Environment Variables (`.env`)
Copy `.env.example` to `.env`:
```env
GEMINI_API_KEY="MY_GEMINI_API_KEY"
APP_URL="http://localhost:3000"
NIMIQ_ESCROW_ADDRESS="NQ07 NIM0 RAES CR0W WA11 ET00 0000 0000 2026"
NIMIQ_ESCROW_PRIVATE_KEY="0000000000000000000000000000000000000000000000000000000000000000"
ORDER_ACTION_TIMEOUT_MINUTES="30"
ESCROW_PAUSED="false"
VITE_MOCK_SDK="true"
```

### Start Development Server
```bash
npm install
npm run dev
```
The full-stack Express + WebSocket + Vite server runs on `http://0.0.0.0:3000`.

---

## 2. Restricted Admin Panel

The platform includes a dedicated, isolated administrator console for user management, real-time WebSocket activity monitoring, escrow reconciliation, kill-switch control, and dispute resolution:
- **URL Path**: `/api/300210/2026/nimora/panel/only/admin`
- **Password**: `@Raffathoriq010228`

---

## 3. OpenAPI-Style API Surface

- `POST /api/auth/challenge` & `POST /api/auth/verify` & `POST /api/auth/logout`
- `GET /api/regions` & `GET /api/regions/:country/payment-methods`
- `POST /api/users/onboard` (accepted once; returns `409 Conflict` if called again)
- `GET /api/users/me` & `PATCH /api/users/me/settings` (updates locale/notifications; rejects `realName` or `country` mutations with `403`)
- `GET|POST|DELETE /api/payment-methods` (validates provider belongs to user's country catalog and holder name matches Real Name)
- `GET|POST|PATCH /api/p2p/ads` & `POST /api/p2p/fast-match`
- `GET|POST /api/p2p/orders`, `GET /api/p2p/orders/:id`, `POST /api/p2p/orders/:id/deposit`, `POST /api/p2p/orders/:id/proof`, `POST /api/p2p/orders/:id/confirm`, `POST /api/p2p/orders/:id/cancel`, `POST /api/p2p/orders/:id/dispute`
- `GET|POST /api/p2p/orders/:id/messages`, `POST /api/p2p/orders/:id/messages/read`, `POST /api/p2p/orders/:id/remind`, `POST /api/p2p/messages/:id/report`, plus WebSocket `/ws`
- `GET|POST /api/requests`, `GET /api/requests/:slug`, `POST /api/requests/:slug/pay`, `POST /api/requests/:id/cancel`
- `GET|POST /api/redpackets`, `GET /api/redpackets/:slug`, `POST /api/redpackets/:slug/deposit`, `POST /api/redpackets/:slug/claim`
- `GET /api/history`

---

## 4. Security & Threat Model

| Threat Vector | Mitigation Implemented |
|---|---|
| **Custodial & Key Exposure Risk** | Escrow private key is isolated inside `src/server/escrowSigner.ts` on the backend. Never logged or exposed to the frontend bundle. Includes an emergency `ESCROW_PAUSED` kill switch. |
| **Replay Attacks on Auth** | Single-use cryptographic nonces with a 5-minute TTL bound to the app domain, wallet address, and timestamp. |
| **Timeout & Deposit Race Conditions** | All state transitions and 30-minute timeout worker checks acquire per-order mutex locks (`db.withLock('order:<id>')`) and re-verify state immediately prior to mutation. |
| **Silent Seller After Fiat Payment** | Once the buyer uploads payment proof (`PAYMENT_SUBMITTED`), the 30-minute timer **never** auto-cancels or refunds the seller; instead, it automatically escalates the order to `DISPUTED` and freezes the escrowed NIM for admin review. |
| **Fake Screenshots & Third-Party Fraud** | Account holder name on every bank/e-wallet must match the user's immutable Real Name. Messages are append-only evidence and chat can never trigger an escrow payout. |
| **Red Packet Over-Allocation Race** | Shares are pre-allocated in integer luna at creation and claimed inside a per-packet mutex lock with unique constraints on `(packetId, claimerAddress)` and `(packetId, userId)`. |
