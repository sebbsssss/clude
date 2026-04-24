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

/// A shared memory pool — any wallet can write after paying the write fee.
/// Seeds: `["pool", namespace]` — namespace is the full zero-padded 32-byte
/// form (NOT the trimmed string); clients must pad before derivation or the
/// PDA won't resolve.
///
/// Space: use `8 + Pool::INIT_SPACE` at `init` call sites.
#[account]
#[derive(InitSpace)]
pub struct Pool {
    /// Pool creator.
    pub authority: Pubkey,
    /// ASCII namespace, zero-padded to 32 bytes (e.g., "defi-research-2026").
    pub namespace: [u8; 32],
    /// Write fee per memory store, in $CLUDE token base units.
    pub write_fee: u64,
    /// Royalty per citation, in $CLUDE token base units.
    pub citation_fee: u64,
    /// Total memories ever written to this pool.
    pub memory_count: u64,
    /// Total citations ever recorded across this pool.
    pub citation_count: u64,
    /// Treasury PDA bump.
    pub treasury_bump: u8,
    /// This pool PDA's bump.
    pub bump: u8,
    /// Reserved (32 bytes — pool config is most likely to grow: fee schedules,
    /// access controls, rate limits).
    pub _reserved: [u8; 32],
}

/// Pooled memory record — scoped to a Pool, authored by a wallet.
/// Seeds: `["pool_mem", pool, memory_id.to_le_bytes()]` — memory_id is the
/// off-chain Supabase row id, serialized little-endian. Uniqueness per pool
/// is enforced structurally: a second store attempt for the same `(pool,
/// memory_id)` returns `AccountAlreadyInUse` (implicit dedup).
///
/// Space: use `8 + PoolMemoryRecord::INIT_SPACE` at `init` call sites.
#[account]
#[derive(InitSpace)]
pub struct PoolMemoryRecord {
    /// Pool PDA this memory belongs to.
    pub pool: Pubkey,
    /// Wallet that wrote this memory.
    pub author: Pubkey,
    /// SHA-256 of memory content.
    pub content_hash: [u8; 32],
    /// Clude's internal memory id (cross-reference to off-chain row).
    pub memory_id: u64,
    /// Block time of write.
    pub timestamp: i64,
    /// Actual fee paid at time of write (may diverge from current pool.write_fee).
    pub fee_paid: u64,
    /// Times this memory has been cited.
    pub citation_count: u64,
    /// Cumulative $CLUDE earned from citations (author royalties).
    pub earnings: u64,
    /// PDA bump.
    pub bump: u8,
    /// Reserved (16 bytes — per-memory metadata is largely stable).
    pub _reserved: [u8; 16],
}

/// Single citation event — emitted when one agent cites another's memory.
/// Seeds: `["citation", memory_pda, memory.citation_count.to_le_bytes()]`
/// where citation_count is the value *before* increment.
///
/// CitationRecords are the highest-volume account type in this program —
/// the 8-byte `_reserved` here is important: adding a field later would
/// force a migration across potentially millions of PDAs.
///
/// Space: use `8 + CitationRecord::INIT_SPACE` at `init` call sites.
#[account]
#[derive(InitSpace)]
pub struct CitationRecord {
    /// Pool containing the cited memory.
    pub pool: Pubkey,
    /// The PoolMemoryRecord PDA being cited.
    pub memory_pda: Pubkey,
    /// Wallet that issued the citation (and paid the royalty).
    pub citer: Pubkey,
    /// Wallet that originally wrote the memory (royalty recipient).
    pub author: Pubkey,
    /// Block time of citation.
    pub timestamp: i64,
    /// Royalty transferred, in $CLUDE base units.
    pub royalty_paid: u64,
    /// PDA bump.
    pub bump: u8,
    /// Reserved (8 bytes — citations are unbounded-volume; add room for
    /// future `kind: u8` discriminator or epoch tag without migration).
    pub _reserved: [u8; 8],
}
