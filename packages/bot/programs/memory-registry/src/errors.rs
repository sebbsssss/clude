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
}
