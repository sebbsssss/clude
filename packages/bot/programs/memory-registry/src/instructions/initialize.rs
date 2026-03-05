use anchor_lang::prelude::*;
use crate::state::MemoryRegistry;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = MemoryRegistry::space_for(MemoryRegistry::INITIAL_CAPACITY),
        seeds = [b"memory-registry", authority.key().as_ref()],
        bump,
    )]
    pub registry: Account<'info, MemoryRegistry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    registry.authority = ctx.accounts.authority.key();
    registry.memory_count = 0;
    registry.bump = ctx.bumps.registry;
    registry.entries = Vec::with_capacity(MemoryRegistry::INITIAL_CAPACITY);
    Ok(())
}
