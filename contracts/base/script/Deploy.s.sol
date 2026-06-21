// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CludePackTitle} from "../src/CludePackTitle.sol";

/// @notice Deploy CludePackTitle to Base Sepolia (or mainnet).
/// @dev Env (the deployer key lives in the gitignored contracts/base/.deployer.env):
///   DEPLOYER_PRIVATE_KEY  funded deployer
///   TITLE_ADMIN           DEFAULT_ADMIN_ROLE holder (use a multisig on mainnet)
///   TITLE_MINTER          MINTER_ROLE holder (the Clude server signer)
///   TITLE_BASE_URI        metadata base (default https://clude.io/api/pmp/title/)
/// Run:
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
contract Deploy is Script {
    function run() external returns (CludePackTitle title) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.envAddress("TITLE_ADMIN");
        address minter = vm.envAddress("TITLE_MINTER");
        string memory baseURI = vm.envOr("TITLE_BASE_URI", string("https://clude.io/api/pmp/title/"));

        vm.startBroadcast(pk);
        title = new CludePackTitle(admin, minter, baseURI);
        vm.stopBroadcast();

        console2.log("CludePackTitle deployed:", address(title));
        console2.log("  admin :", admin);
        console2.log("  minter:", minter);
    }
}
