// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

interface IERC20 {
    function mint(address to, uint256 amount) external;
}

contract MockMSDController {
    // NOTICE: ONLY FOR TEST!!!
    // So no permission at here
    function mintMSD(address token, address to, uint256 amount) external {
        IERC20(token).mint(to, amount);
    }
}
