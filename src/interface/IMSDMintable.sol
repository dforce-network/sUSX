// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IMSDController {
    function mintCaps(address token, address minter) external view returns (uint256);
    function mintMSD(address token, address usr, uint256 wad) external;
}

interface IMSD {
    function balanceOf(address user) external view returns (uint256);
    function mint(address to, uint256 amount) external;
    function burn(address usr, uint256 wad) external;
}
