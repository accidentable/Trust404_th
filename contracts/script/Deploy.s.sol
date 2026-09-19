// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";

/// 배포자 = 발급기관(issuer). 배포한 키가 revoke 권한을 갖는다.
///   로컬:    forge script script/Deploy.s.sol --rpc-url anvil   --broadcast --private-key <anvil key>
///   Sepolia: forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --private-key $ISSUER_CHAIN_KEY
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        IssuerRegistry registry = new IssuerRegistry();
        vm.stopBroadcast();
        console.log("IssuerRegistry deployed at", address(registry));
        console.log("issuer", registry.issuer());
    }
}
