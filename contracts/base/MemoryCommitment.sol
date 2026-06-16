// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Clude PMP — Memory Commitment Registry (EVM / Base)
/// @notice Anchors a memory's canonical SHA-256 fingerprint (memory-hash-v1) on-chain,
///         mirroring the Solana commitment path. Cross-chain VERIFY recomputes the same
///         fingerprint off-chain and checks it against this registry. The content never
///         touches the chain; only the 32-byte proof does.
contract MemoryCommitment {
    /// @dev Emitted on the first commitment of a fingerprint.
    event Committed(bytes32 indexed fingerprint, address indexed committer, uint64 timestamp);

    /// @notice fingerprint => unix timestamp of first commitment (0 = never committed).
    mapping(bytes32 => uint64) public committedAt;

    /// @notice Anchor a memory fingerprint. Idempotent: first commit wins the timestamp,
    ///         so re-submitting the same proof is a cheap no-op and cannot be backdated.
    function commit(bytes32 fingerprint) external {
        require(fingerprint != bytes32(0), "empty fingerprint");
        if (committedAt[fingerprint] == 0) {
            committedAt[fingerprint] = uint64(block.timestamp);
            emit Committed(fingerprint, msg.sender, uint64(block.timestamp));
        }
    }

    /// @notice True iff this fingerprint has been anchored. The off-chain VERIFY
    ///         recomputes memory-hash-v1 and calls this to confirm authenticity.
    function isCommitted(bytes32 fingerprint) external view returns (bool) {
        return committedAt[fingerprint] != 0;
    }
}
