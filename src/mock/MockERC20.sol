// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory _name , string memory _symbol) ERC20(_name, _symbol) {
        _mint(msg.sender, 10000e18);
    }

    // NOTICE: ONLY FOR TEST!!!
    // So no permission at here
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address account, uint256 amount) external {
        _burn(account, amount);
    }
}
