// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CludePackTitle} from "../src/CludePackTitle.sol";

/// @notice End-to-end spike of the title lifecycle: deploy -> mint to buyer ->
///         read ownerOf + content commitment -> resale transfer -> read again ->
///         prove the 1-of-1 supply guard. Run with NO rpc to exercise it on a fresh
///         in-memory chain (proves the primitive, no key/network needed):
///   forge script script/Spike.s.sol -vvv
contract Spike is Script {
    function run() external {
        address server = address(0xA11CE); // the Clude minter (admin + MINTER_ROLE here)
        address creator = address(0xC0FFEE);
        address buyer = address(0xB0B);
        address reseller = address(0xDECAF);

        bytes32 root = keccak256("sha256-merkle-v1:demo-pack-root");
        bytes32 manifest = keccak256("demo-.pmp-manifest");
        string memory packId = "pack-DEMO0001";

        console2.log("1. deploy CludePackTitle");
        CludePackTitle title = new CludePackTitle(server, server, "https://clude.io/api/pmp/title/");

        console2.log("2. server mints the 1-of-1 title to the buyer, binding the .pmp root");
        vm.prank(server);
        uint256 tokenId = title.mint(
            buyer,
            packId,
            CludePackTitle.PackBinding({merkleRoot: root, manifestHash: manifest, memoryCount: 17, mintedAt: 0, creator: creator})
        );
        console2.log("   tokenId          :", tokenId);
        console2.log("   ownerOf          :", title.ownerOf(tokenId));
        console2.log("   binds .pmp root? :", title.verifyBinding(tokenId, root, manifest));

        console2.log("3. buyer resells: transfers the title to a new owner");
        vm.prank(buyer);
        title.transferFrom(buyer, reseller, tokenId);
        console2.log("   ownerOf now      :", title.ownerOf(tokenId));
        console2.log("   commitment kept? :", title.verifyBinding(tokenId, root, manifest));

        console2.log("4. supply guard: a second mint of the same pack must revert");
        vm.prank(server);
        try title.mint(
            buyer,
            packId,
            CludePackTitle.PackBinding({merkleRoot: root, manifestHash: manifest, memoryCount: 17, mintedAt: 0, creator: creator})
        ) {
            console2.log("   ERROR: duplicate mint succeeded (BUG)");
        } catch {
            console2.log("   OK: duplicate mint reverted (1-of-1 enforced)");
        }
    }
}
