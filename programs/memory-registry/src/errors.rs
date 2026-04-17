use anchor_lang::prelude::*;

/// Error discriminants in Anchor are POSITIONAL — once this program is
/// deployed, the order of variants here is part of the ABI. Reordering is
/// a breaking change on clients. Append-only from the point of first deploy.
#[error_code]
pub enum RegistryError {
    // --- Registry (wallet-owned memory) ---
    #[msg("Registry is full — maximum entries reached")]
    RegistryFull,
    #[msg("Invalid memory type — must be 0-3")]
    InvalidMemoryType,
    #[msg("Duplicate content hash — this memory is already registered")]
    DuplicateHash,
    #[msg("Content hash not found in registry")]
    HashNotFound,

    // --- Pool (shared memory pools) ---
    #[msg("Pool namespace must be non-empty and ASCII")]
    InvalidPoolNamespace,
    #[msg("Pool namespace exceeds 32 bytes")]
    NamespaceTooLong,
    #[msg("Insufficient $CLUDE to pay the pool write fee")]
    InsufficientWriteFee,

    // --- Citation ---
    #[msg("Insufficient $CLUDE to pay the citation royalty")]
    InsufficientCitationFee,
    #[msg("Cannot cite your own memory (self-citation is disallowed)")]
    SelfCitation,
}
