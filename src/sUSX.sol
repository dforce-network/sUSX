// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {AccessControlEnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ERC4626Upgradeable,ERC20Upgradeable,MathUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {IMSD,IMSDController} from "./interface/IMSDMintable.sol";
import {USR} from "./USR.sol";

/// @title Savings USX
/// @notice This contract extends ERC4626, and there is no fee for depositing or withdrawing.
/// @dev User can deposit USX to get sUSX(Savings USX) earn interest.
///      Each sUSX accrues USX interest at the USR(USX Savings Rate).
///      USX will be burned when deposit and be minted again when withdraw sUSX.
contract sUSX is Initializable, PausableUpgradeable, AccessControlEnumerableUpgradeable, ERC20PermitUpgradeable, ERC4626Upgradeable, USR {
    using MathUpgradeable for uint256;

    address public msdController;
    // Total amount of USX staked, pure funds only
    uint256 public totalStaked;
    // Total amount of USX unstaked, including funds and interest
    uint256 public totalUnstaked;
    // Cap to mint sUSX
    uint256 public mintCap;

    bytes32 public constant BRIDGER_ROLE = keccak256("BRIDGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    event NewMintCap(uint256 indexed oldMintCap, uint256 indexed newMintCap);
    event Stake(uint256 indexed stakeAmount);
    event Unstake(uint256 indexed unstakeAmount);

    event DepositFinalized(address receiver, uint256 assets, uint256 shares);
    event WithdrawalInitiated(address owner, uint256 assets, uint256 shares);

    constructor(
        string memory _name,
        string memory _symbol,
        IERC20Upgradeable _usx,
        address _msdController,
        uint256 _mintCap,
        uint256 _initialUsrStartTime,
        uint256 _initialUsrEndTime,
        uint256 _initialUsr,
        uint256 _initialRate
    ) {
        initialize(_name, _symbol, _usx, _msdController, _mintCap, _initialUsrStartTime, _initialUsrEndTime, _initialUsr, _initialRate);
    }

    function initialize(
        string memory _name,
        string memory _symbol,
        IERC20Upgradeable _usx,
        address _msdController,
        uint256 _mintCap,
        uint256 _initialUsrStartTime,
        uint256 _initialUsrEndTime,
        uint256 _initialUsr,
        uint256 _initialRate
    ) public initializer {
        __Ownable2Step_init();
        __Pausable_init();
        __AccessControl_init();
        __ERC20Permit_init(_symbol);
        __ERC4626_init(_usx);
        __ERC20_init(_name, _symbol);
        __USR_init(_initialUsrStartTime, _initialUsrEndTime, _initialUsr, _initialRate);

        msdController = _msdController;
        mintCap = _mintCap;

        emit NewMintCap(0, mintCap);
    }

    function decimals() public pure override(ERC4626Upgradeable, ERC20Upgradeable) returns (uint8) {
        return 18;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Internal function to transfer ownership along with the DEFAULT_ADMIN_ROLE
     */
    function _transferOwnership(address newOwner) internal virtual override {
        _revokeRole(DEFAULT_ADMIN_ROLE, owner());
        _revokeRole(PAUSER_ROLE, owner());
        super._transferOwnership(newOwner);
        _grantRole(DEFAULT_ADMIN_ROLE, newOwner);
        _grantRole(PAUSER_ROLE, newOwner);
    }

    function _setMintCap(uint256 _newMintCap) external onlyOwner {
        uint256 oldMintCap = mintCap;
        require(_newMintCap != oldMintCap, "New mint cap is the same as the old one!");
        mintCap = _newMintCap;

        emit NewMintCap(oldMintCap, _newMintCap);
    }

    /**
     * @notice Only used for the `msdController` contract.
     *         Lazy mint USX interest, that is only minted if `totalUnstaked` > `totalStaked`.
     *         How to use this value can be found in `msdController` contract.
     * @dev Get the total amount of USX interest minted by sUSX.
     */
    function totalMint() external view returns (uint256) {
        if (totalUnstaked < totalStaked) {
            return 0;
        } else {
            return totalUnstaked - totalStaked;
        }
    }

    function _mint(address receiver, uint256 assets, uint256 shares) internal {
        _mint(receiver, shares);

        totalStaked = totalStaked + assets;
        emit Stake(assets);
    }

    function _burn(address owner, uint256 assets, uint256 shares) internal {
        _burn(owner, shares);

        totalUnstaked = totalUnstaked + assets;
        emit Unstake(assets);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        require(receiver != address(0) && receiver != address(this), "Invalid recipient address!");

        IMSD(asset()).burn(caller, assets);
        _mint(receiver, assets, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        require(receiver != address(0) && receiver != address(this), "Invalid recipient address!");
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        _burn(owner, assets, shares);
        IMSDController(msdController).mintMSD(asset(), receiver, assets);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function totalAssets() public view override returns (uint256) {
        return _convertToAssets(totalSupply(), MathUpgradeable.Rounding.Down);
    }

    function _convertToAssets(uint256 shares, MathUpgradeable.Rounding rounding) internal view override returns (uint256) {
        (, uint256 _currentRate) = _getRate(lastEpochId, block.timestamp);
        return shares.mulDiv(_currentRate, RAY, rounding);
    }

    function _convertToShares(uint256 assets, MathUpgradeable.Rounding rounding) internal view override returns (uint256) {
        (, uint256 _currentRate) = _getRate(lastEpochId, block.timestamp);
        return assets.mulDiv(RAY, _currentRate, rounding);
    }

    function maxDeposit(address) public view override returns (uint256) {
        return _convertToAssets(mintCap - totalSupply(), MathUpgradeable.Rounding.Down);
    }

    function maxMint(address) public view override returns (uint256) {
        return mintCap - totalSupply();
    }

    function deposit(uint256 assets, address receiver) public updateEpochId override returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public updateEpochId override returns (uint256){
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public updateEpochId override returns (uint256) {
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public updateEpochId override returns (uint256) {
        return super.redeem(shares, receiver, owner);
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal whenNotPaused override {
        super._beforeTokenTransfer(from, to, amount);
    }

    function outboundTransferShares(
        uint256 shares,
        address owner
    ) external onlyRole(BRIDGER_ROLE) updateEpochId {
        uint256 assets = previewRedeem(shares);
        _burn(owner, assets, shares);

        emit WithdrawalInitiated(owner, assets, shares);
    }

    function finalizeInboundTransferShares(
        uint256 shares,
        address receiver
    ) external onlyRole(BRIDGER_ROLE) updateEpochId {
        require(shares <= maxMint(receiver), "ERC4626: mint more than max");

        uint256 assets = previewMint(shares);
        _mint(receiver, assets, shares);

        emit DepositFinalized(receiver, assets, shares);
    }
}
