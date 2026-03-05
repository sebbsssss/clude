use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// Placeholder — replace with actual program ID after `anchor keys list`
declare_id!("MemRYEnFVuMPH8qQd4W5Rk2dkNFUsRkqDRyEGfP9uZ");

#[program]
pub mod memory_registry {
    use super::*;

    /// Create a new memory registry PDA for the signing wallet.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Register a memory's content hash in the on-chain registry.
    pub fn register_memory(
        ctx: Context<RegisterMemory>,
        content_hash: [u8; 32],
        memory_type: u8,
        importance_tier: u8,
        memory_id: u64,
        encrypted: bool,
    ) -> Result<()> {
        instructions::register_memory::handler(
            ctx,
            content_hash,
            memory_type,
            importance_tier,
            memory_id,
            encrypted,
        )
    }

    /// Verify a content hash exists in the registry (read-only).
    pub fn verify_memory(ctx: Context<VerifyMemory>, content_hash: [u8; 32]) -> Result<()> {
        instructions::verify_memory::handler(ctx, content_hash)
    }
}
