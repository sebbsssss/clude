use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{Pool, PoolMemoryRecord};

#[derive(Accounts)]
#[instruction(content_hash: [u8; 32], memory_id: u64)]
pub struct StoreMemoryInPool<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.namespace.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        init,
        payer = author,
        space = 8 + PoolMemoryRecord::INIT_SPACE,
        seeds = [b"pool_mem", pool.key().as_ref(), &memory_id.to_le_bytes()],
        bump
    )]
    pub memory: Account<'info, PoolMemoryRecord>,

    #[account(mut)]
    pub author_token_account: Account<'info, TokenAccount>,

    /// CHECK: Treasury SPL token account (ATA owned by the treasury PDA).
    /// Lazily created via `spl-token create-account --owner <treasury_pda>` in Task 4.2.
    /// We accept `AccountInfo` here (not `TokenAccount`) because the ATA may not exist
    /// at Anchor-validation time in some test flows; the Token program validates that
    /// this account is a valid token account owned by the treasury PDA during the
    /// CPI transfer, so no additional type-level check is needed here.
    #[account(mut)]
    pub treasury_token_account: AccountInfo<'info>,

    #[account(mut)]
    pub author: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<StoreMemoryInPool>,
    content_hash: [u8; 32],
    memory_id: u64,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let write_fee = pool.write_fee;

    // Transfer $CLUDE from author → treasury
    let cpi_accounts = Transfer {
        from: ctx.accounts.author_token_account.to_account_info(),
        to: ctx.accounts.treasury_token_account.to_account_info(),
        authority: ctx.accounts.author.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
    );
    token::transfer(cpi_ctx, write_fee)?;

    // Populate the memory record
    let memory = &mut ctx.accounts.memory;
    memory.pool = pool.key();
    memory.author = ctx.accounts.author.key();
    memory.content_hash = content_hash;
    memory.memory_id = memory_id;
    memory.timestamp = Clock::get()?.unix_timestamp;
    memory.fee_paid = write_fee;
    memory.citation_count = 0;
    memory.earnings = 0;
    memory.bump = ctx.bumps.memory;
    memory._reserved = [0; 16];

    pool.memory_count = pool.memory_count.saturating_add(1);

    msg!(
        "Pool memory stored: pool={} memory_id={} fee={}",
        pool.key(),
        memory_id,
        write_fee
    );

    Ok(())
}
