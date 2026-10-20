import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  QrCode,
  Gift,
  CheckCircle2,
  XCircle,
  Sparkles,
  ArrowRight,
  Lock,
} from 'lucide-react';
import { useAppStore, apiFetch } from '../store/useAppStore.ts';
import { sendNim, adjustMockBalanceNim } from '../lib/nimiq/sdk.ts';
import { formatNim, shortenAddress } from '../lib/nimiq/units.ts';
import { encodeRequestQR, encodeRedPacketQR } from '../lib/qr/payload.ts';
import { QRCard, SendConfirmationSheet } from '../components/ui/CoreComponents.tsx';

interface PaymentRequestItem {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAddress: string;
  amountNim: number | null;
  note: string;
  status: 'OPEN' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  paidByAddress: string | null;
  paidTxHash: string | null;
  expiresAt: string;
  slug: string;
  createdAt: string;
}

export const RequestNimPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAppStore();
  const [requests, setRequests] = useState<PaymentRequestItem[]>([]);
  const [amountInput, setAmountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedReq, setSelectedReq] = useState<PaymentRequestItem | null>(null);

  const locale = user?.locale || 'en';

  const loadRequests = async () => {
    try {
      const res = await apiFetch<{ requests: PaymentRequestItem[] }>('/api/requests');
      setRequests(res.requests);
      if (!selectedReq && res.requests.length > 0) {
        setSelectedReq(res.requests[0]);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await apiFetch<{ request: PaymentRequestItem }>('/api/requests', {
        method: 'POST',
        body: JSON.stringify({
          amountNim: amountInput.trim() ? Number(amountInput) : null,
          note: noteInput,
          expiresInHours: 24,
        }),
      });
      setAmountInput('');
      setNoteInput('');
      setSelectedReq(res.request);
      await loadRequests();
    } finally {
      setCreating(false);
    }
  };

  const qrLinks = selectedReq ? encodeRequestQR(selectedReq.slug) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white font-display">
          {t('request.title')}
        </h1>
        <p className="text-xs text-slate-400 mt-1">{t('request.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleCreate}
          className="lg:col-span-6 rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-4 shadow-xl"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1.5">
              {t('request.amountLabel')}
            </label>
            <input
              type="number"
              step="any"
              min={1}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder={t('request.amountPlaceholder')}
              className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white font-mono focus:outline-none focus:border-gold-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              {t('request.openAmountHint')}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1.5">
              {t('request.noteLabel')}
            </label>
            <input
              type="text"
              maxLength={160}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder={t('request.notePlaceholder')}
              className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-gold-500"
            />
          </div>

          <button
            type="submit"
            disabled={creating}
            className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-bold text-sm hover:brightness-105 transition-all"
          >
            {creating ? t('request.generatingBtn') : t('request.createBtn')}
          </button>

          {/* List of My Payment Requests */}
          <div className="pt-4 border-t border-slate-800 space-y-2.5">
            <div className="text-xs font-bold text-slate-300">
              {t('request.myRequests')} ({requests.length})
            </div>
            {requests.length === 0 ? (
              <div className="text-xs text-slate-500">{t('request.noRequests')}</div>
            ) : (
              requests.map((r) => (
                <div
                  key={r.id}
                  onClick={() => setSelectedReq(r)}
                  className={`cursor-pointer rounded-xl p-3 border text-xs flex items-center justify-between transition-colors ${
                    selectedReq?.id === r.id
                      ? 'bg-gold-500/15 border-gold-500/40 text-white'
                      : 'bg-navy-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="font-mono font-bold text-white">
                      {r.amountNim ? formatNim(r.amountNim, locale) : t('request.openAmount')} ·{' '}
                      <span className="text-gold-400">{r.status}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {r.note || t('request.noNote')} · /{r.slug}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        navigate(`/r/${r.slug}`);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-navy-900 border border-slate-700 text-[11px] text-gold-400 hover:text-white"
                    >
                      {t('request.openLink')}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </form>

        <div className="lg:col-span-6">
          {selectedReq && qrLinks ? (
            <div className="space-y-3">
              <QRCard
                title={`${t('request.fromLabel')} ${selectedReq.creatorName}`}
                subtitle={
                  selectedReq.note ||
                  `${t('request.subtitle')} (${selectedReq.status})`
                }
                amountLabel={
                  selectedReq.amountNim
                    ? formatNim(selectedReq.amountNim, locale)
                    : t('request.openAmount')
                }
                qrValue={qrLinks.deepLink}
                shareUrl={qrLinks.webLink}
              />
              {selectedReq.status === 'OPEN' && (
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/requests/${selectedReq.id}/cancel`, {
                      method: 'POST',
                    });
                    loadRequests();
                  }}
                  className="w-full min-h-[42px] rounded-xl border border-slate-800 hover:bg-slate-800/50 text-xs text-slate-400 hover:text-red-300"
                >
                  {t('request.cancelRequest')}
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl bg-navy-900/60 border border-slate-800 p-8 text-center text-xs text-slate-400">
              {t('request.emptyQrHint')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Payer View: /r/:slug or /request/pay/:slug
export const PayRequestPage: React.FC = () => {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user, deductSimulatedBalance, syncWalletBalance } = useAppStore();
  const [reqItem, setReqItem] = useState<PaymentRequestItem | null>(null);
  const [customAmount, setCustomAmount] = useState('100');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locale = user?.locale || 'en';

  const loadReq = async () => {
    if (!slug) return;
    try {
      const res = await apiFetch<{ request: PaymentRequestItem }>(
        `/api/requests/${slug}`
      );
      setReqItem(res.request);
      if (res.request.amountNim) {
        setCustomAmount(String(res.request.amountNim));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request not found');
    }
  };

  useEffect(() => {
    loadReq();
  }, [slug]);

  if (!reqItem) {
    return (
      <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 text-center text-xs text-slate-300">
        {error || t('common.loading')}
      </div>
    );
  }

  const finalNim = reqItem.amountNim ?? Number(customAmount || 0);

  const handlePayNow = async () => {
    setPaying(true);
    setError(null);
    try {
      const tx = await sendNim({
        recipient: reqItem.creatorAddress,
        amountNim: finalNim,
        data: `request:${reqItem.id}`,
      });
      deductSimulatedBalance(finalNim);

      const res = await apiFetch<{ request: PaymentRequestItem }>(
        `/api/requests/${reqItem.slug}/pay`,
        {
          method: 'POST',
          body: JSON.stringify({
            txHash: tx.txHash,
            amountNim: finalNim,
          }),
        }
      );
      setReqItem(res.request);
      setConfirmOpen(false);
      await syncWalletBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-5">
      <div className="rounded-3xl bg-navy-900 border border-slate-800 p-6 space-y-5 shadow-2xl text-center">
        <div className="w-12 h-12 rounded-2xl bg-gold-500/15 border border-gold-500/30 flex items-center justify-center text-gold-400 mx-auto">
          <QrCode className="w-6 h-6" />
        </div>
        <div>
          <div className="text-xs text-slate-400">{t('request.fromLabel')}</div>
          <h1 className="text-xl font-bold text-white font-display mt-0.5">
            {reqItem.creatorName}
          </h1>
          <div className="text-xs font-mono text-slate-400 mt-1">
            {shortenAddress(reqItem.creatorAddress)}
          </div>
        </div>

        {reqItem.note && (
          <div className="rounded-xl bg-navy-950 border border-slate-800 p-3 text-xs text-slate-200">
            “{reqItem.note}”
          </div>
        )}

        {reqItem.status === 'OPEN' ? (
          <div className="space-y-4">
            {reqItem.amountNim ? (
              <div className="text-3xl font-extrabold text-gold-400 font-mono tabular-nums">
                {formatNim(reqItem.amountNim, locale)}
              </div>
            ) : (
              <div className="text-start">
                <label className="block text-xs text-slate-300 mb-1">
                  {t('request.enterNimToSend')}
                </label>
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl bg-navy-950 border border-slate-800 text-base font-mono text-white"
                />
              </div>
            )}

            {error && (
              <div className="text-xs text-red-300 bg-red-950/50 border border-red-500/40 rounded-xl p-3">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-bold text-sm hover:brightness-105"
            >
              {t('request.payNowBtn')} ({formatNim(finalNim, locale)})
            </button>
          </div>
        ) : (
          <div className="rounded-2xl bg-emerald-950/40 border border-emerald-500/40 p-4 space-y-2">
            <div className="flex items-center justify-center gap-2 text-emerald-400 font-bold text-sm">
              {reqItem.status === 'PAID' ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <XCircle className="w-5 h-5 text-amber-400" />
              )}
              <span>
                {t('common.status')}: {reqItem.status}
              </span>
            </div>
            {reqItem.paidTxHash && (
              <div className="text-[11px] font-mono text-slate-300">
                Tx Hash: {shortenAddress(reqItem.paidTxHash)}
              </div>
            )}
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-2 min-h-[40px] px-4 rounded-xl bg-navy-950 border border-slate-800 text-xs text-slate-200"
            >
              {t('request.returnHome')}
            </button>
          </div>
        )}
      </div>

      <SendConfirmationSheet
        open={confirmOpen}
        title={`${t('request.payNowBtn')} · ${reqItem.creatorName}`}
        recipientAddress={reqItem.creatorAddress}
        recipientLabel={reqItem.creatorName}
        amountNim={finalNim}
        referenceId={`request:${reqItem.id}`}
        loading={paying}
        onConfirm={handlePayNow}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
};

// ============================================================================
// RED PACKET PAGE & CLAIM PAGE
// ============================================================================
interface RedPacketItem {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAddress: string;
  totalNim: number;
  slots: number;
  mode: 'EQUAL' | 'RANDOM';
  message: string;
  status: 'PENDING_DEPOSIT' | 'ACTIVE' | 'FINISHED' | 'EXPIRED' | 'REFUNDED';
  depositTxHash: string | null;
  expiresAt: string;
  slug: string;
  claims: Array<{
    id: string;
    claimerName: string;
    claimerAddress: string;
    amountNim: number;
    payoutTxHash: string;
    createdAt: string;
  }>;
}

export const RedPacketPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, escrowAddress, deductSimulatedBalance, syncWalletBalance } = useAppStore();

  const [packets, setPackets] = useState<RedPacketItem[]>([]);
  const [totalNim, setTotalNim] = useState('200');
  const [slots, setSlots] = useState('5');
  const [mode, setMode] = useState<'EQUAL' | 'RANDOM'>('RANDOM');
  const [message, setMessage] = useState('Best wishes & prosperity with NIM!');
  const [selectedPacket, setSelectedPacket] = useState<RedPacketItem | null>(
    null
  );
  const [pendingDepositPacket, setPendingDepositPacket] =
    useState<RedPacketItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locale = user?.locale || 'en';

  const loadPackets = async () => {
    try {
      const res = await apiFetch<{ redPackets: RedPacketItem[] }>(
        '/api/redpackets'
      );
      // Only show Red Packets created by the current user that are ACTIVE or FINISHED (funded)
      const myFundedPackets = (res.redPackets || []).filter(
        (p) =>
          p.creatorId === user?.id &&
          (p.status === 'ACTIVE' || p.status === 'FINISHED')
      );
      setPackets(myFundedPackets);
      if (!selectedPacket && myFundedPackets.length > 0) {
        setSelectedPacket(myFundedPackets[0]);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    loadPackets();
  }, [user?.id]);

  const handleCreatePacket = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{
        redPacket: RedPacketItem;
        escrowAddress: string;
      }>('/api/redpackets', {
        method: 'POST',
        body: JSON.stringify({
          totalNim: Number(totalNim),
          slots: Number(slots),
          mode,
          message,
        }),
      });
      setPendingDepositPacket(res.redPacket);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create Red Packet');
    } finally {
      setBusy(false);
    }
  };

  const handleLockRedPacketDeposit = async () => {
    if (!pendingDepositPacket) return;
    setBusy(true);
    setError(null);
    try {
      const tx = await sendNim({
        recipient: escrowAddress,
        amountNim: pendingDepositPacket.totalNim,
        data: `packet:${pendingDepositPacket.id}`,
      });
      deductSimulatedBalance(pendingDepositPacket.totalNim);

      const activated = await apiFetch<{ redPacket: RedPacketItem }>(
        `/api/redpackets/${pendingDepositPacket.slug}/deposit`,
        {
          method: 'POST',
          body: JSON.stringify({ txHash: tx.txHash }),
        }
      );
      setPendingDepositPacket(null);
      setSelectedPacket(activated.redPacket);
      await loadPackets();
      await syncWalletBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deposit failed');
    } finally {
      setBusy(false);
    }
  };

  const qrLinks = selectedPacket ? encodeRedPacketQR(selectedPacket.slug) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white font-display">
          {t('redpacket.title')}
        </h1>
        <p className="text-xs text-slate-400 mt-1">{t('redpacket.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleCreatePacket}
          className="lg:col-span-6 rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-4 shadow-xl"
        >
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('RANDOM')}
              className={`min-h-[42px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 ${
                mode === 'RANDOM'
                  ? 'bg-rose-500 text-white'
                  : 'bg-navy-950 text-slate-300 border border-slate-800'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>{t('redpacket.modeRandom')}</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('EQUAL')}
              className={`min-h-[42px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 ${
                mode === 'EQUAL'
                  ? 'bg-gold-500 text-navy-950'
                  : 'bg-navy-950 text-slate-300 border border-slate-800'
              }`}
            >
              <Gift className="w-4 h-4" />
              <span>{t('redpacket.modeEqual')}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1">
                {t('redpacket.totalLabel')}
              </label>
              <input
                type="number"
                required
                min={0.001}
                step="0.001"
                value={totalNim}
                onChange={(e) => setTotalNim(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1">
                {t('redpacket.slotsLabel')}
              </label>
              <input
                type="number"
                required
                min={2}
                max={200}
                value={slots}
                onChange={(e) => setSlots(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1">
              {t('redpacket.greetingLabel')}
            </label>
            <input
              type="text"
              maxLength={140}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-950/50 border border-red-500/40 p-3 text-xs text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-rose-500 to-gold-500 text-white font-bold text-sm flex items-center justify-center gap-2 hover:brightness-105"
          >
            <Lock className="w-4 h-4" />
            <span>{t('redpacket.createBtn')}</span>
          </button>

          {/* Only render My Created Red Packets if the user has actually created & funded at least one */}
          {packets.length > 0 && (
            <div className="pt-4 border-t border-slate-800 space-y-2.5">
              <div className="text-xs font-bold text-slate-300">
                {t('redpacket.myCreatedPackets')} ({packets.length})
              </div>
              {packets.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedPacket(p)}
                  className={`cursor-pointer rounded-xl p-3 border text-xs flex items-center justify-between transition-colors ${
                    selectedPacket?.id === p.id
                      ? 'bg-rose-500/15 border-rose-500/40 text-white'
                      : 'bg-navy-950 border-slate-800 text-slate-300'
                  }`}
                >
                  <div>
                    <div className="font-bold text-white">
                      {formatNim(p.totalNim, locale)} ({p.mode}) ·{' '}
                      {t('redpacket.claimedCount', {
                        claimed: p.claims.length,
                        total: p.slots,
                      })}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {p.creatorName} · {t('common.status')}: {p.status}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      navigate(`/rp/${p.slug}`);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-200 font-semibold flex items-center gap-1"
                  >
                    <span>{t('redpacket.claimPageBtn')}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </form>

        <div className="lg:col-span-6">
          {selectedPacket && qrLinks ? (
            <QRCard
              title={`${selectedPacket.creatorName} · ${selectedPacket.mode} Red Packet`}
              subtitle={`"${selectedPacket.message}" · ${t('redpacket.claimedCount', {
                claimed: selectedPacket.claims.length,
                total: selectedPacket.slots,
              })}`}
              amountLabel={`${formatNim(selectedPacket.totalNim, locale)}`}
              qrValue={qrLinks.deepLink}
              shareUrl={qrLinks.webLink}
            />
          ) : (
            <div className="rounded-2xl bg-navy-900/60 border border-slate-800 p-8 text-center text-xs text-slate-400">
              {t('redpacket.subtitle')}
            </div>
          )}
        </div>
      </div>

      {pendingDepositPacket && (
        <SendConfirmationSheet
          open={true}
          title={t('redpacket.depositSheetTitle')}
          recipientAddress={escrowAddress}
          recipientLabel="Nimora Red Packet Escrow"
          amountNim={pendingDepositPacket.totalNim}
          referenceId={`packet:${pendingDepositPacket.id}`}
          loading={busy}
          onConfirm={handleLockRedPacketDeposit}
          onCancel={() => setPendingDepositPacket(null)}
        />
      )}
    </div>
  );
};

// Claim Page: /rp/:slug or /redpacket/claim/:slug
export const ClaimRedPacketPage: React.FC = () => {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { user, syncWalletBalance, creditSimulatedBalance } = useAppStore();
  const [packet, setPacket] = useState<RedPacketItem | null>(null);
  const [claimedAmount, setClaimedAmount] = useState<number | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locale = user?.locale || 'en';

  const loadPacket = async () => {
    if (!slug) return;
    try {
      const res = await apiFetch<{ redPacket: RedPacketItem }>(
        `/api/redpackets/${slug}`
      );
      setPacket(res.redPacket);
      const myExisting = res.redPacket.claims.find(
        (c) => c.claimerAddress === user?.address
      );
      if (myExisting) {
        setClaimedAmount(myExisting.amountNim);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Red Packet not found');
    }
  };

  useEffect(() => {
    loadPacket();
  }, [slug, user?.address]);

  const handleClaim = async () => {
    if (!slug) return;
    setClaiming(true);
    setError(null);
    try {
      const res = await apiFetch<{
        claim: { amountNim: number };
        redPacket: RedPacketItem;
        newBalanceNim?: number;
      }>(`/api/redpackets/${slug}/claim`, {
        method: 'POST',
      });
      setClaimedAmount(res.claim.amountNim);
      setPacket(res.redPacket);

      const targetBal =
        typeof res.newBalanceNim === 'number'
          ? res.newBalanceNim
          : Number(((user?.balanceNim || 0) + res.claim.amountNim).toFixed(5));

      useAppStore.setState((s) => ({
        walletBalanceNim: targetBal,
        walletBalanceSynced: true,
        user: s.user ? { ...s.user, balanceNim: targetBal } : null,
      }));

      if (user?.address) {
        adjustMockBalanceNim(user.address, res.claim.amountNim);
      }

      await syncWalletBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setClaiming(false);
    }
  };

  if (!packet) {
    return (
      <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 text-center text-xs text-slate-300">
        {error || t('common.loading')}
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto space-y-5">
      <div className="rounded-3xl bg-gradient-to-b from-rose-950/90 via-navy-900 to-navy-900 border border-rose-500/40 p-6 text-center space-y-5 shadow-2xl">
        <div className="w-14 h-14 rounded-2xl bg-gold-500/20 border border-gold-500/40 flex items-center justify-center text-gold-400 mx-auto">
          <Gift className="w-7 h-7" />
        </div>

        <div>
          <div className="text-xs font-semibold text-rose-300">
            {packet.mode} RED PACKET
          </div>
          <h1 className="text-xl font-bold text-white font-display mt-1">
            {t('redpacket.fromSender', { name: packet.creatorName })}
          </h1>
          <p className="text-xs text-slate-300 mt-1">“{packet.message}”</p>
        </div>

        {claimedAmount !== null ? (
          <div className="rounded-2xl bg-navy-950/90 border border-gold-500/50 p-5 space-y-1">
            <div className="text-xs text-gold-300 font-semibold">
              {t('redpacket.claimedFromEscrow')}
            </div>
            <div className="text-3xl font-extrabold text-gold-400 font-mono tabular-nums">
              +{formatNim(claimedAmount, locale)}
            </div>
            <div className="text-[11px] text-slate-400">
              {t('redpacket.sentToWallet')} ({shortenAddress(user?.address || '')})
            </div>
          </div>
        ) : packet.status === 'ACTIVE' && packet.claims.length < packet.slots ? (
          <button
            type="button"
            disabled={claiming}
            onClick={handleClaim}
            className="w-full min-h-[52px] rounded-2xl bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-extrabold text-sm shadow-lg hover:brightness-105 transition-all"
          >
            {claiming ? t('redpacket.openingBtn') : t('redpacket.claimBtn')}
          </button>
        ) : (
          <div className="rounded-xl bg-navy-950 border border-slate-800 p-3.5 text-xs text-slate-300">
            {packet.status} ({packet.claims.length}/{packet.slots})
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-950/60 border border-red-500/40 p-3 text-xs text-red-200">
            {error}
          </div>
        )}

        {/* Live Claimed List */}
        <div className="text-start border-t border-slate-800 pt-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-200">
            <span>
              {t('redpacket.claimedCount', {
                claimed: packet.claims.length,
                total: packet.slots,
              })}
            </span>
            <span className="font-mono text-gold-400 tabular-nums">
              {formatNim(packet.totalNim, locale)}
            </span>
          </div>

          {packet.claims.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-3">
              {t('redpacket.beFirstToClaim')}
            </div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {packet.claims.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl bg-navy-950 border border-slate-800/80 px-3.5 py-2.5 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-semibold text-white">{c.claimerName}</div>
                    <div className="font-mono text-[10px] text-slate-500">
                      Tx: {shortenAddress(c.payoutTxHash)}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-gold-400 tabular-nums">
                    +{formatNim(c.amountNim, locale)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
