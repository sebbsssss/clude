import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown, CheckCircle, AlertCircle, Copy, Loader2 } from 'lucide-react';
import { useWallets } from '@privy-io/react-auth/solana';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { api } from '../lib/api';
import { useAuthContext } from '../hooks/AuthContext';

interface Props {
  open: boolean;
  onClose: () => void;
  currentBalance: number | null;
  onSuccess: (previousBalance: number) => void;
}

type Chain = 'solana' | 'base';
type TxState = 'idle' | 'building' | 'signing' | 'confirming' | 'success' | 'error';

const PRESET_AMOUNTS = [5, 10, 50] as const;
const MIN_AMOUNT = 1;

// Solana constants
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bJ8');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const BASE_DEST = '0x48346152f7AaF4c645e939fC21Db0F9da287975d';

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
  const amount = BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0); // Transfer instruction index
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function buildSolanaUsdcTx(senderAddress: string, destAddress: string, amountUsdc: number): Promise<Uint8Array> {
  const conn = new Connection(SOLANA_RPC, 'confirmed');
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const sender = new PublicKey(senderAddress);
  const dest = new PublicKey(destAddress);
  const sourceAta = findAta(sender, USDC_MINT);
  const destAta = findAta(dest, USDC_MINT);
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = sender;
  tx.add(createUsdcTransferInstruction(sourceAta, destAta, sender, amountUsdc));
  return tx.serialize({ requireAllSignatures: false });
}

export function TopUpModal({ open, onClose, currentBalance, onSuccess }: Props) {
  const { walletAddress } = useAuthContext();
  const { wallets } = useWallets();

  const [selectedAmount, setSelectedAmount] = useState<number | null>(10);
  const [customAmount, setCustomAmount] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [chain, setChain] = useState<Chain>('solana');
  const [showChainDropdown, setShowChainDropdown] = useState(false);
  const [txState, setTxState] = useState<TxState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState(false);

  const effectiveAmount = isCustom ? parseFloat(customAmount) || 0 : (selectedAmount ?? 0);
  const isValidAmount = effectiveAmount >= MIN_AMOUNT;

  const handleClose = useCallback(() => {
    if (txState === 'building' || txState === 'signing' || txState === 'confirming') return;
    setTxState('idle');
    setErrorMsg('');
    setTxHash('');
    onClose();
  }, [txState, onClose]);

  const handlePreset = (amt: number) => {
    setIsCustom(false);
    setSelectedAmount(amt);
    setCustomAmount('');
  };

  const handleCustomFocus = () => {
    setIsCustom(true);
    setSelectedAmount(null);
  };

  const handleSolana = useCallback(async () => {
    if (!walletAddress || !isValidAmount) return;
    const wallet = wallets[0];
    if (!wallet) {
      setErrorMsg('No Solana wallet connected. Please sign in with your wallet.');
      setTxState('error');
      return;
    }

    setTxState('building');
    setErrorMsg('');

    try {
      // 1. Create intent on backend
      const intent = await api.createTopupIntent(effectiveAmount, 'solana');

      // 2. Build unsigned transaction
      const txBytes = await buildSolanaUsdcTx(walletAddress, intent.dest_address, effectiveAmount);

      // 3. Sign & send via Privy wallet
      setTxState('signing');
      const { signature } = await wallet.signAndSendTransaction({
        transaction: txBytes,
        chain: 'solana:mainnet',
      });
      const hash = bs58.encode(signature);
      setTxHash(hash);

      // 4. Confirm with backend
      setTxState('confirming');
      await api.confirmTopup(hash, intent.id);

      setTxState('success');
      onSuccess(currentBalance ?? 0);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Transaction failed. Please try again.');
      setTxState('error');
    }
  }, [walletAddress, wallets, effectiveAmount, isValidAmount, currentBalance, onSuccess]);

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
      handleSolana();
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
                  <div className="mb-4 flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                    <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-red-400">{errorMsg}</p>
                  </div>
                )}

                {/* Solana send button */}
                {chain === 'solana' && (
                  <button
                    onClick={handleSend}
                    disabled={!isValidAmount || txState === 'building' || txState === 'signing' || txState === 'confirming'}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white disabled:cursor-not-allowed text-[13px] font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {txState === 'building' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Building transaction…</>}
                    {txState === 'signing' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for signature…</>}
                    {txState === 'confirming' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Confirming…</>}
                    {(txState === 'idle' || txState === 'error') && <>Send ${effectiveAmount > 0 ? effectiveAmount.toFixed(2) : '—'} USDC</>}
                  </button>
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
