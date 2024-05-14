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
import {IUSXSavingRate} from "./interface/IUSXSavingRate.sol";

contract sUSX is Initializable, Ownable2StepUpgradeable, PausableUpgradeable, ERC20PermitUpgradeable, ERC4626Upgradeable {
    using MathUpgradeable for uint256;

    uint256 private constant RAY = 10 ** 27;

    address public usxSavingRate;
    address public msdController;
    uint256 internal totalStaked;
    uint256 internal totalUnstaked;
    uint256 public mintCap; // Cap to mint sUSX

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _usxSavingRate,
        IERC20Upgradeable _usx,
        address _msdController,
        uint256 _mintCap
    ) external initializer {
        __Ownable2Step_init();
        __Pausable_init();
        __ERC20Permit_init("sUSX");
        __ERC4626_init(_usx);
        __ERC20_init("USX Savings", "sUSX");

        usxSavingRate = _usxSavingRate;
        msdController = _msdController;
        mintCap = _mintCap;
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
        uint256 lastAccumulatedTime = IUSXSavingRate(usxSavingRate).lastAccumulatedTime();
        uint256 usr = IUSXSavingRate(usxSavingRate).usr();
        uint256 rateAccumulator = (block.timestamp > lastAccumulatedTime) ? _rpow(usr, block.timestamp - lastAccumulatedTime) * IUSXSavingRate(usxSavingRate).rateAccumulator() / RAY : IUSXSavingRate(usxSavingRate).rateAccumulator();
        return shares.mulDiv(rateAccumulator, RAY, rounding);
    }

    function _convertToShares(uint256 assets, MathUpgradeable.Rounding rounding) internal view override returns (uint256) {
        uint256 lastAccumulatedTime = IUSXSavingRate(usxSavingRate).lastAccumulatedTime();
        uint256 usr = IUSXSavingRate(usxSavingRate).usr();
        uint256 rateAccumulator = (block.timestamp > lastAccumulatedTime) ? _rpow(usr, block.timestamp - lastAccumulatedTime) * IUSXSavingRate(usxSavingRate).rateAccumulator() / RAY : IUSXSavingRate(usxSavingRate).rateAccumulator();
        return assets.mulDiv(RAY, rateAccumulator, rounding);
    }

    function maxDeposit(address) public view override returns (uint256) {
        return _convertToAssets(mintCap - totalSupply(), MathUpgradeable.Rounding.Down);
    }

    function maxMint(address) public view override returns (uint256) {
        return mintCap - totalSupply();
    }

    function deposit(uint256 assets, address receiver) public whenNotPaused override returns (uint256 shares) {
        uint256 usrRateAccumulator = IUSXSavingRate(usxSavingRate).accumulateUsr();
        shares = assets * RAY / usrRateAccumulator;

        require(shares + totalSupply() <= mintCap, "Exceeds mint cap!");
        _deposit(_msgSender(), receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) public whenNotPaused override returns (uint256 assets){
        require(shares <= maxMint(receiver), "Exceeds mint cap!");

        uint256 usrRateAccumulator = IUSXSavingRate(usxSavingRate).accumulateUsr();
        assets = shares.mulDiv(usrRateAccumulator, RAY, MathUpgradeable.Rounding.Up);
        _deposit(_msgSender(), receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) public whenNotPaused override returns (uint256 shares) {
        require(assets <= maxWithdraw(owner), "Withdraw more than max");

        uint256 usrRateAccumulator = IUSXSavingRate(usxSavingRate).accumulateUsr();
        shares = assets.mulDiv(RAY, usrRateAccumulator, MathUpgradeable.Rounding.Up);

        _withdraw(_msgSender(), receiver, owner, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) public whenNotPaused override returns (uint256 assets) {
        require(shares <= maxRedeem(owner), "Redeem more than max");

        uint256 usrRateAccumulator = IUSXSavingRate(usxSavingRate).accumulateUsr();
        assets = shares.mulDiv(usrRateAccumulator, RAY, MathUpgradeable.Rounding.Down);

        _withdraw(_msgSender(), receiver, owner, assets, shares);
    }
}
