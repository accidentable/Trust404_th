// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";

contract IssuerRegistryTest is Test {
    IssuerRegistry internal registry;
    address internal issuer = address(0xA11CE);
    address internal stranger = address(0xB0B);

    event Revoked(uint256 indexed index, uint256 timestamp);

    function setUp() public {
        vm.prank(issuer);
        registry = new IssuerRegistry();
    }

    function test_deployerIsIssuer() public view {
        assertEq(registry.issuer(), issuer);
    }

    function test_notRevokedByDefault() public view {
        assertFalse(registry.revoked(4821));
    }

    function test_issuerCanRevoke_andEventCarriesOnlyIndex() public {
        vm.expectEmit(true, false, false, true);
        emit Revoked(4821, block.timestamp);

        vm.prank(issuer);
        registry.revoke(4821);

        assertTrue(registry.revoked(4821));
        assertFalse(registry.revoked(4822)); // 이웃 인덱스는 건드리지 않는다
    }

    function test_strangerCannotRevoke() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("not issuer"));
        registry.revoke(4821);
        assertFalse(registry.revoked(4821));
    }

    function test_revokeIsIdempotent() public {
        vm.startPrank(issuer);
        registry.revoke(7);
        registry.revoke(7);
        vm.stopPrank();
        assertTrue(registry.revoked(7));
    }

    /// 인덱스는 난수 배정이므로 전 범위에서 동작해야 한다.
    function testFuzz_revokeAnyIndex(uint256 index) public {
        vm.prank(issuer);
        registry.revoke(index);
        assertTrue(registry.revoked(index));
    }
}
