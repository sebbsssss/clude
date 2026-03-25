-- One-time backfill: credit existing users with less than $5 balance up to $5
-- Run this once when enabling the free promo (FREE_PROMO_ENABLED=true)
-- Safe to re-run: GREATEST ensures balance never decreases

UPDATE chat_balances
SET balance_usdc = GREATEST(balance_usdc, 5),
    total_deposited = total_deposited + (5 - balance_usdc),
    updated_at = NOW()
WHERE balance_usdc < 5;
