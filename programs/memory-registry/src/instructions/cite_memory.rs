use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{Pool, PoolMemoryRecord, CitationRecord};
use crate::errors::RegistryError;

#[derive(Accounts)]
pub struct CiteMemory<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.namespace.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [b"pool_mem", pool.key().as_ref(), &memory.memory_id.to_le_bytes()],
        bump = memory.bump,
        has_one = pool
    )]
    pub memory: Account<'info, PoolMemoryRecord>,

    /// Citation PDA seeded by memory.citation_count BEFORE increment.
    /// Client must read memory.citation_count before calling to derive
    /// the same PDA. Uniqueness: a second cite attempt at the same
    /// citation_count value fails with AccountAlreadyInUse.
    #[account(
        init,
        payer = citer,
        space = 8 + CitationRecord::INIT_SPACE,
        seeds = [b"citation", memory.key().as_ref(), &memory.citation_count.to_le_bytes()],
        bump
    )]
    pub citation: Account<'info, CitationRecord>,

    #[account(mut)]
    pub citer_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub author_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub citer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CiteMemory>) -> Result<()> {
    // Disallow self-citation (author citing own memory)
    require!(
        ctx.accounts.citer.key() != ctx.accounts.memory.author,
        RegistryError::SelfCitation
    );

    let royalty = ctx.accounts.pool.citation_fee;

    // Transfer $CLUDE citer → author (MVP: 100% to author; spec §5.3 calls for
    // 50/50 author/treasury split, deferred post-hackathon — see
    // HONEST_LIMITATIONS.md)
    let cpi_accounts = Transfer {
        from: ctx.accounts.citer_token_account.to_account_info(),
        to: ctx.accounts.author_token_account.to_account_info(),
        authority: ctx.accounts.citer.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token::transfer(cpi_ctx, royalty)?;

    // Record citation
    let citation = &mut ctx.accounts.citation;
    citation.pool = ctx.accounts.pool.key();
    citation.memory_pda = ctx.accounts.memory.key();
    citation.citer = ctx.accounts.citer.key();
    citation.author = ctx.accounts.memory.author;
    citation.timestamp = Clock::get()?.unix_timestamp;
    citation.royalty_paid = royalty;
    citation.bump = ctx.bumps.citation;
    citation._reserved = [0; 8];

    // Increment counters (borrow pool + memory mutably here, after the immutable
    // borrows for the transfer CPI are released)
    let memory = &mut ctx.accounts.memory;
    memory.citation_count = memory.citation_count.saturating_add(1);
    memory.earnings = memory.earnings.saturating_add(royalty);
    let pool = &mut ctx.accounts.pool;
    pool.citation_count = pool.citation_count.saturating_add(1);

    msg!("Citation recorded: royalty={}", royalty);
    Ok(())
}
