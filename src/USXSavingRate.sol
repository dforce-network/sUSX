// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract USXSavingRate is Initializable, Ownable2StepUpgradeable {
    uint256 private constant RAY = 10 ** 27;
    int256 private constant MAX_USR = 10 ** 27;
    int256 private constant MIN_USR = -1 * 10 ** 27;

    int256 public usr;  // USX Savings Rate at the current period
    uint256 public rateAccumulator;  // Accumulated USX Savings Rate
    int256 public nextUsr;  // USX Savings Rate at the next period 
    uint256 public nextUsrTime;  // The time of the USX Savings Rate works on at the next period
    uint256 public lastAccumulatedTime;  // time of last drip

    mapping(address => uint256) public userSavingsUsx;  // User Savings USX

    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable2Step_init();

        rateAccumulator = RAY;
        lastAccumulatedTime = block.timestamp;
    }

    function _setNextUsr(int256 _nextUsr, uint256 _nextUsrTime) external onlyOwner {
        require(_nextUsrTime > block.timestamp, "Invalid next usr time!");
        require(_nextUsr > MIN_USR && _nextUsr < MAX_USR, "Invalid next usr value!");
        accumulateUsr();

        nextUsr = _nextUsr;
        nextUsrTime = _nextUsrTime;
    }

    function _rpow(uint256 x, uint256 n, uint256 base) internal pure returns (uint256 z) {
        assembly {
            switch x case 0 {switch n case 0 {z := base} default {z := 0}}
            default {
                switch mod(n, 2) case 0 { z := base } default { z := x }
                let half := div(base, 2)  // for rounding.
                for { n := div(n, 2) } n { n := div(n,2) } {
                    let xx := mul(x, x)
                    if iszero(eq(div(xx, x), x)) { revert(0,0) }
                    let xxRound := add(xx, half)
                    if lt(xxRound, xx) { revert(0,0) }
                    x := div(xxRound, base)
                    if mod(n,2) {
                        let zx := mul(z, x)
                        if and(iszero(iszero(x)), iszero(eq(div(zx, x), z))) { revert(0,0) }
                        let zxRound := add(zx, half)
                        if lt(zxRound, zx) { revert(0,0) }
                        z := div(zxRound, base)
                    }
                }
            }
        }
    }

    function _rmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = _mul(x, y) / RAY;
    }

    function _mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require(y == 0 || (z = x * y) / y == x);
    }

    function accumulateUsr() public returns (uint256 _newUsr) {
        require(lastAccumulatedTime <= block.timestamp, "Invalid last accumulated time!");

        if (lastAccumulatedTime == block.timestamp) {
            _newUsr = rateAccumulator;
            return _newUsr;
        } else {
            // Always safe to cast to uint256 because usr is always between MIN_USR and MAX_USR
            uint256 finalUSR = uint256(int256(RAY) + usr);
            if (block.timestamp < nextUsrTime || nextUsrTime == 0) {
                _newUsr = _rmul(_rpow(finalUSR, block.timestamp - lastAccumulatedTime, RAY), rateAccumulator);
            } else {
                _newUsr = _rmul(_rpow(finalUSR, nextUsrTime - lastAccumulatedTime, RAY), rateAccumulator);
                finalUSR = uint256(int256(RAY) + nextUsr);
                _newUsr = _rmul(_rpow(finalUSR, block.timestamp - nextUsrTime, RAY), _newUsr);
            }

            rateAccumulator = _newUsr;
            lastAccumulatedTime = block.timestamp;
        }
    }
}
