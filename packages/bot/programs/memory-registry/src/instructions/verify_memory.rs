use anchor_lang::prelude::*;
use crate::state::MemoryRegistry;
use crate::errors::RegistryError;

#[derive(Accounts)]
#[instruction(content_hash: [u8; 32])]
pub struct VerifyMemory<'info> {
    #[account(
        seeds = [b"memory-registry", authority.key().as_ref()],
        bump = registry.bump,
        has_one = authority,
    )]
    pub registry: Account<'info, MemoryRegistry>,
    /// CHECK: Authority used for PDA derivation only (read-only verification).
    pub authority: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<VerifyMemory>, content_hash: [u8; 32]) -> Result<()> {
    let registry = &ctx.accounts.registry;

    for entry in &registry.entries {
        if entry.content_hash == content_hash {
            return Ok(());
        }
    }

    Err(RegistryError::HashNotFound.into())
}
