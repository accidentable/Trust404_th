// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice 폐기 레지스트리 (CLAUDE.md §9).
/// 체인에 올라가는 것은 인덱스 번호와 폐기 여부뿐이다. 개인정보는 없다.
/// 인덱스↔사람 매핑은 발급기관만 안다. 이 컨트랙트는 발급기관 DB 를 대체하지 않는다.
contract IssuerRegistry {
    address public issuer;
    mapping(uint256 => bool) public revoked;

    event Revoked(uint256 indexed index, uint256 timestamp);

    constructor() { issuer = msg.sender; }

    function revoke(uint256 index) external {
        require(msg.sender == issuer, "not issuer");
        revoked[index] = true;
        emit Revoked(index, block.timestamp);
    }
}
