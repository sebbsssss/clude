use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// Program ID — generated via `anchor keys list`
declare_id!("GPc2p7rNNC23kd396zKgsCCTsRH1H3APxDUDRXLTVfdo");

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

    /// Create a new shared memory pool with configurable write + citation fees.
    pub fn create_pool(
        ctx: Context<CreatePool>,
        namespace: [u8; 32],
        write_fee: u64,
        citation_fee: u64,
    ) -> Result<()> {
        instructions::create_pool::handler(ctx, namespace, write_fee, citation_fee)
    }

    /// Store a memory into a shared pool. Author pays pool.write_fee in $CLUDE
    /// to the pool treasury ATA.
    pub fn store_memory_in_pool(
        ctx: Context<StoreMemoryInPool>,
        content_hash: [u8; 32],
        memory_id: u64,
    ) -> Result<()> {
        instructions::store_memory_in_pool::handler(ctx, content_hash, memory_id)
    }

    /// Cite a memory in a shared pool. Citer pays pool.citation_fee in $CLUDE
    /// to the memory's original author (royalty). Self-citation disallowed.
    pub fn cite_memory(ctx: Context<CiteMemory>) -> Result<()> {
        instructions::cite_memory::handler(ctx)
    }
}
