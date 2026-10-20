import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ShieldAlert,
  Lock,
  Upload,
  CheckCircle2,
  Bell,
  Send,
  Image as ImageIcon,
  Flag,
  ArrowLeft,
  AlertTriangle,
  Copy,
  Check,
} from 'lucide-react';
import { useAppStore, apiFetch } from '../store/useAppStore.ts';
import { sendNim } from '../lib/nimiq/sdk.ts';
import { formatNim, formatFiat, shortenAddress } from '../lib/nimiq/units.ts';
import {
  CountdownTimer,
  SendConfirmationSheet,
  safeCopyToClipboard,
} from '../components/ui/CoreComponents.tsx';
import { P2POrderStatus, SUPPORTED_REGIONS } from '../../packages/shared/index.ts';

interface OrderDetail {
  id: string;
  adId: string;
  sellerId: string;
  sellerName: string;
  sellerAddress: string;
  buyerId: string;
  buyerName: string;
  buyerAddress: string;
  country: string;
  amountNim: number;
  fiatAmount: number;
  fiatCurrency: string;
  priceSnapshot: number;
  paymentMethodSnapshot: {
    id: string;
    providerCode: string;
    providerName: string;
    type: 'BANK' | 'EWALLET';
    accountName: string;
    accountNumberFull: string;
    accountNumberMasked: string;
  };
  status: P2POrderStatus;
  cancelReason: string | null;
  escrowAddress: string;
  depositTxHash: string | null;
  releaseTxHash: string | null;
  refundTxHash: string | null;
  depositDeadline: string;
  paymentDeadline: string | null;
  confirmDeadline: string | null;
  paymentProofUrl: string | null;
  reminderCount: number;
  lastReminderAt: string | null;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  orderId: string;
  senderId: string | null;
  senderName: string;
  type: 'TEXT' | 'IMAGE' | 'SYSTEM' | 'PAYMENT_REMINDER';
  body: string;
  attachmentUrl?: string;
  readAt: string | null;
  reported: boolean;
  createdAt: string;
}

const BUYER_QUICK_CHIPS = [
  'I have paid',
  'Please check your account',
  'Sending proof now',
];

const SELLER_QUICK_CHIPS = [
  'Please pay now',
  'I have not received it yet',
  'Received, releasing',
];

export const P2POrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, deductSimulatedBalance, creditSimulatedBalance, syncWalletBalance } = useAppStore();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedAccount, setCopiedAccount] = useState(false);

  // Confirm Send Sheet for Seller Escrow Deposit
  const [showEscrowSheet, setShowEscrowSheet] = useState(false);

  // Dispute Modal
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeNotes, setDisputeNotes] = useState('');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);
  const chatImageInputRef = useRef<HTMLInputElement>(null);

  const locale = user?.locale || 'en';

  const fetchOrderAndChat = async () => {
    if (!id) return;
    try {
      const [ordRes, msgRes] = await Promise.all([
        apiFetch<{ order: OrderDetail }>(`/api/p2p/orders/${id}`),
        apiFetch<{ messages: ChatMessage[] }>(`/api/p2p/orders/${id}/messages`),
      ]);
      setOrder(ordRes.order);
      setMessages(msgRes.messages);
      setLoading(false);

      // Mark unread messages as read
      apiFetch(`/api/p2p/orders/${id}/messages/read`, { method: 'POST' }).catch(
        () => {}
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load order');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrderAndChat();
    const poll = setInterval(fetchOrderAndChat, 4000);

    // Connect WebSocket for instant real-time updates
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (
          (data.event === 'ORDER_UPDATED' && data.payload?.id === id) ||
          (data.event === 'ORDER_MESSAGE' && data.payload?.orderId === id)
        ) {
          fetchOrderAndChat();
          syncWalletBalance();
        }
      } catch {
        // Ignore parse error
      }
    };

    return () => {
      clearInterval(poll);
      ws.close();
    };
  }, [id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-40 rounded-2xl bg-navy-900 border border-slate-800 animate-pulse" />
        <div className="h-80 rounded-2xl bg-navy-900 border border-slate-800 animate-pulse" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 text-center">
        <p className="text-sm text-red-300">{error || 'Order not found'}</p>
      </div>
    );
  }

  const isSeller = user?.id === order.sellerId;
  const isBuyer = user?.id === order.buyerId;
  const counterpartyName = isSeller ? order.buyerName : order.sellerName;
  const regionFlag = SUPPORTED_REGIONS[order.country]?.flag || '🌐';

  const isReadOnlyChat = [
    'COMPLETED',
    'CANCELLED',
    'EXPIRED',
    'RESOLVED_RELEASED',
    'RESOLVED_REFUNDED',
  ].includes(order.status);

  const activeDeadline =
    order.status === 'AWAITING_DEPOSIT'
      ? order.depositDeadline
      : order.status === 'PAYMENT_SUBMITTED'
      ? order.confirmDeadline
      : order.paymentDeadline;

  // Off-platform scam detector warning (links, phone numbers, "send to another address")
  const hasOffPlatformWarning =
    /(https?:\/\/|t\.me|wa\.me|whatsapp|telegram|\b\d{9,14}\b|another address)/i.test(
      chatText
    );

  // Seller: Lock NIM into escrow via Nimiq SDK
  const handleSellerLockEscrow = async () => {
    setActionBusy(true);
    setError(null);
    try {
      const tx = await sendNim({
        recipient: order.escrowAddress,
        amountNim: order.amountNim,
        data: `order:${order.id}`,
      });
      deductSimulatedBalance(order.amountNim);

      await apiFetch(`/api/p2p/orders/${order.id}/deposit`, {
        method: 'POST',
        body: JSON.stringify({ txHash: tx.txHash }),
      });
      setShowEscrowSheet(false);
      await fetchOrderAndChat();
      await syncWalletBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Escrow deposit failed');
    } finally {
      setActionBusy(false);
    }
  };

  // Buyer: Upload payment screenshot
  const handleProofFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Only JPG, PNG, and WEBP images are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Screenshot must be under 5 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      setActionBusy(true);
      setError(null);
      try {
        await apiFetch(`/api/p2p/orders/${order.id}/proof`, {
          method: 'POST',
          body: JSON.stringify({
            proofDataUrl: String(reader.result),
            mimeType: file.type,
          }),
        });
        await fetchOrderAndChat();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Proof upload failed');
      } finally {
        setActionBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Seller: Confirm Fiat Received & Release NIM
  const handleSellerConfirmRelease = async () => {
    setActionBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/p2p/orders/${order.id}/confirm`, {
        method: 'POST',
      });
      await fetchOrderAndChat();
      await syncWalletBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Release failed');
    } finally {
      setActionBusy(false);
    }
  };

  // Manual Cancel
  const handleCancelOrder = async () => {
    setActionBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/p2p/orders/${order.id}/cancel`, {
        method: 'POST',
      });
      await fetchOrderAndChat();
      await syncWalletBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setActionBusy(false);
    }
  };

  // Send Chat Message
  const handleSendMessage = async (textOverride?: string) => {
    const bodyToSend = (textOverride ?? chatText).trim();
    if (!bodyToSend) return;
    try {
      if (!textOverride) setChatText('');
      await apiFetch(`/api/p2p/orders/${order.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'TEXT',
          body: bodyToSend,
        }),
      });
      await fetchOrderAndChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    }
  };

  // Send Image in Chat
  const handleChatImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await apiFetch(`/api/p2p/orders/${order.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'IMAGE',
            body: 'Attached payment screenshot',
            attachmentUrl: String(reader.result),
            attachmentMime: file.type,
          }),
        });
        await fetchOrderAndChat();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Image upload failed');
      }
    };
    reader.readAsDataURL(file);
  };

  // Send Rate-Limited Payment Reminder
  const handleSendReminder = async () => {
    setError(null);
    try {
      await apiFetch(`/api/p2p/orders/${order.id}/remind`, {
        method: 'POST',
      });
      await fetchOrderAndChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reminder rate-limited');
    }
  };

  // Open Dispute
  const handleOpenDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    try {
      await apiFetch(`/api/p2p/orders/${order.id}/dispute`, {
        method: 'POST',
        body: JSON.stringify({
          reason: disputeReason,
          notes: disputeNotes,
        }),
      });
      setDisputeModalOpen(false);
      await fetchOrderAndChat();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open dispute');
    } finally {
      setActionBusy(false);
    }
  };

  const canRemind =
    (isSeller &&
      (order.status === 'AWAITING_PAYMENT' || order.status === 'CRYPTO_LOCKED')) ||
    (isBuyer &&
      (order.status === 'PAYMENT_SUBMITTED' || order.status === 'AWAITING_DEPOSIT'));

  return (
    <div className="space-y-5">
      {/* Top Bar Back & Order Status */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate('/p2p?tab=orders')}
          className="min-h-[40px] px-3 rounded-xl bg-navy-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Orders</span>
        </button>
        <div className="text-xs font-mono text-slate-400">
          Order #{order.id} · {regionFlag} {order.country}
        </div>
      </div>

      {/* Persistent Safety Banner (Section 10.6) */}
      <div className="rounded-2xl bg-amber-950/40 border border-amber-500/40 p-3.5 flex items-start gap-2.5 text-xs text-amber-200">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <span>{t('p2p.safetyBanner')}</span>
      </div>

      {error && (
        <div className="rounded-xl bg-red-950/60 border border-red-500/40 p-3.5 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Order Summary, 30-Min Timer, Payment Details, and Escrow Actions */}
        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-2xl bg-navy-900 border border-slate-800 p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-gold-400">
                  {isBuyer ? 'YOU ARE BUYING NIM' : 'YOU ARE SELLING NIM'}
                </div>
                <div className="text-2xl font-extrabold text-white font-mono tabular-nums mt-1">
                  {formatNim(order.amountNim, locale)}
                </div>
                <div className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                  Unit Price: {formatFiat(order.priceSnapshot, order.fiatCurrency, locale)}
                </div>
              </div>

              <div className="text-end">
                <div className="text-xs text-slate-400">Fiat Settlement</div>
                <div className="text-xl font-bold text-emerald-400 font-mono tabular-nums mt-1">
                  {formatFiat(order.fiatAmount, order.fiatCurrency, locale)}
                </div>
                <div className="text-xs font-mono font-semibold text-white mt-1">
                  {order.status}
                </div>
              </div>
            </div>

            {/* Live 30-Minute Auto-Cancel Countdown */}
            {activeDeadline &&
              ['AWAITING_DEPOSIT', 'CRYPTO_LOCKED', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED'].includes(
                order.status
              ) && (
                <CountdownTimer
                  deadlineIso={activeDeadline}
                  label={
                    order.status === 'AWAITING_DEPOSIT'
                      ? 'Seller Escrow Lock Window (30m)'
                      : order.status === 'PAYMENT_SUBMITTED'
                      ? 'Seller Confirmation Window (30m)'
                      : 'Buyer Fiat Payment Window (30m)'
                  }
                  onExpire={fetchOrderAndChat}
                />
              )}

            {order.cancelReason && (
              <div className="rounded-xl bg-red-950/50 border border-red-500/40 p-3.5 text-xs text-red-200">
                <span className="font-bold">Cancel Reason:</span> {order.cancelReason}
                {order.refundTxHash && (
                  <div className="font-mono text-[11px] text-emerald-300 mt-1">
                    Escrow Auto-Refund Tx: {shortenAddress(order.refundTxHash)}
                  </div>
                )}
              </div>
            )}

            {/* Seller's Receiving Bank / E-Wallet Details */}
            <div className="rounded-xl bg-navy-950 border border-slate-800 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-medium">
                  Seller Payment Method ({order.country})
                </span>
                <span className="font-bold text-white">
                  {order.paymentMethodSnapshot.providerName} (
                  {order.paymentMethodSnapshot.type})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Verified Holder Name</span>
                <span className="font-semibold text-white">
                  {order.paymentMethodSnapshot.accountName}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
                <span className="text-slate-400">Account / E-Wallet Number</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-gold-400">
                    {order.paymentMethodSnapshot.accountNumberFull}
                  </span>
                  {order.status !== 'AWAITING_DEPOSIT' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await safeCopyToClipboard(
                          order.paymentMethodSnapshot.accountNumberFull
                        );
                        setCopiedAccount(true);
                        setTimeout(() => setCopiedAccount(false), 1500);
                      }}
                      className="text-slate-400 hover:text-white"
                      title="Copy account number"
                    >
                      {copiedAccount ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
              {order.status === 'AWAITING_DEPOSIT' && isBuyer && (
                <div className="text-[11px] text-amber-300 pt-1">
                  Full account number will be revealed automatically as soon as the seller locks NIM in escrow.
                </div>
              )}
            </div>

            {/* Uploaded Payment Proof Preview */}
            {order.paymentProofUrl && (
              <div className="rounded-xl bg-navy-950 border border-slate-800 p-3 space-y-2">
                <div className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Fiat Payment Screenshot Proof Uploaded</span>
                </div>
                <img
                  src={order.paymentProofUrl}
                  alt="Fiat payment proof screenshot"
                  referrerPolicy="no-referrer"
                  className="max-h-56 rounded-lg object-contain mx-auto border border-slate-800"
                />
              </div>
            )}

            {/* Blockchain Transaction Hashes */}
            {(order.depositTxHash || order.releaseTxHash || order.refundTxHash) && (
              <div className="rounded-xl bg-navy-950 border border-slate-800 p-3.5 space-y-1.5 text-[11px] font-mono">
                {order.depositTxHash && (
                  <div className="flex justify-between text-slate-300">
                    <span>Escrow Lock Tx:</span>
                    <span className="text-gold-400">
                      {shortenAddress(order.depositTxHash)}
                    </span>
                  </div>
                )}
                {order.releaseTxHash && (
                  <div className="flex justify-between text-slate-300">
                    <span>Escrow Release Tx:</span>
                    <span className="text-emerald-400">
                      {shortenAddress(order.releaseTxHash)}
                    </span>
                  </div>
                )}
                {order.refundTxHash && (
                  <div className="flex justify-between text-slate-300">
                    <span>Escrow Refund Tx:</span>
                    <span className="text-amber-400">
                      {shortenAddress(order.refundTxHash)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Role-Specific Primary Actions (Enforced Server-Side & Client-Side) */}
            <div className="space-y-2.5 pt-2">
              {/* Seller Action: Lock NIM to Escrow (Never shown to Buyer!) */}
              {isSeller && order.status === 'AWAITING_DEPOSIT' && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => setShowEscrowSheet(true)}
                  className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-bold text-sm flex items-center justify-center gap-2 hover:brightness-105"
                >
                  <Lock className="w-4 h-4" />
                  <span>
                    {t('p2p.lockEscrowBtn')} ({formatNim(order.amountNim, locale)})
                  </span>
                </button>
              )}

              {isBuyer && order.status === 'AWAITING_DEPOSIT' && (
                <div className="rounded-xl bg-navy-950 border border-slate-800 p-3.5 text-xs text-slate-300 text-center">
                  Waiting for seller ({order.sellerName}) to lock {formatNim(order.amountNim, locale)} into platform escrow…
                </div>
              )}

              {/* Buyer Action: Upload Fiat Payment Screenshot */}
              {isBuyer &&
                (order.status === 'AWAITING_PAYMENT' ||
                  order.status === 'CRYPTO_LOCKED') && (
                  <>
                    <input
                      ref={proofInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleProofFileChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => proofInputRef.current?.click()}
                      className="w-full min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-navy-950 font-bold text-sm flex items-center justify-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      <span>
                        {actionBusy ? 'Uploading Proof…' : t('p2p.uploadProofBtn')}
                      </span>
                    </button>
                  </>
                )}

              {/* Seller Action: Confirm Fiat & Release NIM */}
              {isSeller && order.status === 'PAYMENT_SUBMITTED' && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={handleSellerConfirmRelease}
                  className="w-full min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-navy-950 font-bold text-sm flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {actionBusy
                      ? 'Releasing Escrow…'
                      : t('p2p.confirmReleaseBtn')}
                  </span>
                </button>
              )}

              {/* Secondary Actions: Cancel / Dispute */}
              <div className="flex items-center gap-2.5">
                {(order.status === 'AWAITING_DEPOSIT' ||
                  (isBuyer &&
                    (order.status === 'AWAITING_PAYMENT' ||
                      order.status === 'CRYPTO_LOCKED'))) && (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={handleCancelOrder}
                    className="flex-1 min-h-[42px] rounded-xl border border-slate-700 hover:bg-slate-800 text-xs font-semibold text-slate-300"
                  >
                    {t('p2p.cancelOrderBtn')}
                  </button>
                )}

                {['CRYPTO_LOCKED', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED'].includes(
                  order.status
                ) && (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => setDisputeModalOpen(true)}
                    className="flex-1 min-h-[42px] rounded-xl border border-amber-500/40 hover:bg-amber-950/40 text-xs font-semibold text-amber-300"
                  >
                    {t('p2p.openDisputeBtn')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Private Order Chat Thread (Section 10.6) */}
        <div className="lg:col-span-6 rounded-2xl bg-navy-900 border border-slate-800 flex flex-col h-[560px] shadow-xl overflow-hidden">
          {/* Pinned Counterparty Header + Remind Button */}
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-navy-950/60">
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                <span>{counterpartyName}</span>
                <span>{regionFlag}</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Private Order Chat · Append-Only Dispute Evidence
              </div>
            </div>

            {canRemind && (
              <button
                type="button"
                onClick={handleSendReminder}
                className="min-h-[38px] px-3 rounded-xl bg-gold-500/15 border border-gold-500/40 hover:bg-gold-500/25 text-gold-300 text-xs font-semibold flex items-center gap-1.5"
                title="Rate-limited: max 1 every 5 minutes (does not change 30m deadline)"
              >
                <Bell className="w-3.5 h-3.5" />
                <span>Remind ({5 - order.reminderCount} left)</span>
              </button>
            )}
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m) => {
              if (m.type === 'SYSTEM') {
                return (
                  <div key={m.id} className="flex justify-center my-2">
                    <div className="max-w-md rounded-xl bg-navy-950 border border-slate-800 px-3.5 py-2 text-[11px] text-slate-300 text-center leading-relaxed">
                      {m.body}
                    </div>
                  </div>
                );
              }

              if (m.type === 'PAYMENT_REMINDER') {
                return (
                  <div key={m.id} className="flex justify-center my-2">
                    <div className="max-w-md rounded-xl bg-gold-500/15 border border-gold-500/40 px-3.5 py-2.5 text-xs text-gold-200 flex items-center gap-2">
                      <Bell className="w-4 h-4 text-gold-400 shrink-0" />
                      <span>{m.body}</span>
                    </div>
                  </div>
                );
              }

              const isMe = m.senderId === user?.id;
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className="text-[10px] text-slate-400 mb-1 px-1 flex items-center gap-2">
                    <span>{m.senderName}</span>
                    {!isMe && (
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/p2p/messages/${m.id}/report`, {
                            method: 'POST',
                          });
                          fetchOrderAndChat();
                        }}
                        className="text-slate-500 hover:text-amber-400 inline-flex items-center gap-0.5"
                        title="Flag message as dispute evidence"
                      >
                        <Flag className="w-3 h-3" />
                        <span>{m.reported ? 'Reported' : 'Report'}</span>
                      </button>
                    )}
                  </div>
                  <div
                    className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                      isMe
                        ? 'bg-gold-500 text-navy-950 font-medium rounded-br-sm'
                        : 'bg-navy-950 border border-slate-800 text-slate-100 rounded-bl-sm'
                    }`}
                  >
                    <div>{m.body}</div>
                    {m.attachmentUrl && (
                      <img
                        src={m.attachmentUrl}
                        alt="Chat attachment"
                        referrerPolicy="no-referrer"
                        className="mt-2 max-h-44 rounded-lg border border-slate-700"
                      />
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 px-1">
                    {new Date(m.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {isMe && (m.readAt ? ' · Read' : ' · Delivered')}
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>

          {/* Context-Aware Quick-Reply Chips & Composer */}
          {isReadOnlyChat ? (
            <div className="p-3.5 bg-navy-950 border-t border-slate-800 text-center text-xs text-slate-400">
              Order has concluded ({order.status}). This chat thread is archived in read-only mode for audit evidence.
            </div>
          ) : (
            <div className="border-t border-slate-800 bg-navy-950 p-3 space-y-2.5">
              {/* Quick Reply Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {(isBuyer ? BUYER_QUICK_CHIPS : SELLER_QUICK_CHIPS).map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleSendMessage(chip)}
                    className="px-3 py-1.5 rounded-lg bg-navy-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0 transition-colors"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {hasOffPlatformWarning && (
                <div className="rounded-lg bg-amber-950/60 border border-amber-500/40 px-3 py-1.5 text-[11px] text-amber-200 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>
                    Warning: Never move trades off-platform or send NIM outside the official escrow flow.
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  ref={chatImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleChatImageUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => chatImageInputRef.current?.click()}
                  className="min-h-[42px] min-w-[42px] rounded-xl bg-navy-900 border border-slate-800 text-slate-300 hover:text-white flex items-center justify-center shrink-0"
                  title="Attach image"
                >
                  <ImageIcon className="w-4 h-4" />
                </button>
                <input
                  type="text"
                  maxLength={1000}
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Write a message to counterparty…"
                  className="flex-1 h-[42px] px-3.5 rounded-xl bg-navy-900 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-gold-500"
                />
                <button
                  type="button"
                  onClick={() => handleSendMessage()}
                  className="min-h-[42px] px-4 rounded-xl bg-gold-500 text-navy-950 font-bold text-xs flex items-center justify-center gap-1 shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Sheet before Seller invokes Nimiq SDK sendNim */}
      <SendConfirmationSheet
        open={showEscrowSheet}
        title="Lock NIM in Platform Escrow"
        recipientAddress={order.escrowAddress}
        recipientLabel="Nimora Escrow Vault"
        amountNim={order.amountNim}
        referenceId={`order:${order.id}`}
        loading={actionBusy}
        onConfirm={handleSellerLockEscrow}
        onCancel={() => setShowEscrowSheet(false)}
      />

      {/* Open Dispute Modal */}
      {disputeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <form
            onSubmit={handleOpenDispute}
            className="bg-navy-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl"
          >
            <h3 className="text-base font-bold text-white font-display">
              Open Order Dispute (#{order.id})
            </h3>
            <p className="text-xs text-slate-400">
              Opening a dispute freezes the escrowed {order.amountNim} NIM until a Nimora administrator reviews the payment proof and chat log.
            </p>
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Reason for Dispute
              </label>
              <input
                type="text"
                required
                minLength={5}
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="e.g. Fiat transferred 25m ago but seller has not released"
                className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Additional Evidence / Reference Notes
              </label>
              <textarea
                rows={3}
                value={disputeNotes}
                onChange={(e) => setDisputeNotes(e.target.value)}
                placeholder="Bank reference number or details…"
                className="w-full p-3 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDisputeModalOpen(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-700 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="flex-1 min-h-[44px] rounded-xl bg-amber-500 text-navy-950 font-bold text-xs"
              >
                Freeze Escrow & Submit Dispute
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
