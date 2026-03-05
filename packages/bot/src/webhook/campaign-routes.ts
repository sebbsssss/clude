import { Router, Request, Response } from 'express';
import { createChildLogger } from '../core/logger';
import { getDb } from '../core/database';
import { randomInt } from 'crypto';
import rateLimit from 'express-rate-limit';

const log = createChildLogger('campaign-routes');

// Day metadata (same as frontend)
const CAMPAIGN_DAYS = [
  { day: 1, name: 'SPARK', subtitle: 'Top 10 Educational Tweets', type: 'content', restriction: 'Top 100 Holders Only' },
  { day: 2, name: 'DOPAMINE RUSH', subtitle: '3x Gacha Machine', type: 'gacha', restriction: 'Open to All' },
  { day: 3, name: 'CORE MEMORY', subtitle: 'Top 10 Longform Articles', type: 'content', restriction: 'Open to All' },
  { day: 4, name: 'FIRST NODE', subtitle: 'Grant 1 Reveal', type: 'grant', restriction: 'Hackathon' },
  { day: 5, name: 'VISUAL CORTEX', subtitle: 'Top 10 Video Content', type: 'content', restriction: 'Open to All' },
  { day: 6, name: 'MOBILE NODES', subtitle: 'Grant 2 Reveal', type: 'grant', restriction: 'Hackathon' },
  { day: 7, name: 'NETWORK LINK', subtitle: 'Seeker Airdrop / Rewards', type: 'special', restriction: 'Grant 2 Partner' },
  { day: 8, name: 'HYPE-DRIVE', subtitle: '10x Gacha Machine', type: 'gacha', restriction: 'Open to All' },
  { day: 9, name: 'GROWTH NODES', subtitle: 'Grant 3 Reveal', type: 'grant', restriction: 'Hackathon' },
  { day: 10, name: 'PEAK INTELLIGENCE', subtitle: '10M Airdrop to Top 10 Holders', type: 'special', restriction: 'Snapshot' },
];

// Gacha rate limit: 1 spin per IP per minute
const gachaLimiter = rateLimit({
  windowMs: 60_000,
  max: 1,
  message: { error: 'One spin per minute. Take a breath.' },
});

export function campaignRoutes(): Router {
  const router = Router();

  // GET /api/campaign/state — overall campaign status
  router.get('/state', async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const { data: state } = await db
        .from('campaign_state')
        .select('*')
        .eq('id', 1)
        .single();

      if (!state) {
        res.json({ isActive: false, currentDay: 0, days: CAMPAIGN_DAYS });
        return;
      }

      // Get per-day token distribution totals
      const { data: tweetTotals } = await db
        .from('campaign_tweets')
        .select('campaign_day, tokens_awarded')
        .gt('tokens_awarded', 0);

      const { data: gachaTotals } = await db
        .from('campaign_gacha')
        .select('campaign_day, payout')
        .eq('win', true);

      // Build per-day token sums
      const dayTokens: Record<number, number> = {};
      for (const t of tweetTotals || []) {
        dayTokens[t.campaign_day] = (dayTokens[t.campaign_day] || 0) + t.tokens_awarded;
      }
      for (const g of gachaTotals || []) {
        dayTokens[g.campaign_day] = (dayTokens[g.campaign_day] || 0) + g.payout;
      }

      const days = CAMPAIGN_DAYS.map(d => ({
        ...d,
        status: d.day < state.current_day ? 'completed' :
                d.day === state.current_day ? 'active' : 'upcoming',
        tokensAwarded: dayTokens[d.day] || 0,
      }));

      res.json({
        campaignStart: state.campaign_start,
        campaignEnd: state.campaign_end,
        currentDay: state.current_day,
        isActive: state.is_active,
        totalTokensDistributed: state.total_tokens_distributed,
        totalTokensBudget: 100_000_000,
        days,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to get campaign state');
      res.status(500).json({ error: 'Failed to get campaign state' });
    }
  });

  // GET /api/campaign/leaderboard?day=N — top 10 tweets by engagement
  router.get('/leaderboard', async (req: Request, res: Response) => {
    try {
      const day = parseInt(req.query.day as string) || 1;
      const db = getDb();

      const { data: tweets, error } = await db
        .from('campaign_tweets')
        .select('*')
        .eq('campaign_day', day)
        .eq('is_eligible', true)
        .order('engagement_score', { ascending: false })
        .limit(10);

      if (error) {
        log.error({ error: error.message }, 'Leaderboard query failed');
        res.status(500).json({ error: 'Query failed' });
        return;
      }

      const dayMeta = CAMPAIGN_DAYS.find(d => d.day === day);

      res.json({
        day,
        dayName: dayMeta?.name || '',
        tweets: (tweets || []).map((t, i) => ({
          rank: i + 1,
          tweetId: t.tweet_id,
          authorUsername: t.author_username || 'unknown',
          text: t.text,
          likes: t.likes,
          retweets: t.retweets,
          replies: t.replies,
          quotes: t.quotes,
          engagementScore: t.engagement_score,
          isHolder: t.is_holder,
          tokensAwarded: t.tokens_awarded,
        })),
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to get leaderboard');
      res.status(500).json({ error: 'Failed to get leaderboard' });
    }
  });

  // GET /api/campaign/tweets?day=N&limit=20&offset=0 — all tracked tweets
  router.get('/tweets', async (req: Request, res: Response) => {
    try {
      const day = parseInt(req.query.day as string) || 0;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = parseInt(req.query.offset as string) || 0;
      const db = getDb();

      let query = db
        .from('campaign_tweets')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (day > 0) query = query.eq('campaign_day', day);

      const { data: tweets, count, error } = await query;

      if (error) {
        res.status(500).json({ error: 'Query failed' });
        return;
      }

      res.json({
        day,
        tweets: (tweets || []).map(t => ({
          tweetId: t.tweet_id,
          authorUsername: t.author_username || 'unknown',
          text: t.text,
          likes: t.likes,
          retweets: t.retweets,
          replies: t.replies,
          quotes: t.quotes,
          engagementScore: t.engagement_score,
          isHolder: t.is_holder,
          campaignDay: t.campaign_day,
          createdAt: t.created_at,
        })),
        total: count || 0,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to get campaign tweets');
      res.status(500).json({ error: 'Failed to get tweets' });
    }
  });

  // GET /api/campaign/grants — hackathon grant status
  router.get('/grants', async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const { data: grants, error } = await db
        .from('campaign_grants')
        .select('*')
        .order('grant_number', { ascending: true });

      if (error) {
        res.status(500).json({ error: 'Query failed' });
        return;
      }

      res.json({
        grants: (grants || []).map(g => ({
          grantNumber: g.grant_number,
          revealDay: g.reveal_day,
          projectName: g.is_revealed ? g.project_name : '',
          projectUrl: g.is_revealed ? g.project_url : '',
          pfpImageUrl: g.is_revealed ? g.pfp_image_url : '',
          description: g.is_revealed ? g.description : '',
          amount: g.amount,
          isRevealed: g.is_revealed,
          revealedAt: g.revealed_at,
        })),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Failed to get grants');
      res.status(500).json({ error: 'Failed to get grants' });
    }
  });

  // POST /api/campaign/gacha/spin — process a gacha attempt
  router.post('/gacha/spin', gachaLimiter, async (req: Request, res: Response) => {
    try {
      const { wallet_address, x_handle, campaign_day } = req.body;

      if (!wallet_address || !campaign_day) {
        res.status(400).json({ error: 'Missing wallet_address or campaign_day' });
        return;
      }

      const day = parseInt(campaign_day);
      if (day !== 2 && day !== 8) {
        res.status(400).json({ error: 'Gacha only available on days 2 and 8' });
        return;
      }

      const db = getDb();

      // Check campaign is active and on the right day
      const { data: state } = await db
        .from('campaign_state')
        .select('current_day, is_active')
        .eq('id', 1)
        .single();

      if (!state?.is_active || state.current_day !== day) {
        res.status(400).json({ error: 'Gacha is not active today' });
        return;
      }

      // Check wallet hasn't already spun today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data: existing } = await db
        .from('campaign_gacha')
        .select('id')
        .eq('wallet_address', wallet_address)
        .eq('campaign_day', day)
        .gte('created_at', today.toISOString())
        .limit(1);

      if (existing && existing.length > 0) {
        res.status(400).json({ error: 'Already spun today. Come back tomorrow.' });
        return;
      }

      // Determine outcome
      const roll = randomInt(0, 100);
      const winThreshold = day === 2 ? 50 : 15;
      const multiplier = day === 2 ? 3 : 10;
      const betAmount = 1000;
      const win = roll < winThreshold;
      const payout = win ? betAmount * multiplier : 0;

      // Record the spin
      await db.from('campaign_gacha').insert({
        campaign_day: day,
        wallet_address,
        x_handle: x_handle || null,
        bet_amount: betAmount,
        multiplier,
        win,
        payout,
      });

      // Update total distributed if win
      if (win) {
        const { data: currentState } = await db
          .from('campaign_state')
          .select('total_tokens_distributed')
          .eq('id', 1)
          .single();

        if (currentState) {
          await db
            .from('campaign_state')
            .update({
              total_tokens_distributed: currentState.total_tokens_distributed + payout,
            })
            .eq('id', 1);
        }
      }

      log.info({ wallet_address, day, win, payout, roll }, 'Gacha spin processed');

      res.json({
        win,
        multiplier,
        betAmount,
        payout,
        message: win
          ? `${multiplier}x! ${payout.toLocaleString()} $CLUDE incoming.`
          : 'Better luck next time.',
      });
    } catch (err) {
      log.error({ err }, 'Gacha spin failed');
      res.status(500).json({ error: 'Spin failed' });
    }
  });

  // GET /api/campaign/gacha/history?day=N — recent spins + stats
  router.get('/gacha/history', async (req: Request, res: Response) => {
    try {
      const day = parseInt(req.query.day as string) || 2;
      const db = getDb();

      const { data: spins } = await db
        .from('campaign_gacha')
        .select('*')
        .eq('campaign_day', day)
        .order('created_at', { ascending: false })
        .limit(20);

      // Aggregate stats
      const { data: allSpins } = await db
        .from('campaign_gacha')
        .select('win, payout')
        .eq('campaign_day', day);

      const totalSpins = allSpins?.length || 0;
      const totalWins = allSpins?.filter(s => s.win).length || 0;
      const totalPaidOut = allSpins?.reduce((sum, s) => sum + (s.payout || 0), 0) || 0;

      res.json({
        day,
        spins: (spins || []).map(s => ({
          xHandle: s.x_handle || 'anon',
          win: s.win,
          multiplier: s.multiplier,
          payout: s.payout,
          createdAt: s.created_at,
        })),
        stats: {
          totalSpins,
          totalWins,
          totalPaidOut,
          winRate: totalSpins > 0 ? totalWins / totalSpins : 0,
        },
      });
    } catch (err) {
      log.error({ err }, 'Failed to get gacha history');
      res.status(500).json({ error: 'Failed to get gacha history' });
    }
  });

  return router;
}
