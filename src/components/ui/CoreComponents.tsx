import React, { useEffect, useState } from 'react';
import { Clock, AlertTriangle, Check, Copy, Share2, Download, Search, X, ShieldCheck } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import {
  ALL_COUNTRIES_CATALOG,
  CountryListItem,
  SUPPORTED_REGIONS,
} from '../../../packages/shared/index.ts';
import { formatNim, shortenAddress } from '../../lib/nimiq/units.ts';

// 1. Live 30-Minute Countdown Timer (Server-Synchronized)
export const CountdownTimer: React.FC<{
  deadlineIso: string | null;
  label?: string;
  onExpire?: () => void;
}> = ({ deadlineIso, label, onExpire }) => {
  const [remainingSec, setRemainingSec] = useState<number>(0);

  useEffect(() => {
    if (!deadlineIso) return;
    const calc = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(deadlineIso).getTime() - Date.now()) / 1000)
      );
      setRemainingSec(diff);
      if (diff === 0 && onExpire) {
        onExpire();
      }
    };
    calc();
    const timer = setInterval(calc, 1000);
    return () => clearInterval(timer);
  }, [deadlineIso, onExpire]);

  if (!deadlineIso) return null;

  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  const isWarning = remainingSec > 0 && remainingSec <= 300; // < 5 minutes warning
  const isExpired = remainingSec === 0;

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 border text-xs transition-colors ${
        isExpired
          ? 'bg-red-950/40 border-red-500/40 text-red-200'
          : isWarning
          ? 'bg-amber-950/50 border-amber-500/50 text-amber-200'
          : 'bg-navy-950/70 border-slate-800 text-slate-300'
      }`}
    >
      <div className="flex items-center gap-2">
        {isWarning || isExpired ? (
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        ) : (
          <Clock className="w-4 h-4 text-gold-500 shrink-0" />
        )}
        <span className="font-medium">
          {label || 'Auto-Cancel Window'}
          {isWarning && ' · Under 5 min left!'}
        </span>
      </div>
      <span className="font-mono font-bold text-sm tabular-nums tracking-tight text-white">
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </span>
    </div>
  );
};

// 2. Full-Height Mobile-First CountrySelect Bottom Sheet
export const CountrySelectSheet: React.FC<{
  open: boolean;
  selectedCode: string;
  onSelect: (country: CountryListItem) => void;
  onClose: () => void;
}> = ({ open, selectedCode, onSelect, onClose }) => {
  const [search, setSearch] = useState('');

  if (!open) return null;

  const filtered = [...ALL_COUNTRIES_CATALOG]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(
      (c) =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.code.toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-sm">
      <div className="bg-navy-900 border-t border-slate-800 rounded-t-3xl max-h-[88vh] flex flex-col w-full max-w-2xl mx-auto shadow-2xl">
        <div className="w-10 h-1.5 bg-slate-700 rounded-full mx-auto mt-3" />
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white font-display">
              Select Your Country
            </h3>
            <p className="text-xs text-slate-400">
              Determines your local currency, bank catalog, and default language
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-800 sticky top-0 bg-navy-900 z-10">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search country name or ISO code (e.g. ID, US, MY, DE)…"
              className="w-full h-11 ps-10 pe-4 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-gold-500"
            />
          </div>
        </div>

        <div className="overflow-y-auto divide-y divide-slate-800/60 px-2 pb-8">
          {filtered.map((item) => {
            const region = SUPPORTED_REGIONS[item.code];
            const isSelected = selectedCode === item.code;
            return (
              <button
                key={item.code}
                type="button"
                disabled={!item.supported}
                onClick={() => {
                  if (item.supported) {
                    onSelect(item);
                    onClose();
                  }
                }}
                className={`w-full min-h-[56px] px-4 py-3 flex items-center justify-between text-start rounded-xl transition-colors ${
                  !item.supported
                    ? 'opacity-45 cursor-not-allowed'
                    : isSelected
                    ? 'bg-gold-500/15 text-white'
                    : 'hover:bg-slate-800/50 text-slate-200'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <span className="text-2xl leading-none">{item.flag}</span>
                  <div>
                    <div className="font-medium text-sm text-white flex items-center gap-2">
                      <span>{item.name}</span>
                      <span className="text-xs font-mono text-slate-400">
                        · {item.code}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {item.supported && region
                        ? `${region.currency} (${region.currencySymbol}) · ${region.paymentMethods.length} local banks & e-wallets`
                        : 'Not supported yet'}
                    </div>
                  </div>
                </div>
                {isSelected && (
                  <Check className="w-5 h-5 text-gold-500 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// 3. Transaction Confirmation Sheet (Required before invoking sendNim)
export const SendConfirmationSheet: React.FC<{
  open: boolean;
  title: string;
  recipientAddress: string;
  recipientLabel: string;
  amountNim: number;
  referenceId: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  recipientAddress,
  recipientLabel,
  amountNim,
  referenceId,
  loading,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/75 backdrop-blur-sm">
      <div className="bg-navy-900 border-t border-slate-800 rounded-t-3xl p-6 w-full max-w-lg mx-auto shadow-2xl">
        <div className="w-10 h-1.5 bg-slate-700 rounded-full mx-auto mb-4" />
        <div className="flex items-center gap-2.5 text-gold-500 text-xs font-semibold mb-1">
          <ShieldCheck className="w-4 h-4" />
          <span>Nimiq Pay Transaction Signature</span>
        </div>
        <h3 className="text-lg font-bold text-white font-display">{title}</h3>
        <p className="text-xs text-slate-400 mt-1">
          Review the transaction parameters carefully before signing in Nimiq Pay.
        </p>

        <div className="mt-5 rounded-2xl bg-navy-950 border border-slate-800 p-4 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Amount</span>
            <span className="font-mono font-bold text-base text-gold-400 tabular-nums">
              {formatNim(amountNim)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Luna Equivalent</span>
            <span className="font-mono text-xs text-slate-300 tabular-nums">
              {(amountNim * 100_000).toLocaleString()} luna
            </span>
          </div>
          <div className="border-t border-slate-800/80 pt-3 flex items-center justify-between">
            <span className="text-slate-400">Recipient</span>
            <span className="font-medium text-white">{recipientLabel}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Destination Address</span>
            <span className="font-mono text-xs text-slate-300">
              {shortenAddress(recipientAddress)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">On-Chain Tx Data</span>
            <span className="font-mono text-xs text-emerald-400">
              {referenceId}
            </span>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="flex-1 min-h-[48px] rounded-xl border border-slate-700 text-slate-300 font-medium text-sm hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className="flex-1 min-h-[48px] rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-bold text-sm hover:brightness-105 transition-all disabled:opacity-50"
          >
            {loading ? 'Broadcasting…' : 'Sign & Send NIM'}
          </button>
        </div>
      </div>
    </div>
  );
};

export async function safeCopyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && document.hasFocus()) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy textarea fallback
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textArea);
    return ok;
  } catch {
    return false;
  }
}

// 4. Shareable QR Card Component (with Copy Link, Share, and Save PNG Image)
export const QRCard: React.FC<{
  title: string;
  subtitle: string;
  qrValue: string;
  shareUrl: string;
  amountLabel?: string;
}> = ({ title, subtitle, qrValue, shareUrl, amountLabel }) => {
  const [copied, setCopied] = useState(false);
  const canvasId = `qr-canvas-${qrValue.replace(/[^a-zA-Z0-9]/g, '').slice(-10)}`;

  const handleCopy = async () => {
    await safeCopyToClipboard(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    // Copy synchronously while document still has focus before native share sheet opens
    await handleCopy();
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title,
          text: subtitle,
          url: shareUrl,
        });
      } catch {
        // User dismissed share sheet or WebView blocked navigator.share; link is already copied
      }
    }
  };

  const handleSaveImage = () => {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `nimora-qr-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="rounded-2xl bg-navy-900 border border-slate-800 p-5 text-center shadow-lg">
      <div className="text-sm font-bold text-white font-display">{title}</div>
      <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>
      {amountLabel && (
        <div className="mt-2 font-mono text-lg font-bold text-gold-400 tabular-nums">
          {amountLabel}
        </div>
      )}

      <div className="my-5 inline-flex p-4 bg-white rounded-2xl shadow-md">
        <QRCodeCanvas
          id={canvasId}
          value={qrValue}
          size={196}
          level="M"
          includeMargin={false}
        />
      </div>

      <div className="text-[11px] font-mono text-slate-400 truncate bg-navy-950 border border-slate-800/80 rounded-xl px-3 py-2 mb-4">
        {shareUrl}
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <button
          type="button"
          onClick={handleCopy}
          className="min-h-[44px] rounded-xl bg-navy-950 border border-slate-800 hover:border-gold-500/50 text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 text-gold-400" />
              <span>Copy Link</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="min-h-[44px] rounded-xl bg-navy-950 border border-slate-800 hover:border-gold-500/50 text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Share2 className="w-4 h-4 text-gold-400" />
          <span>Share</span>
        </button>
        <button
          type="button"
          onClick={handleSaveImage}
          className="min-h-[44px] rounded-xl bg-navy-950 border border-slate-800 hover:border-gold-500/50 text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Download className="w-4 h-4 text-gold-400" />
          <span>Save QR</span>
        </button>
      </div>
    </div>
  );
};
