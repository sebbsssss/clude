use anchor_lang::prelude::*;
use crate::state::{MemoryEntry, MemoryRegistry};
use crate::errors::RegistryError;

#[derive(Accounts)]
pub struct RegisterMemory<'info> {
    #[account(
        mut,
        seeds = [b"memory-registry", authority.key().as_ref()],
        bump = registry.bump,
        has_one = authority,
        realloc = MemoryRegistry::space_for(
            registry.entries.len() + 1
                + if registry.entries.len() + 1 > registry.entries.capacity() {
                    MemoryRegistry::REALLOC_INCREMENT
                } else {
                    0
                }
        ),
        realloc::payer = authority,
        realloc::zero = false,
    )]
    pub registry: Account<'info, MemoryRegistry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterMemory>,
    content_hash: [u8; 32],
    memory_type: u8,
    importance_tier: u8,
    memory_id: u64,
    encrypted: bool,
) -> Result<()> {
    require!(memory_type <= 3, RegistryError::InvalidMemoryType);

    let registry = &mut ctx.accounts.registry;

    // Check for duplicate hash
    for entry in &registry.entries {
        if entry.content_hash == content_hash {
            return Err(RegistryError::DuplicateHash.into());
        }
    }

    let clock = Clock::get()?;

    registry.entries.push(MemoryEntry {
        content_hash,
        timestamp: clock.unix_timestamp,
        memory_type,
        importance_tier,
        memory_id,
        encrypted,
        _padding: [0; 3],
    });

    registry.memory_count = registry.entries.len() as u64;

    Ok(())
}
