// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

interface IUSXSavingRate {
    function usr() external view returns (uint256);
    function rateAccumulator() external view returns (uint256);
    function nextUsr() external view returns (uint256);
    function nextUsrTime() external view returns (uint256);
    function lastAccumulatedTime() external view returns (uint256);
    function userSavingsUsx(address _user) external view returns (uint256);
    function accumulateUsr() external returns (uint256);
}
