// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title  CludePackTitle
/// @notice The 1-of-1 transferable ownership of a Clude memory pack, on Base.
///         `ownerOf(tokenId)` is the single source of truth for "who owns this pack"
///         (no balance checks anywhere -> the double-spend is structurally impossible).
///         Each token binds the pack's `.pmp` content commitment (Merkle root + manifest
///         hash) on-chain, so ownership and verifiable content are one asset.
/// @dev    Design decisions (see docs/.../2026-06-21-base-pack-titles-design.md §00):
///         - IMMUTABLE: no proxy / upgrade path. Stronger trust for a money contract;
///           policy changes ship as a v2 contract + migration.
///         - NO resale royalty (ERC-2981 omitted on purpose) -> removes the Howey
///           "profit from Clude's efforts on resale" factor. A flat $CLUDE service fee
///           is charged OFF-chain on the Solana rail, never as a % cut here.
///         - NO operator god-transfer: there is no role that can move someone else's
///           title. Transfers require the owner's key (custodial = Clude signs as the
///           custodial owner via the user's embedded wallet; non-custodial = user signs).
///           This closes the RT6 honeypot.
contract CludePackTitle is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Immutable-at-mint content commitment binding a title to its exact pack.
    ///         Packs into 3 storage slots (bytes32, bytes32, uint32+uint64+address).
    struct PackBinding {
        bytes32 merkleRoot;   // sha256-merkle-v1 root over the pack's member-memory leaves
        bytes32 manifestHash; // sha256 of the canonical .pmp manifest
        uint32  memoryCount;  // number of member memories
        uint64  mintedAt;     // block timestamp at mint (provenance; set by the contract)
        address creator;      // original pack author (provenance / off-chain royalty ref)
    }

    mapping(uint256 tokenId => PackBinding) private _bindings;

    /// @notice When true, no NEW titles can be minted. Does NOT affect transfers, so a
    ///         pause can never freeze a holder's owned asset.
    bool public mintingPaused;

    string private _baseTokenURI;

    event TitleMinted(
        uint256 indexed tokenId,
        string packId,
        address indexed to,
        bytes32 merkleRoot,
        bytes32 manifestHash,
        uint32 memoryCount,
        address creator
    );
    event MintingPausedSet(bool paused);
    event BaseURISet(string baseURI);

    error MintingIsPaused();
    error ZeroMerkleRoot();
    error EmptyPack();
    error ZeroCreator();

    constructor(address admin, address minter, string memory baseURI_)
        ERC721("Clude Pack Title", "CLUDEPACK")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        _baseTokenURI = baseURI_;
    }

    /// @notice Deterministic tokenId for a pack. Server-precomputable (so the off-chain
    ///         mirror row + unlock gate are ready the instant the mint mines),
    ///         collision-resistant, and versioned. A second mint of the same packId
    ///         yields the same id and reverts in `_safeMint` -> the free 1-of-1 supply
    ///         guard (no counter to race).
    function tokenIdFor(string memory packId) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked("clude-pmp-title:v1:", packId)));
    }

    /// @notice Mint the 1-of-1 title for `packId` to `to`, binding its content commitment.
    ///         `binding.mintedAt` is IGNORED and stamped from `block.timestamp`.
    /// @dev    onlyRole(MINTER_ROLE) (the Clude server). Reverts if the title already
    ///         exists (supply guard) or the binding is degenerate.
    function mint(address to, string calldata packId, PackBinding calldata binding)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        if (mintingPaused) revert MintingIsPaused();
        if (binding.merkleRoot == bytes32(0)) revert ZeroMerkleRoot();
        if (binding.memoryCount == 0) revert EmptyPack();
        if (binding.creator == address(0)) revert ZeroCreator();

        tokenId = tokenIdFor(packId);
        _bindings[tokenId] = PackBinding({
            merkleRoot: binding.merkleRoot,
            manifestHash: binding.manifestHash,
            memoryCount: binding.memoryCount,
            mintedAt: uint64(block.timestamp),
            creator: binding.creator
        });
        _safeMint(to, tokenId); // reverts if tokenId already exists -> 1-of-1 guaranteed
        emit TitleMinted(
            tokenId, packId, to, binding.merkleRoot, binding.manifestHash, binding.memoryCount, binding.creator
        );
    }

    /// @notice The on-chain content commitment for a title. `ownerOf(tokenId)` + this
    ///         together prove "this address owns this EXACT verifiable pack". Reverts
    ///         for a nonexistent token.
    function bindingOf(uint256 tokenId) external view returns (PackBinding memory) {
        _requireOwned(tokenId);
        return _bindings[tokenId];
    }

    /// @notice Convenience check: does this title commit to the given pack content?
    ///         Returns false for a nonexistent token (its binding is zero).
    function verifyBinding(uint256 tokenId, bytes32 merkleRoot, bytes32 manifestHash)
        external
        view
        returns (bool)
    {
        PackBinding storage b = _bindings[tokenId];
        return b.merkleRoot == merkleRoot && b.manifestHash == manifestHash;
    }

    // ---- admin (DEFAULT_ADMIN_ROLE) ----

    function setMintingPaused(bool paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintingPaused = paused;
        emit MintingPausedSet(paused);
    }

    function setBaseURI(string calldata baseURI_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = baseURI_;
        emit BaseURISet(baseURI_);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // ---- required override (ERC721 + AccessControl both define supportsInterface) ----

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
