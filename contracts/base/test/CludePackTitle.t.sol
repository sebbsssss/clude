// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CludePackTitle} from "../src/CludePackTitle.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract CludePackTitleTest is Test {
    CludePackTitle internal title;

    address internal admin = makeAddr("admin");
    address internal minter = makeAddr("minter"); // the Clude server
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal creator = makeAddr("creator");

    bytes32 internal constant ROOT = keccak256("sha256-merkle-v1:root");
    bytes32 internal constant MANIFEST = keccak256("manifest");
    string internal constant PACK_ID = "pack-7Q2ABCDE";

    function setUp() public {
        title = new CludePackTitle(admin, minter, "https://clude.io/api/pmp/title/");
    }

    function _binding() internal view returns (CludePackTitle.PackBinding memory) {
        return CludePackTitle.PackBinding({
            merkleRoot: ROOT,
            manifestHash: MANIFEST,
            memoryCount: 42,
            mintedAt: 0, // ignored by the contract
            creator: creator
        });
    }

    function _mintTo(address to) internal returns (uint256) {
        vm.prank(minter);
        return title.mint(to, PACK_ID, _binding());
    }

    // ---- mint ----

    function test_Mint_SetsOwnerAndBinding() public {
        uint256 id = _mintTo(alice);
        assertEq(id, title.tokenIdFor(PACK_ID), "tokenId derivation");
        assertEq(title.ownerOf(id), alice, "owner is the recipient");

        CludePackTitle.PackBinding memory b = title.bindingOf(id);
        assertEq(b.merkleRoot, ROOT);
        assertEq(b.manifestHash, MANIFEST);
        assertEq(b.memoryCount, 42);
        assertEq(b.creator, creator);
        assertGt(b.mintedAt, 0, "mintedAt stamped by contract");
    }

    function test_TokenIdFor_IsDeterministicAndVersioned() public view {
        assertEq(title.tokenIdFor(PACK_ID), title.tokenIdFor(PACK_ID));
        assertTrue(title.tokenIdFor(PACK_ID) != title.tokenIdFor("pack-OTHER"));
    }

    function test_Mint_OnlyMinter() public {
        bytes32 minterRole = title.MINTER_ROLE(); // cache before prank (it's an external call)
        vm.prank(alice); // not a minter
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, minterRole)
        );
        title.mint(alice, PACK_ID, _binding());
    }

    /// @dev The 1-of-1 supply guard: a second mint of the same pack reverts (same tokenId
    ///      already exists). No counter, no race.
    function test_Mint_DuplicateReverts_SupplyGuard() public {
        _mintTo(alice);
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidSender.selector, address(0)));
        title.mint(bob, PACK_ID, _binding());
    }

    function test_Mint_RejectsDegenerateBindings() public {
        CludePackTitle.PackBinding memory b = _binding();

        b.merkleRoot = bytes32(0);
        vm.prank(minter);
        vm.expectRevert(CludePackTitle.ZeroMerkleRoot.selector);
        title.mint(alice, PACK_ID, b);

        b = _binding();
        b.memoryCount = 0;
        vm.prank(minter);
        vm.expectRevert(CludePackTitle.EmptyPack.selector);
        title.mint(alice, PACK_ID, b);

        b = _binding();
        b.creator = address(0);
        vm.prank(minter);
        vm.expectRevert(CludePackTitle.ZeroCreator.selector);
        title.mint(alice, PACK_ID, b);
    }

    // ---- ownership / transfer (the B2 single-owner property) ----

    function test_Transfer_MovesSingleOwnership() public {
        uint256 id = _mintTo(alice);
        vm.prank(alice);
        title.transferFrom(alice, bob, id);
        assertEq(title.ownerOf(id), bob, "ownership moved to bob");
        // there is exactly ONE owner at any time -> no balance >= 1 double-spend
        assertEq(title.balanceOf(alice), 0);
        assertEq(title.balanceOf(bob), 1);
    }

    function test_Transfer_RequiresOwnerOrApproval_NoOperatorGodMove() public {
        uint256 id = _mintTo(alice);
        // neither the minter nor admin can move alice's title -> no operator honeypot (RT6)
        vm.prank(minter);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, minter, id));
        title.transferFrom(alice, bob, id);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, admin, id));
        title.transferFrom(alice, bob, id);
    }

    // ---- pause affects minting only, never a holder's owned asset ----

    function test_Pause_BlocksMintButNotTransfer() public {
        uint256 id = _mintTo(alice);

        vm.prank(admin);
        title.setMintingPaused(true);

        // no new mints while paused
        vm.prank(minter);
        vm.expectRevert(CludePackTitle.MintingIsPaused.selector);
        title.mint(bob, "pack-NEW1", _binding());

        // but alice's owned title still transfers (assets are never frozen)
        vm.prank(alice);
        title.transferFrom(alice, bob, id);
        assertEq(title.ownerOf(id), bob);

        vm.prank(admin);
        title.setMintingPaused(false);
        vm.prank(minter);
        title.mint(bob, "pack-NEW1", _binding()); // works again
    }

    function test_Pause_OnlyAdmin() public {
        bytes32 adminRole = title.DEFAULT_ADMIN_ROLE(); // cache before prank
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, adminRole)
        );
        title.setMintingPaused(true);
    }

    // ---- content verification ----

    function test_VerifyBinding() public {
        uint256 id = _mintTo(alice);
        assertTrue(title.verifyBinding(id, ROOT, MANIFEST), "matching content commitment");
        assertFalse(title.verifyBinding(id, keccak256("wrong"), MANIFEST), "tampered root");
        assertFalse(title.verifyBinding(999, ROOT, MANIFEST), "nonexistent token");
    }

    function test_BindingOf_RevertsForNonexistent() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(999)));
        title.bindingOf(999);
    }

    // ---- interface ----

    function test_SupportsInterfaces() public view {
        assertTrue(title.supportsInterface(type(IERC721).interfaceId), "ERC721");
        assertTrue(title.supportsInterface(type(IAccessControl).interfaceId), "AccessControl");
    }
}
