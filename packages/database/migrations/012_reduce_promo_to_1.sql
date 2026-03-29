-- Reduce free promo credit from $5 to $1 and reset all existing balances
-- Exempt wallets keep their current balance
-- Run this on Supabase Dashboard SQL editor after merging

BEGIN;

UPDATE chat_balances
SET
  balance_usdc = 1,
  total_deposited = CASE
    WHEN total_spent = 0 THEN 1
    ELSE total_spent + 1
  END,
  updated_at = NOW()
WHERE wallet_address NOT IN (
  'HdKoTAPdHR3hKfaP1CBSMdjPVXfX2uD3PzBzXuX88GV4',
  '5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r'
);

COMMIT;
