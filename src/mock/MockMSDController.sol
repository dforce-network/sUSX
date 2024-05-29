// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

interface IERC20 {
    function mint(address to, uint256 amount) external;
}

interface IMinter {
    function totalMint() external view returns (uint256);
}

contract MockMSDController {
    mapping(address => mapping(address => uint256)) public mintCaps;

    // NOTICE: ONLY FOR TEST!!!
    // So no permission at here
    function _addMSD(
        address _token,
        address[] calldata _minters,
        uint256[] calldata _mintCaps
    ) external {
        require(_minters.length == _mintCaps.length, "Mismatched input lengths");

        uint256 _len = _minters.length;
        for (uint256 i; i < _len; ) {
            mintCaps[_token][_minters[i]] = _mintCaps[i];

            unchecked {
                ++i;
            }
        }
    }

    // NOTICE: ONLY FOR TEST!!!
    // So no permission at here
    function mintMSD(address _token, address _to, uint256 _amount) external {
        address _minter = msg.sender;
        require(
            IMinter(_minter).totalMint() <= mintCaps[_token][_minter],
            "Minter mint capacity reached"
        );
        IERC20(_token).mint(_to, _amount);
    }
}
