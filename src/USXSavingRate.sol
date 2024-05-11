// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

contract USXSavingRate is Initializable, Ownable2StepUpgradeable {
    uint256 private constant RAY = 10 ** 27;
    uint256 private constant MAX_USR = 2 * 10 ** 27;
    uint256 private constant MIN_USR = 0;

    uint256 public usr;  // USX Savings Rate at the current period
    uint256 public usrExpiredTime;  // The time of the USX Savings Rate expired
    uint256 public rateAccumulator;  // Accumulated USX Savings Rate
    uint256 public nextUsr;  // USX Savings Rate at the next period 
    uint256 public nextUsrWorkingTime;  // The time of the USX Savings Rate works at the next period
    uint256 public nextUsrExpiredTime;  // The time of the USX Savings Rate expired at the next period
    uint256 public lastAccumulatedTime;  // time of last drip

    mapping(address => uint256) public userSavingsUsx;  // User Savings USX

    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint256 _usr,
        uint256 _usrExpiredTime
    ) external initializer {
        require(_usr > MIN_USR && _usr < MAX_USR, "Invalid usr value!");
        require(_usrExpiredTime > block.timestamp, "Invalid usr expired time!");
        __Ownable2Step_init();

        usr = _usr;
        usrExpiredTime = _usrExpiredTime;
        rateAccumulator = RAY;
        lastAccumulatedTime = block.timestamp;
    }

    function _setNextUsr(uint256 _nextUsr, uint256 _nextUsrWorkingTime, uint256 _nextUsrExpiredTime) external onlyOwner {
        require(_nextUsrWorkingTime > block.timestamp, "Invalid next usr working time!");
        require(_nextUsrExpiredTime > block.timestamp, "Invalid next usr expired time!");
        require(_nextUsr > MIN_USR && _nextUsr < MAX_USR, "Invalid next usr value!");
        accumulateUsr();

        nextUsr = _nextUsr;
        nextUsrWorkingTime = _nextUsrWorkingTime;
        nextUsrExpiredTime = _nextUsrExpiredTime;
        if (usrExpiredTime > _nextUsrWorkingTime) {
            usrExpiredTime = _nextUsrWorkingTime;
        }
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

    function accumulateUsr() public returns (uint256 _newRateAccumulator) {
        require(lastAccumulatedTime <= block.timestamp, "Invalid last accumulated time!");
        if (lastAccumulatedTime == block.timestamp) {
            _newRateAccumulator = rateAccumulator;
        } else {
            _newRateAccumulator = _currentAccumulatedRateInternal();
            if (block.timestamp >= nextUsrWorkingTime && nextUsrWorkingTime > 0) {
                usr = nextUsr;
                usrExpiredTime = nextUsrExpiredTime;
                nextUsrWorkingTime = 0;
            }

            rateAccumulator = _newRateAccumulator;
            lastAccumulatedTime = block.timestamp > usrExpiredTime ? usrExpiredTime : block.timestamp;
        }
    }

    function _currentAccumulatedRateInternal() internal view returns (uint256 _newRateAccumulator) {
        uint256 accumulatedEndTime = block.timestamp > usrExpiredTime ? usrExpiredTime : block.timestamp;
        uint256 elapsedTime = accumulatedEndTime - lastAccumulatedTime;
        if (block.timestamp < nextUsrWorkingTime || nextUsrWorkingTime == 0) {
            _newRateAccumulator = _rmul(_rpow(usr, elapsedTime, RAY), rateAccumulator);
        } else {
            _newRateAccumulator = _rmul(_rpow(usr, elapsedTime, RAY), rateAccumulator);
            accumulatedEndTime = block.timestamp > nextUsrExpiredTime ? nextUsrExpiredTime : block.timestamp;
            elapsedTime = accumulatedEndTime - nextUsrWorkingTime;
            _newRateAccumulator = _rmul(_rpow(nextUsr, elapsedTime, RAY), _newRateAccumulator);
        }
    }

    function currentAccumulatedRate() external view returns (uint256 _newRateAccumulator) {
        if (block.timestamp < usrExpiredTime || (nextUsrWorkingTime != 0 && block.timestamp >= nextUsrWorkingTime && block.timestamp < nextUsrExpiredTime)) {
            _newRateAccumulator = _currentAccumulatedRateInternal();
        }
    }
}
