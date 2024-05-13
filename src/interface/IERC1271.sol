// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

interface IERC1271 {
    function isValidSignature(bytes32, bytes memory) external view returns (bytes4);
}
