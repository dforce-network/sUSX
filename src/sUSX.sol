// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {IUSXSavingRate} from "./interface/IUSXSavingRate.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

contract sUSX is Initializable, Ownable2StepUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    string public constant name = "USX Savings";
    string public constant symbol = "sUSX";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 private constant RAY = 10 ** 27;
    address public usxSavingRate;
    address public usx;

    constructor() {
        _disableInitializers();
    }

    function initialize(address _usxSavingRate, address _usx) external initializer {
        __Ownable2Step_init();

        usxSavingRate = _usxSavingRate;
        usx = _usx;
    }

    function _rpow(uint256 x, uint256 n) internal pure returns (uint256 z) {
        assembly {
            switch x case 0 {switch n case 0 {z := RAY} default {z := 0}}
            default {
                switch mod(n, 2) case 0 { z := RAY } default { z := x }
                let half := div(RAY, 2)  // for rounding.
                for { n := div(n, 2) } n { n := div(n,2) } {
                    let xx := mul(x, x)
                    if iszero(eq(div(xx, x), x)) { revert(0,0) }
                    let xxRound := add(xx, half)
                    if lt(xxRound, xx) { revert(0,0) }
                    x := div(xxRound, RAY)
                    if mod(n,2) {
                        let zx := mul(z, x)
                        if and(iszero(iszero(x)), iszero(eq(div(zx, x), z))) { revert(0,0) }
                        let zxRound := add(zx, half)
                        if lt(zxRound, zx) { revert(0,0) }
                        z := div(zxRound, RAY)
                    }
                }
            }
        }
    }

    function deposit(uint256 _amount, address _recipient) external returns (uint256 _shares) {
        uint256 usrRateAccumulator = IUSXSavingRate(usxSavingRate).accumulateUsr();
        _shares = _amount * RAY / usrRateAccumulator;
        _mint(_amount, _shares, _recipient);
    }

    function _mint(uint256 _amount, uint256 _shares, address _recipient) internal {
        require(_recipient != address(0) && _recipient != address(this), "Invalid recipient address");
        IERC20Upgradeable(usx).safeTransferFrom(msg.sender, address(this), _amount);

        balanceOf[_recipient] = balanceOf[_recipient] + _shares;
        totalSupply = totalSupply + _shares;
    }
}
