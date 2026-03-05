use anchor_lang::prelude::*;

/// On-chain memory registry PDA — stores content hashes + metadata per wallet.
/// Seeds: ["memory-registry", authority]
#[account]
pub struct MemoryRegistry {
    /// Wallet that owns this registry.
    pub authority: Pubkey,
    /// Number of memory entries stored.
    pub memory_count: u64,
    /// PDA bump seed.
    pub bump: u8,
    /// Variable-length list of memory entries.
    pub entries: Vec<MemoryEntry>,
}

impl MemoryRegistry {
    /// Base size: discriminator(8) + authority(32) + memory_count(8) + bump(1) + vec_prefix(4)
    pub const BASE_SIZE: usize = 8 + 32 + 8 + 1 + 4;

    /// Size per entry (aligned): hash(32) + timestamp(8) + memory_type(1) + importance_tier(1)
    /// + memory_id(8) + encrypted(1) = 51, padded to 56 for alignment
    pub const ENTRY_SIZE: usize = 56;

    /// Initial capacity (entries).
    pub const INITIAL_CAPACITY: usize = 50;

    /// Entries added per realloc.
    pub const REALLOC_INCREMENT: usize = 10;

    /// Space for N entries.
    pub fn space_for(n: usize) -> usize {
        Self::BASE_SIZE + n * Self::ENTRY_SIZE
    }
}

/// A single memory entry in the on-chain registry.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct MemoryEntry {
    /// SHA-256 hash of the plaintext memory content.
    pub content_hash: [u8; 32],
    /// Unix timestamp when memory was created.
    pub timestamp: i64,
    /// Memory type: 0=episodic, 1=semantic, 2=procedural, 3=self_model
    pub memory_type: u8,
    /// Importance tier: 0=low (<0.3), 1=medium (0.3-0.7), 2=high (>0.7)
    pub importance_tier: u8,
    /// Supabase memory ID for cross-reference.
    pub memory_id: u64,
    /// Whether the memory content is encrypted at rest.
    pub encrypted: bool,
    /// Padding for 8-byte alignment (3 bytes).
    pub _padding: [u8; 3],
}
