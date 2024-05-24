// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ERC4626Upgradeable,ERC20Upgradeable,MathUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {IERC1271} from "./interface/IERC1271.sol";
import {IMSD,IMSDController} from "./interface/IMSDMintable.sol";
import "./helper/MathHelper.sol";

contract sUSX is Initializable, Ownable2StepUpgradeable, PausableUpgradeable, ERC20PermitUpgradeable, ERC4626Upgradeable, MathHelper {
    using MathUpgradeable for uint256;

    uint256 private constant MAX_USR = 2 * 10 ** 27;
    uint256 private constant MIN_USR = 0;

    address public msdController;
    uint256 internal totalStaked;
    uint256 internal totalUnstaked;
    uint256 public mintCap; // Cap to mint sUSX

    struct UsrDetail {
        uint256 startTime;
        uint256 endTime;
        uint256 usr;
        uint256 startRate;
    }

    UsrDetail[] public usrDetails;
    uint256 public lastEpochId;

    modifier updateRate(uint256 _time) {
        (uint256 currentEpochId, ) = getRateByEpochId(lastEpochId, _time);
        if (currentEpochId > lastEpochId) {
            lastEpochId = currentEpochId;
        }
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        IERC20Upgradeable _usx,
        address _msdController,
        uint256 _mintCap,
        uint256 _initialUsrStartTime,
        uint256 _initialUsrEndTime,
        uint256 _initialUsr
    ) {
        initialize(_name, _symbol, _usx, _msdController, _mintCap, _initialUsrStartTime, _initialUsrEndTime, _initialUsr);
    }

    function initialize(
        string memory _name,
        string memory _symbol,
        IERC20Upgradeable _usx,
        address _msdController,
        uint256 _mintCap,
        uint256 _initialUsrStartTime,
        uint256 _initialUsrEndTime,
        uint256 _initialUsr
    ) public initializer {
        require(_initialUsrStartTime >= block.timestamp, "Invalid usr start time!");
        require(_initialUsrEndTime > _initialUsrStartTime, "Invalid usr end time!");
        require(_initialUsr > MIN_USR && _initialUsr < MAX_USR, "Invalid usr value!");
        
        __Ownable2Step_init();
        __Pausable_init();
        __ERC20Permit_init(_symbol);
        __ERC4626_init(_usx);
        __ERC20_init(_name, _symbol);

        msdController = _msdController;
        mintCap = _mintCap;
        lastEpochId = 0;
        usrDetails.push(UsrDetail({
            startTime: _initialUsrStartTime,
            endTime: _initialUsrEndTime,
            usr: _initialUsr,
            startRate: RAY
        }));
    }

    function decimals() public pure override(ERC4626Upgradeable, ERC20Upgradeable) returns (uint8) {
        return 18;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _setMintCap(uint256 _mintCap) external onlyOwner {
        mintCap = _mintCap;
    }

    function _setNewUsr(
        uint256 _newUsrStartTime,
        uint256 _newUsrEndTime,
        uint256 _newUsr
    ) external onlyOwner {
        require(_newUsrStartTime >= block.timestamp, "Invalid new usr start time!");
        require(_newUsrEndTime > _newUsrStartTime, "Invalid new usr end time!");
        require(_newUsr > MIN_USR && _newUsr < MAX_USR, "Invalid new usr value!");

        uint256 _length = usrDetails.length;
        // Length always is greater than 1.
        uint256 _lastEpochEndTime = usrDetails[_length - 1].endTime;
        if (_lastEpochEndTime > _newUsrStartTime) {
            _lastEpochEndTime = _newUsrStartTime;
        }

        (uint256 _currentEpochId, uint256 _newRate) = getRateByEpochId(lastEpochId, _lastEpochEndTime);
        if (_currentEpochId > lastEpochId) {
            lastEpochId = _currentEpochId;
        }

        usrDetails.push(UsrDetail({
            startTime: _newUsrStartTime,
            endTime: _newUsrEndTime,
            usr: _newUsr,
            startRate: _newRate
        }));
    }

    function getRateByEpochId(uint256 _startEpochId, uint256 _timestamp) public view returns (uint256 _epochId, uint256 _rateAccumulator) {
        UsrDetail memory _usrInfo;
        uint256 _elapsedTime;

        uint256 _length = usrDetails.length;
        for (_epochId =_startEpochId; _epochId < _length; ) {
            _usrInfo = usrDetails[_epochId];

            if (_timestamp <= _usrInfo.endTime) {
                _elapsedTime = _timestamp < _usrInfo.startTime ? 0 : _timestamp - _usrInfo.startTime;
                break;
            } else {
                _elapsedTime = _usrInfo.endTime - _usrInfo.startTime;
            }

            unchecked {
                ++_epochId;
            }
        }
        _rateAccumulator = _rmul(_rpow(_usrInfo.usr, _elapsedTime, RAY), _usrInfo.startRate);
    }

    function currentAccumulatedRate() external view returns (uint256 _rateAccumulator) {
        (, _rateAccumulator) = getRateByEpochId(lastEpochId, block.timestamp);
    }

    function currentInterestRate() public view returns (uint256 _interestRate, uint256 _startTime, uint256 _endTime) {
        (uint256 currentEpochId, ) = getRateByEpochId(lastEpochId, block.timestamp);
        UsrDetail memory usrInfo = usrDetails[currentEpochId];

        if (block.timestamp >= usrInfo.startTime &&
            block.timestamp < usrInfo.endTime
        ) {
            _interestRate = usrInfo.usr;
            _startTime = usrInfo.startTime;
            _endTime = usrInfo.endTime;
        }
    }

    function totalMint() external view returns (uint256) {
        if (totalUnstaked < totalStaked) {
            return 0;
        } else {
            return totalUnstaked - totalStaked;
        }
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        require(receiver != address(0) && receiver != address(this), "Invalid recipient address!");

        totalStaked = totalStaked + assets;
        IMSD(asset()).burn(caller, assets);

        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        _burn(owner, shares);
        totalUnstaked = totalUnstaked + assets;
        IMSDController(msdController).mintMSD(asset(), receiver, assets);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function totalAssets() public view override returns (uint256) {
        return convertToAssets(totalSupply());
    }

    function _convertToAssets(uint256 shares, MathUpgradeable.Rounding rounding) internal view override returns (uint256) {
        (, uint256 rateAccumulator) = getRateByEpochId(lastEpochId, block.timestamp);
        return shares.mulDiv(rateAccumulator, RAY, rounding);
    }

    function _convertToShares(uint256 assets, MathUpgradeable.Rounding rounding) internal view override returns (uint256) {
        (, uint256 rateAccumulator) = getRateByEpochId(lastEpochId, block.timestamp);
        return assets.mulDiv(RAY, rateAccumulator, rounding);
    }

    function maxDeposit(address) public view override returns (uint256) {
        return _convertToAssets(mintCap - totalSupply(), MathUpgradeable.Rounding.Down);
    }

    function maxMint(address) public view override returns (uint256) {
        return mintCap - totalSupply();
    }

    function deposit(uint256 assets, address receiver) public whenNotPaused updateRate(block.timestamp) override returns (uint256 shares) {
        shares = _convertToShares(assets, MathUpgradeable.Rounding.Down);

        require(shares + totalSupply() <= mintCap, "Exceeds mint cap!");
        _deposit(_msgSender(), receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public whenNotPaused updateRate(block.timestamp) override returns (uint256 assets){
        require(shares <= maxMint(receiver), "Exceeds mint cap!");

        assets = _convertToAssets(shares, MathUpgradeable.Rounding.Up);
        _deposit(_msgSender(), receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) public whenNotPaused updateRate(block.timestamp) override returns (uint256 shares) {
        require(assets <= maxWithdraw(owner), "Withdraw more than max");

        shares = _convertToShares(assets, MathUpgradeable.Rounding.Up);

        _withdraw(_msgSender(), receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) public whenNotPaused updateRate(block.timestamp) override returns (uint256 assets) {
        require(shares <= maxRedeem(owner), "Redeem more than max");

        assets = _convertToAssets(shares, MathUpgradeable.Rounding.Down);

        _withdraw(_msgSender(), receiver, owner, assets, shares);
    }

    function usrConfigsLength() external view returns (uint256) {
        return usrDetails.length;
    }

    function currentAPY() external view returns (uint256 apy, uint256 startTime, uint256 endTime) {
        uint256 _secondsPerYear = 365 * 24 * 60 * 60;
        uint256 _interestRate;
        (_interestRate, startTime, endTime) = currentInterestRate();

        apy = _rpow(_interestRate, _secondsPerYear, RAY);
    }

    function nextAPY() external view returns (uint256 apy, uint256 startTime, uint256 endTime) {
        uint256 _secondsPerYear = 365 * 24 * 60 * 60;
        uint256 _length = usrDetails.length;

        UsrDetail memory _newestUsr = usrDetails[_length - 1];
        if (block.timestamp < _newestUsr.startTime) {
            apy = _rpow(_newestUsr.usr, _secondsPerYear, RAY);
            startTime = _newestUsr.startTime;
            endTime = _newestUsr.endTime;
        }
    }
}
