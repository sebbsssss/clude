use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    #[msg("Registry is full — maximum entries reached")]
    RegistryFull,
    #[msg("Invalid memory type — must be 0-3")]
    InvalidMemoryType,
    #[msg("Duplicate content hash — this memory is already registered")]
    DuplicateHash,
    #[msg("Content hash not found in registry")]
    HashNotFound,
    #[msg("Pool namespace must be non-empty and ASCII")]
    InvalidPoolNamespace,
    #[msg("Insufficient $CLUDE to pay the pool write fee")]
    InsufficientWriteFee,
    #[msg("Insufficient $CLUDE to pay the citation royalty")]
    InsufficientCitationFee,
    #[msg("Cannot cite your own memory (self-citation is disallowed)")]
    SelfCitation,
    #[msg("Pool namespace exceeds 32 bytes")]
    NamespaceTooLong,
}
