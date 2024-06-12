// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

contract ProxyAdmin2Step is ProxyAdmin, Ownable2Step {
    function _transferOwnership(
        address _newOwner
    ) internal override(Ownable, Ownable2Step) {
        Ownable2Step._transferOwnership(_newOwner);
    }

    function transferOwnership(
        address _newOwner
    ) public override(Ownable, Ownable2Step) onlyOwner {
        Ownable2Step.transferOwnership(_newOwner);
    }
}
