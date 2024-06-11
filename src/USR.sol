// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "./library/RateMath.sol";

/// @title USX Saving Rate(USR) Contract
/// @dev Accumulated rate by seconds: newRate = lastRate * usr^elapsedTime
abstract contract USR is Initializable, Ownable2StepUpgradeable {
    using RateMath for uint256;

    uint256 internal constant RAY = 10 ** 27;
    uint256 private constant MAX_USR = 1000000012857214317438491418; // +50%
    uint256 private constant MIN_USR = 999999988689911785840947108; // -30%

    struct USRConfig {
        uint256 startTime;
        uint256 endTime;
        // if usr > 1e27, the rate will increase, otherwise decrease.
        uint256 usr;
        uint256 startRate;
    }

    USRConfig[] public usrConfigs;
    // The last epoch id that was updated.
    uint256 public lastEpochId;

    // Even when set a new USR config.
    event NewUSRConfig(uint256 indexed epochId, uint256 startTime, uint256 endTime, uint256 usr, uint256 startRate);

    modifier updateEpochId() {
        (lastEpochId, ) = _getRate(lastEpochId, block.timestamp);
        _;
    }

    function __USR_init(
        uint256 _initialUsrStartTime,
        uint256 _initialUsrEndTime,
        uint256 _initialUsr,
        uint256 _initialRate
    ) internal onlyInitializing {
        __Ownable2Step_init();

        lastEpochId = 0;
        _addNewUsrConfigInternal(_initialUsrStartTime, _initialUsrEndTime, _initialUsr, _initialRate);
    }

    /**
     * @dev Add a new USR config.
     */
    function _addNewUsrConfigInternal(
        uint256 _newUsrStartTime,
        uint256 _newUsrEndTime,
        uint256 _newUsr,
        uint256 _newRate
    ) internal {
        require(_newUsrEndTime > _newUsrStartTime, "Invalid new usr end time!");
        require(_newUsr >= MIN_USR && _newUsr <= MAX_USR, "Invalid new usr value!");

        usrConfigs.push(USRConfig({
            startTime: _newUsrStartTime,
            endTime: _newUsrEndTime,
            usr: _newUsr,
            startRate: _newRate
        }));

        emit NewUSRConfig(usrConfigs.length - 1, _newUsrStartTime, _newUsrEndTime, _newUsr, _newRate);
    }

    /**
     * @notice New USR config can not be inserted in the middle of the current array, 
     *         they can only be added to the end of the array.
     * @dev Add a new USR config.
     * @param _newUsrStartTime The start time of the new USR config.
     * @param _newUsrEndTime The end time of the new USR config.
     * @param _newUsr New USR value.
     */
    function _addNewUsrConfig(
        uint256 _newUsrStartTime,
        uint256 _newUsrEndTime,
        uint256 _newUsr
    ) external onlyOwner updateEpochId {
        require(_newUsrStartTime >= block.timestamp, "New usr start time should be later!");
        uint256 _length = usrConfigs.length;
        uint256 _lastEndTime = usrConfigs[_length - 1].endTime;
        require(_newUsrStartTime >= _lastEndTime, "New usr start time should be greater than last end time!");

        (, uint256 _newRate) = _getRate(_length - 1, _lastEndTime);
        _addNewUsrConfigInternal(_newUsrStartTime, _newUsrEndTime, _newUsr, _newRate);
    }

    /**
     * @dev Get the USR rate by the given time.
     * @param _startEpochId The start epoch id.
     * @param _timestamp The time to get the USR rate.
     * @return _epochId The latest epoch id for the given time.
     * @return _rate The USR rate.
     */
    function _getRate(uint256 _startEpochId, uint256 _timestamp) internal view returns (uint256 _epochId, uint256 _rate) {
        USRConfig memory _usrConfig;
        uint256 _elapsedTime;

        uint256 _length = usrConfigs.length;
        for (uint256 i =_startEpochId; i < _length; ) {
            _usrConfig = usrConfigs[i];
            _epochId = i;

            if (_timestamp <= _usrConfig.endTime) {
                _elapsedTime = _timestamp < _usrConfig.startTime ? 0 : _timestamp - _usrConfig.startTime;
                break;
            } else {
                _elapsedTime = _usrConfig.endTime - _usrConfig.startTime;
            }

            unchecked {
                ++i;
            }
        }
        _rate = _usrConfig.startRate._rmul(_usrConfig.usr._rpow(_elapsedTime, RAY));
    }

    /**
     * @dev Get the USR rate by the given time.
     * @param _time The time to get the USR rate.
     * @return _rate The USR rate.
     */
    function getRateByTime(uint256 _time) external view returns (uint256 _rate) {
        (, _rate) = _getRate(0, _time);
    }

    /**
     * @dev Get the current accumulated USR rate.
     */
    function currentRate() external view returns (uint256 _rate) {
        (, _rate) = _getRate(lastEpochId, block.timestamp);
    }

    /**
     * @dev Get the total length of the USR configs.
     */
    function usrConfigsLength() external view returns (uint256) {
        return usrConfigs.length;
    }

    function currentAPY() external view returns (uint256 _apy, uint256 _startTime, uint256 _endTime) {
        (uint256 _currentEpochId,) = _getRate(lastEpochId, block.timestamp);
        USRConfig memory _newerUsr = usrConfigs[_currentEpochId];

        if (block.timestamp > _newerUsr.startTime && block.timestamp < _newerUsr.endTime) {
            _apy = _newerUsr.usr._rpow(365 days, RAY);
            _startTime = _newerUsr.startTime;
            _endTime = _newerUsr.endTime;
        }
    }

    function nextAPY() external view returns (uint256 _apy, uint256 _startTime, uint256 _endTime) {
        (uint256 _currentEpochId,) = _getRate(lastEpochId, block.timestamp);
        uint256 _newestEpochId = _currentEpochId;

        if (block.timestamp >= usrConfigs[_currentEpochId].startTime) {
            _newestEpochId = _currentEpochId + 1;
        }

        if (_newestEpochId > usrConfigs.length -1) {
            return (0,0,0);
        } 

        USRConfig memory _newestUsr = usrConfigs[_newestEpochId];
        _apy = _newestUsr.usr._rpow(365 days, RAY);
        _startTime = _newestUsr.startTime;
        _endTime = _newestUsr.endTime;
    }
}
