// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

contract UniversalFactory {

    event ContractCreated(address newContractAddress);

    /**
     * @dev Modifier to ensure that the first 20 bytes of a submitted salt match
     * those of the calling account. This provides protection against the salt
     * being stolen by front-runners or other attackers. The protection can also be
     * bypassed if desired by setting each of the first 20 bytes to zero.
     * @param salt bytes32 The salt value to check against the calling address.
     */
    modifier containsCaller(bytes32 salt) {
        // prevent contract submissions from being stolen from tx.pool by requiring
        // that the first 20 bytes of the submitted salt match msg.sender.
        require(
            (address(bytes20(salt)) == msg.sender) ||
            (bytes20(salt) == bytes20(0)),
            "Invalid salt - first 20 bytes of the salt must match calling address."
        );
        _;
    }

    function deployWithProxy(
        bytes32 salt,
        bytes calldata creationBytecode,
        bytes calldata initCode
    ) external containsCaller(salt) returns (address proxy) {
        proxy = Create2.deploy(0, salt, creationBytecode);
        (bool success,) = proxy.call(initCode);

        require(success, "Fail to initialize contract!");

        emit ContractCreated(proxy);
    }
}
