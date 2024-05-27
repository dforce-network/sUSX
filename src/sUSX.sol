// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {AccessControlEnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ERC4626Upgradeable,ERC20Upgradeable,MathUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {IERC1271} from "./interface/IERC1271.sol";
import {IMSD,IMSDController} from "./interface/IMSDMintable.sol";
import {USR} from "./USR.sol";

contract sUSX is Initializable, PausableUpgradeable, AccessControlEnumerableUpgradeable, ERC20PermitUpgradeable, ERC4626Upgradeable, USR {
    using MathUpgradeable for uint256;

    address public msdController;
    uint256 internal totalStaked;
    uint256 internal totalUnstaked;
    uint256 public mintCap; // Cap to mint sUSX

    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");

    event NewMintCap(uint256 indexed oldMintCap, uint256 indexed newMintCap);
    event Stake(uint256 indexed stakeAmount);
    event Unstake(uint256 indexed unstakeAmount);

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
        __Ownable2Step_init();
        __Pausable_init();
        __AccessControl_init();
        __ERC20Permit_init(_symbol);
        __ERC4626_init(_usx);
        __ERC20_init(_name, _symbol);
        __USR_init(_initialUsrStartTime, _initialUsrEndTime, _initialUsr);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(BRIDGE_ROLE, msg.sender);

        msdController = _msdController;
        mintCap = _mintCap;

        emit NewMintCap(0, mintCap);
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

    function _setMintCap(uint256 _newMintCap) external onlyOwner {
        uint256 oldMintCap = mintCap;
        require(_newMintCap != oldMintCap, "New mint cap is the same as the old one!");
        mintCap = _newMintCap;

        emit NewMintCap(oldMintCap, _newMintCap);
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

        emit Stake(assets);
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

        emit Unstake(assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function totalAssets() public view override returns (uint256) {
        (, uint256 currentRate) = _getRate(lastEpochId, block.timestamp);
        return currentRate.mulDiv(totalSupply(), RAY, MathUpgradeable.Rounding.Down);
    }

    function maxDeposit(address) public view override returns (uint256) {
        return _convertToAssets(mintCap - totalSupply(), MathUpgradeable.Rounding.Down);
    }

    function maxMint(address) public view override returns (uint256) {
        return mintCap - totalSupply();
    }

    function deposit(uint256 assets, address receiver) public whenNotPaused updateEpochId override returns (uint256 shares) {
        super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public whenNotPaused updateEpochId override returns (uint256 assets){
        super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public whenNotPaused updateEpochId override returns (uint256 shares) {
        super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public whenNotPaused updateEpochId override returns (uint256 assets) {
        super.withdraw(shares, receiver, owner);
    }

    function outboundTransferAsset(
        address receiver,
        uint256 asset,
        bytes calldata data
    ) external whenNotPaused updateEpochId {
        
    }

    function finalizeInboundTransfer() external whenNotPaused onlyRole(BRIDGE_ROLE) updateEpochId {}
}
