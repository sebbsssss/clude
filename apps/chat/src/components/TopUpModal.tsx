import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown, CheckCircle, AlertCircle, Copy, Loader2, QrCode, Smartphone } from 'lucide-react';
import { useSolanaWallet } from '../hooks/use-solana-wallet';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createQR } from '@solana/pay';
import { api } from '../lib/api';
import { SOLANA_RPC_URL, USDC_MINT_ADDRESS, SOLANA_CHAIN } from '../lib/solana-config';
import { useAuthContext } from '../hooks/AuthContext';

interface Props {
  open: boolean;
  onClose: () => void;
  currentBalance: number | null;
  onSuccess: (previousBalance: number) => void;
}

type Chain = 'solana' | 'base';
type TxState = 'idle' | 'building' | 'signing' | 'confirming' | 'success' | 'error';
type PayMethod = 'wallet' | 'qr';

const PRESET_AMOUNTS = [5, 10, 50] as const;
const MIN_AMOUNT = 1;

// Solana constants
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDC_MINT = new PublicKey(USDC_MINT_ADDRESS);
const USDC_DECIMALS = 6;
const BASE_DEST = '0x48346152f7AaF4c645e939fC21Db0F9da287975d';

/** Detect mobile by touch support + screen width */
function isMobileDevice(): boolean {
  return 'ontouchstart' in window && window.innerWidth < 768;
}

function findAta(walletPubkey: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [walletPubkey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function createUsdcTransferInstruction(
  source: PublicKey,
  dest: PublicKey,
  owner: PublicKey,
  amountUsdc: number,
): TransactionInstruction {
  // TransferChecked (opcode 12) instead of legacy Transfer (3): the checked
  // variant includes the mint pubkey + decimals so wallets like Phantom can
  // render the human-readable amount ("1 USDC") instead of the raw base
  // units ("1,000,000"). Plain Transfer leaves the wallet to guess and many
  // refuse to auto-confirm an unrecognized SPL transfer.
  const amount = BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0); // TransferChecked instruction index
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(USDC_DECIMALS, 9);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/** Returns true when the error was a user-initiated wallet rejection (not a network/code error) */
function isWalletRejection(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: number; message?: string };
  const msg = (e.message ?? '').toLowerCase();
  return (
    e.code === 4001 ||
    msg.includes('user rejected') ||
    msg.includes('user cancelled') ||
    msg.includes('transaction cancelled') ||
    msg.includes('rejected the request')
  );
}

/** Idempotent create-ATA instruction (succeeds even if account already exists) */
function createAtaIdempotentInstruction(payer: PublicKey, ata: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent instruction index
  });
}

async function buildSolanaUsdcTx(
  senderAddress: string,
  destAddress: string,
  amountUsdc: number,
  presetBlockhash?: string,
): Promise<Uint8Array> {
  // Prefer a server-supplied blockhash — the public mainnet RPC blocks browsers
  // (CORS / 403), so client-side getLatestBlockhash fails in production unless
  // VITE_SOLANA_RPC_URL is set to a paid provider. Fall back to client RPC only
  // if the server didn't include one.
  let blockhash = presetBlockhash;
  if (!blockhash) {
    const conn = new Connection(SOLANA_RPC_URL, 'confirmed');
    blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  }
  const sender = new PublicKey(senderAddress);
  const dest = new PublicKey(destAddress);
  const sourceAta = findAta(sender, USDC_MINT);
  const destAta = findAta(dest, USDC_MINT);
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = sender;
  // Ensure destination ATA exists (idempotent — no-op if already initialized)
  tx.add(createAtaIdempotentInstruction(sender, destAta, dest, USDC_MINT));
  tx.add(createUsdcTransferInstruction(sourceAta, destAta, sender, amountUsdc));
  return tx.serialize({ requireAllSignatures: false });
}

export function TopUpModal({ open, onClose, currentBalance, onSuccess }: Props) {
  const { walletAddress } = useAuthContext();
  const { wallets, signAndSendTransaction } = useSolanaWallet();

  const [selectedAmount, setSelectedAmount] = useState<number | null>(10);
  const [customAmount, setCustomAmount] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [chain, setChain] = useState<Chain>('solana');
  const [showChainDropdown, setShowChainDropdown] = useState(false);
  const [txState, setTxState] = useState<TxState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('qr');
  const [walletRejected, setWalletRejected] = useState(false);
  const [solanaPayUrl, setSolanaPayUrl] = useState('');
  const [intentId, setIntentId] = useState('');
  const qrRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const effectiveAmount = isCustom ? parseFloat(customAmount) || 0 : (selectedAmount ?? 0);
  const isValidAmount = effectiveAmount >= MIN_AMOUNT;

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    if (txState === 'building' || txState === 'signing' || txState === 'confirming') return;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setTxState('idle');
    setErrorMsg('');
    setTxHash('');
    setWalletRejected(false);
    setSolanaPayUrl('');
    setIntentId('');
    onClose();
  }, [txState, onClose]);

  const handlePreset = (amt: number) => {
    setIsCustom(false);
    setSelectedAmount(amt);
    setCustomAmount('');
    // Reset QR/error state when amount changes
    setSolanaPayUrl('');
    setIntentId('');
    setWalletRejected(false);
    setErrorMsg('');
    if (txState === 'error') setTxState('idle');
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleCustomFocus = () => {
    setIsCustom(true);
    setSelectedAmount(null);
  };

  /** Start polling intent status to detect Solana Pay payment via on-chain reference detection */
  const startStatusPolling = useCallback((currentBal: number, pollIntentId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let pollCount = 0;
    pollRef.current = setInterval(async () => {
      pollCount++;
      // Stop after 60 polls (~3 min at 3s intervals)
      if (pollCount > 60) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setErrorMsg('Payment not detected after 3 minutes. If you sent USDC, your balance will update shortly.');
        setTxState('error');
        return;
      }
      try {
        const result = await api.checkTopupStatus(pollIntentId);
        if (result.status === 'confirmed') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setTxState('success');
          onSuccess(currentBal);
          return;
        }
      } catch { /* ignore poll errors */ }
      // Fallback: also check balance directly
      try {
        const { balance_usdc } = await api.getBalance();
        if (balance_usdc > currentBal) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setTxState('success');
          onSuccess(currentBal);
        }
      } catch { /* ignore */ }
    }, 3000);
  }, [onSuccess]);

  /** Generate Solana Pay QR code / deep-link URL */
  const handleSolanaPayIntent = useCallback(async () => {
    if (!isValidAmount) return;
    setTxState('building');
    setErrorMsg('');

    try {
      const intent = await api.createTopupIntent(effectiveAmount, 'solana');
      setIntentId(intent.id);

      // The backend returns the full solana: URI
      const url = (intent as any).solana_pay_url as string;
      setSolanaPayUrl(url);

      if (payMethod === 'qr') {
        // Render QR code into the ref container
        setTxState('confirming');
        setTimeout(() => {
          if (qrRef.current) {
            qrRef.current.innerHTML = '';
            const qr = createQR(url, 220, 'transparent', 'white');
            qr.append(qrRef.current);
          }
        }, 50);
        // Poll for payment confirmation
        startStatusPolling(currentBalance ?? 0, intent.id);
      } else {
        // Mobile: open deep-link
        setTxState('confirming');
        window.location.href = url;
        startStatusPolling(currentBalance ?? 0, intent.id);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create payment. Please try again.');
      setTxState('error');
    }
  }, [effectiveAmount, isValidAmount, payMethod, currentBalance, startStatusPolling]);

  /** Direct wallet transfer via Privy (embedded wallet flow) */
  const handleSolanaWallet = useCallback(async () => {
    if (!walletAddress || !isValidAmount) return;
    const wallet = wallets[0];
    if (!wallet) {
      setErrorMsg('No Solana wallet connected. Please sign in with your wallet.');
      setTxState('error');
      return;
    }

    setTxState('building');
    setErrorMsg('');
    setWalletRejected(false);

    // 1. Create intent on backend
    let intent: Awaited<ReturnType<typeof api.createTopupIntent>>;
    try {
      intent = await api.createTopupIntent(effectiveAmount, 'solana');
    } catch (err: any) {
      console.error('[TopUp] Intent creation failed:', err);
      setErrorMsg(err?.message || 'Failed to create payment intent. Please try again.');
      setTxState('error');
      return;
    }

    // 2. Build unsigned transaction. Prefer the server-supplied blockhash —
    // the public mainnet RPC 403s browser requests, so falling back to a
    // browser-side getLatestBlockhash usually fails in prod.
    let txBytes: Uint8Array;
    try {
      console.log('[TopUp] Building tx:', {
        sender: walletAddress,
        dest: intent.dest_address,
        amount: effectiveAmount,
        usingServerBlockhash: !!intent.recent_blockhash,
      });
      txBytes = await buildSolanaUsdcTx(
        walletAddress,
        intent.dest_address,
        effectiveAmount,
        intent.recent_blockhash,
      );
      console.log('[TopUp] Tx built successfully, size:', txBytes.length, 'bytes');
    } catch (err: any) {
      console.error('[TopUp] Transaction build failed (RPC/blockhash):', err);
      setErrorMsg('Failed to connect to Solana network. Please try the QR code method instead.');
      setTxState('error');
      return;
    }

    // 3. Sign & send via Privy wallet
    setTxState('signing');
    console.log('[TopUp] Requesting wallet sign & send...');
    let hash: string;
    try {
      hash = await signAndSendTransaction(txBytes, walletAddress, SOLANA_CHAIN);
    } catch (sigErr: unknown) {
      console.error('[TopUp] Wallet sign/send failed:', sigErr);
      if (isWalletRejection(sigErr)) {
        setWalletRejected(true);
        setErrorMsg('Your wallet blocked this transaction. Try the QR code instead.');
      } else {
        const detail = (sigErr as any)?.message || (sigErr as any)?.error?.message || '';
        setErrorMsg(`Wallet failed to send: ${detail || 'unknown error'}. Try the QR code method instead.`);
      }
      setTxState('error');
      return;
    }
    console.log('[TopUp] Tx sent, hash:', hash);
    setTxHash(hash);

    // 5. Confirm with backend (only reached when signing succeeded)
    setTxState('confirming');
    try {
      console.log('[TopUp] Calling confirmTopup:', { hash, intentId: intent.id, hashLength: hash.length });
      await api.confirmTopup(hash, intent.id);
      setTxState('success');
      onSuccess(currentBalance ?? 0);
    } catch (err: any) {
      console.error('[TopUp] Backend confirmation failed:', err);
      // Transaction was sent on-chain — start polling for balance update
      setErrorMsg('Transaction sent but confirmation pending. Your balance will update shortly.');
      setTxState('error');
      // Start polling as fallback — the Helius webhook or next status check should credit it
      startStatusPolling(currentBalance ?? 0, intent.id);
    }
  }, [walletAddress, wallets, signAndSendTransaction, effectiveAmount, isValidAmount, currentBalance, onSuccess, startStatusPolling]);

  const handleBaseManualConfirm = useCallback(async (manualTxHash: string) => {
    if (!manualTxHash.trim()) return;
    setTxState('confirming');
    try {
      const intent = await api.createTopupIntent(effectiveAmount, 'base');
      await api.confirmTopup(manualTxHash.trim(), intent.id);
      setTxHash(manualTxHash.trim());
      setTxState('success');
      onSuccess(currentBalance ?? 0);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Confirmation failed. Please try again.');
      setTxState('error');
    }
  }, [effectiveAmount, currentBalance, onSuccess]);

  const handleSend = () => {
    if (chain === 'solana') {
      if (payMethod === 'wallet') {
        handleSolanaWallet();
      } else {
        handleSolanaPayIntent();
      }
    }
    // Base: handled inline in the UI
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={handleClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 p-5"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-medium text-white">Top Up USDC</h2>
                {currentBalance !== null && (
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Current balance: <span className="text-zinc-300">${currentBalance.toFixed(2)}</span>
                  </p>
                )}
              </div>
              <button
                onClick={handleClose}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                disabled={txState === 'building' || txState === 'signing' || txState === 'confirming'}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Success State */}
            {txState === 'success' ? (
              <div className="text-center py-4 space-y-3">
                <CheckCircle className="h-10 w-10 text-green-400 mx-auto" />
                <p className="text-sm text-white font-medium">Top-up submitted!</p>
                <p className="text-[11px] text-zinc-400">
                  Your USDC transfer has been received. Balance will update shortly.
                </p>
                {txHash && (
                  <div className="bg-zinc-800 rounded-lg px-3 py-2 text-[9px] text-zinc-500 font-mono break-all">
                    {txHash.slice(0, 12)}…{txHash.slice(-8)}
                  </div>
                )}
                <button
                  onClick={handleClose}
                  className="mt-2 w-full py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-[12px] rounded-lg transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                {/* Amount presets */}
                <div className="mb-4">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Amount (USDC)</p>
                  <div className="flex gap-2 mb-2">
                    {PRESET_AMOUNTS.map((amt) => (
                      <button
                        key={amt}
                        onClick={() => handlePreset(amt)}
                        className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-colors border ${
                          !isCustom && selectedAmount === amt
                            ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
                        }`}
                      >
                        ${amt}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={MIN_AMOUNT}
                    step="0.01"
                    placeholder={`Custom (min $${MIN_AMOUNT})`}
                    value={customAmount}
                    onFocus={handleCustomFocus}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className={`w-full bg-zinc-800 border rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-zinc-600 outline-none transition-colors ${
                      isCustom ? 'border-blue-500/50' : 'border-zinc-700 focus:border-zinc-500'
                    }`}
                  />
                  {isCustom && effectiveAmount > 0 && effectiveAmount < MIN_AMOUNT && (
                    <p className="text-[10px] text-red-400 mt-1">Minimum top-up is $1 USDC</p>
                  )}
                </div>

                {/* Chain selector */}
                <div className="mb-5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Network</p>
                  <div className="relative">
                    <button
                      onClick={() => setShowChainDropdown((v) => !v)}
                      className="w-full flex items-center justify-between bg-zinc-800 border border-zinc-700 hover:bg-zinc-750 rounded-lg px-3 py-2 text-[12px] text-zinc-300 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        {chain === 'solana' ? (
                          <><span className="text-purple-400">◆</span> Solana (recommended)</>
                        ) : (
                          <><span className="text-blue-400">⬡</span> Base</>
                        )}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                    </button>
                    <AnimatePresence>
                      {showChainDropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          className="absolute top-full mt-1 left-0 right-0 bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden z-10 shadow-lg"
                        >
                          <button
                            onClick={() => { setChain('solana'); setShowChainDropdown(false); }}
                            className={`w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 transition-colors ${chain === 'solana' ? 'text-white bg-zinc-700' : 'text-zinc-300 hover:bg-zinc-700'}`}
                          >
                            <span className="text-purple-400">◆</span>
                            <div>
                              <div>Solana</div>
                              <div className="text-[9px] text-zinc-500">USDC · ~30 sec confirmation</div>
                            </div>
                          </button>
                          <button
                            onClick={() => { setChain('base'); setShowChainDropdown(false); }}
                            className={`w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 transition-colors ${chain === 'base' ? 'text-white bg-zinc-700' : 'text-zinc-300 hover:bg-zinc-700'}`}
                          >
                            <span className="text-blue-400">⬡</span>
                            <div>
                              <div>Base</div>
                              <div className="text-[9px] text-zinc-500">USDC · ~2 min confirmation</div>
                            </div>
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Error */}
                {txState === 'error' && (
                  <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-red-400">{errorMsg}</p>
                    </div>
                    {walletRejected && chain === 'solana' && (
                      <button
                        onClick={() => {
                          setPayMethod('qr');
                          setTxState('idle');
                          setErrorMsg('');
                          setWalletRejected(false);
                        }}
                        className="w-full py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 text-[11px] rounded-lg transition-colors flex items-center justify-center gap-1.5"
                      >
                        <QrCode className="h-3 w-3" /> Switch to QR Code instead
                      </button>
                    )}
                  </div>
                )}

                {/* Solana: payment method toggle + send/QR */}
                {chain === 'solana' && (
                  <div className="space-y-3">
                    {/* Method toggle */}
                    {(txState === 'idle' || txState === 'error') && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setPayMethod('qr')}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${
                              payMethod === 'qr'
                                ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-300'
                            }`}
                          >
                            <QrCode className="h-3 w-3" /> QR Code
                          </button>
                          <button
                            onClick={() => setPayMethod('wallet')}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors border ${
                              payMethod === 'wallet'
                                ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-300'
                            }`}
                          >
                            <Smartphone className="h-3 w-3" /> Wallet
                          </button>
                        </div>
                        {payMethod === 'qr' && (
                          <p className="text-[10px] text-zinc-500">
                            Scan with your mobile wallet app — works even if your browser wallet is blocked.
                          </p>
                        )}
                      </div>
                    )}

                    {/* QR code display (shown while confirming with QR method) */}
                    {payMethod === 'qr' && txState === 'confirming' && (
                      <div className="flex flex-col items-center space-y-2">
                        <div ref={qrRef} className="bg-white rounded-xl p-2" />
                        <p className="text-[10px] text-zinc-400">Scan with any Solana wallet to pay</p>
                        <div className="flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                          <p className="text-[10px] text-blue-400">Waiting for payment…</p>
                        </div>
                      </div>
                    )}

                    {/* Send button (wallet mode) or Generate QR button */}
                    {txState !== 'confirming' || payMethod !== 'qr' ? (
                      <button
                        onClick={handleSend}
                        disabled={!isValidAmount || txState === 'building' || txState === 'signing' || txState === 'confirming'}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white disabled:cursor-not-allowed text-[13px] font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        {txState === 'building' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating payment…</>}
                        {txState === 'signing' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for signature…</>}
                        {txState === 'confirming' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Confirming…</>}
                        {(txState === 'idle' || txState === 'error') && payMethod === 'wallet' && <>Send ${effectiveAmount > 0 ? effectiveAmount.toFixed(2) : '—'} USDC</>}
                        {(txState === 'idle' || txState === 'error') && payMethod === 'qr' && <>Generate QR Code</>}
                      </button>
                    ) : null}
                  </div>
                )}

                {/* Base: manual flow */}
                {chain === 'base' && <BaseManualFlow amount={effectiveAmount} isValid={isValidAmount} onConfirm={handleBaseManualConfirm} txState={txState} copyToClipboard={copyToClipboard} copied={copied} />}

                <p className="text-[9px] text-zinc-600 text-center mt-3">
                  Minimum ${MIN_AMOUNT} USDC · Transfers are non-refundable
                </p>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function BaseManualFlow({
  amount,
  isValid,
  onConfirm,
  txState,
  copyToClipboard,
  copied,
}: {
  amount: number;
  isValid: boolean;
  onConfirm: (txHash: string) => void;
  txState: TxState;
  copyToClipboard: (text: string) => void;
  copied: boolean;
}) {
  const [manualHash, setManualHash] = useState('');
  const [step, setStep] = useState<'instructions' | 'confirm'>('instructions');

  if (!isValid) {
    return (
      <button disabled className="w-full py-2.5 bg-zinc-700 text-zinc-500 cursor-not-allowed text-[13px] font-medium rounded-lg">
        Enter amount to continue
      </button>
    );
  }

  if (step === 'instructions') {
    return (
      <div className="space-y-3">
        <div className="bg-zinc-800 rounded-lg p-3 space-y-2">
          <p className="text-[10px] text-zinc-400">Send exactly <span className="text-white font-mono">{amount.toFixed(2)} USDC</span> to:</p>
          <div className="flex items-center gap-2">
            <code className="text-[10px] text-zinc-300 font-mono break-all flex-1">{BASE_DEST}</code>
            <button onClick={() => copyToClipboard(BASE_DEST)} className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0">
              {copied ? <CheckCircle className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="text-[9px] text-zinc-500">Base network · USDC only</p>
        </div>
        <button
          onClick={() => setStep('confirm')}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-medium rounded-lg transition-colors"
        >
          I've sent the USDC
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] text-zinc-400 mb-1.5">Paste your transaction hash</p>
        <input
          type="text"
          placeholder="0x..."
          value={manualHash}
          onChange={(e) => setManualHash(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 focus:border-blue-500/50 rounded-lg px-3 py-2 text-[11px] text-white font-mono placeholder:text-zinc-600 outline-none transition-colors"
        />
      </div>
      <button
        onClick={() => onConfirm(manualHash)}
        disabled={!manualHash.trim() || txState === 'confirming'}
        className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed text-white text-[13px] font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {txState === 'confirming' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Confirming…</> : 'Confirm Top-Up'}
      </button>
    </div>
  );
}
