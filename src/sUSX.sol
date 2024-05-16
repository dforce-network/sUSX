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

contract sUSX is Initializable, Ownable2StepUpgradeable, PausableUpgradeable, ERC20PermitUpgradeable, ERC4626Upgradeable {
    using MathUpgradeable for uint256;

    uint256 private constant RAY = 10 ** 27;
    uint256 private constant MAX_USR = 2 * 10 ** 27;
    uint256 private constant MIN_USR = 0;

    address public msdController;
    uint256 internal totalStaked;
    uint256 internal totalUnstaked;
    uint256 public mintCap; // Cap to mint sUSX

    uint256 public accumulatedRate;

    struct UsrDetail {
        uint256 startTime;
        uint256 endTime;
        uint256 usr;
    }

    UsrDetail[] public usrDetails;

    modifier updateRate() {
        uint256 length = usrDetails.length;

        if (block.timestamp > usrDetails[length - 1].endTime) {
            accumulatedRate = _currentAccumulatedRateInternal();
        }
        _;
    }

    constructor() {
        _disableInitializers();
    }

    function initialize(
        IERC20Upgradeable _usx,
        address _msdController,
        uint256 _mintCap,
        uint256 _initialUsrStartTime,
        uint256 _initialUsrEndTime,
        uint256 _initialUsr
    ) external initializer {
        require(_initialUsrStartTime >= block.timestamp, "Invalid usr start time!");
        require(_initialUsrEndTime > block.timestamp, "Invalid usr end time!");
        require(_initialUsr > MIN_USR && _initialUsr < MAX_USR, "Invalid usr value!");
        
        __Ownable2Step_init();
        __Pausable_init();
        __ERC20Permit_init("sUSX");
        __ERC4626_init(_usx);
        __ERC20_init("USX Savings", "sUSX");

        accumulatedRate = RAY;
        msdController = _msdController;
        mintCap = _mintCap;
        usrDetails.push(UsrDetail({
            startTime: _initialUsrStartTime,
            endTime: _initialUsrEndTime,
            usr: _initialUsr
        }));
    }

    // _decimalsOffset is 0.
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
    ) external onlyOwner updateRate {
        require(_newUsrStartTime >= block.timestamp, "Invalid new usr start time!");
        require(_newUsrEndTime > block.timestamp, "Invalid new usr end time!");
        require(_newUsr > MIN_USR && _newUsr < MAX_USR, "Invalid new usr value!");

        uint256 _length = usrDetails.length;
        // Length always is greater than 1.
        if (usrDetails[_length - 1].endTime > _newUsrStartTime) {
            usrDetails[_length - 1].endTime = _newUsrStartTime;
        }

        usrDetails.push(UsrDetail({
            startTime: _newUsrStartTime,
            endTime: _newUsrEndTime,
            usr: _newUsr
        }));
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

    function _currentAccumulatedRateInternal() internal view returns (uint256 _rateAccumulator) {
        uint256 length = usrDetails.length;

        if (length == 1) {
            UsrDetail memory initialUsr = usrDetails[0];
            uint256 accumulatedEndTime = block.timestamp > initialUsr.endTime ? initialUsr.endTime : block.timestamp;
            uint256 elapsedTime = accumulatedEndTime - initialUsr.startTime;

            _rateAccumulator = _rmul(_rpow(initialUsr.usr, elapsedTime, RAY), accumulatedRate);
        } else {
            UsrDetail memory newestUsr = usrDetails[length - 1];
            UsrDetail memory newerUsr = usrDetails[length - 2];

            uint256 accumulatedEndTime = block.timestamp > newerUsr.endTime ? newerUsr.endTime : block.timestamp;
            uint256 elapsedTime = accumulatedEndTime - newerUsr.startTime;
            _rateAccumulator = _rmul(_rpow(newerUsr.usr, elapsedTime, RAY), accumulatedRate);

            if (block.timestamp > newestUsr.startTime) {
                accumulatedEndTime = block.timestamp > newestUsr.endTime ? newestUsr.endTime : block.timestamp;
                elapsedTime = accumulatedEndTime - newestUsr.startTime;
                _rateAccumulator = _rmul(_rpow(newestUsr.usr, elapsedTime, RAY), _rateAccumulator);
            }
        }
    }

    function currentAccumulatedRate() external view returns (uint256 _rateAccumulator) {
        _rateAccumulator = _currentAccumulatedRateInternal();
    }

    function currentInterestRate() external view returns (uint256 _interestRate) {
        if (block.timestamp > usrDetails[usrDetails.length - 1].startTime &&
            block.timestamp < usrDetails[usrDetails.length - 1].endTime) {
            _interestRate = usrDetails[usrDetails.length - 1].usr;
        }
    }

    function totalMint() external view returns (uint256) {
        if (totalUnstaked < totalStaked) {
            return 0;
        } else {
            return totalUnstaked - totalStaked;
        }
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
        uint256 rateAccumulator = _currentAccumulatedRateInternal();
        return shares.mulDiv(rateAccumulator, RAY, rounding);
    }

    function _convertToShares(uint256 assets, MathUpgradeable.Rounding rounding) internal view override returns (uint256) {
        uint256 rateAccumulator = _currentAccumulatedRateInternal();
        return assets.mulDiv(RAY, rateAccumulator, rounding);
    }

    function maxDeposit(address) public view override returns (uint256) {
        return _convertToAssets(mintCap - totalSupply(), MathUpgradeable.Rounding.Down);
    }

    function maxMint(address) public view override returns (uint256) {
        return mintCap - totalSupply();
    }

    function deposit(uint256 assets, address receiver) public whenNotPaused updateRate override returns (uint256 shares) {
        uint256 usrRateAccumulator = _currentAccumulatedRateInternal();
        shares = assets * RAY / usrRateAccumulator;

        require(shares + totalSupply() <= mintCap, "Exceeds mint cap!");
        _deposit(_msgSender(), receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public whenNotPaused updateRate override returns (uint256 assets){
        require(shares <= maxMint(receiver), "Exceeds mint cap!");

        uint256 usrRateAccumulator = _currentAccumulatedRateInternal();
        assets = shares.mulDiv(usrRateAccumulator, RAY, MathUpgradeable.Rounding.Up);
        _deposit(_msgSender(), receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) public whenNotPaused updateRate override returns (uint256 shares) {
        require(assets <= maxWithdraw(owner), "Withdraw more than max");

        uint256 usrRateAccumulator = _currentAccumulatedRateInternal();
        shares = assets.mulDiv(RAY, usrRateAccumulator, MathUpgradeable.Rounding.Up);

        _withdraw(_msgSender(), receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) public whenNotPaused updateRate override returns (uint256 assets) {
        require(shares <= maxRedeem(owner), "Redeem more than max");

        uint256 usrRateAccumulator = _currentAccumulatedRateInternal();
        assets = shares.mulDiv(usrRateAccumulator, RAY, MathUpgradeable.Rounding.Down);

        _withdraw(_msgSender(), receiver, owner, assets, shares);
    }

    function usrConfigsLength() external view returns (uint256) {
        return usrDetails.length;
    }
}
