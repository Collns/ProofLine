// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/Anchor.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        ProofLineAnchor anchorContract = new ProofLineAnchor();
        vm.stopBroadcast();
        console.log("ProofLineAnchor deployed at:", address(anchorContract));
    }
}
