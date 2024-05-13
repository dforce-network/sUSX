// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {IERC1271} from "./interface/IERC1271.sol";
import {IMSD,IMSDController} from "./interface/IMSDMintable.sol";
import {IUSXSavingRate} from "./interface/IUSXSavingRate.sol";

contract sUSX is Initializable, Ownable2StepUpgradeable, PausableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    string public constant name = "USX Savings";
    string public constant symbol = "sUSX";
    string public constant version  = "1";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping (address => uint256) public nonces;

    uint256 private constant RAY = 10 ** 27;
    address public usxSavingRate;
    address public usx;
    address public msdController;
    uint256 internal totalStaked;
    uint256 internal totalUnstaked;
    uint256 public mintCap; // Cap to mint sUSX

    // EIP712
    uint256 public deploymentChainId;
    bytes32 private _DOMAIN_SEPARATOR;
    bytes32 public constant PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);


    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _usxSavingRate,
        address _usx,
        address _msdController,
        uint256 _mintCap
    ) external initializer {
        __Ownable2Step_init();
        __Pausable_init();

        usxSavingRate = _usxSavingRate;
        usx = _usx;
        msdController = _msdController;
        mintCap = _mintCap;

        deploymentChainId = block.chainid;
        _DOMAIN_SEPARATOR = _calculateDomainSeparator(block.chainid);
    }

    function _calculateDomainSeparator(uint256 chainId) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                address(this)
            )
        );
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return block.chainid == deploymentChainId ? _DOMAIN_SEPARATOR : _calculateDomainSeparator(block.chainid);
    }

    function _setMintCap(uint256 _mintCap) external onlyOwner {
        mintCap = _mintCap;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
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

    function _divup(uint256 x, uint256 y) internal pure returns (uint256 z) {
        unchecked {
            z = x != 0 ? ((x - 1) / y) + 1 : 0;
        }
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(to != address(0) && to != address(this), "Invalid recipient address!");
        uint256 balance = balanceOf[msg.sender];
        require(balance >= value, "Insufficient balance!");

        unchecked {
            balanceOf[msg.sender] = balance - value;
            balanceOf[to] = balanceOf[to] + value;
        }

        emit Transfer(msg.sender, to, value);

        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(to != address(0) && to != address(this), "Invalid recipient address!");
        uint256 balance = balanceOf[from];
        require(balance >= value, "Insufficient balance!");

        if (from != msg.sender) {
            uint256 allowed = allowance[from][msg.sender];
            if (allowed != type(uint256).max) {
                require(allowed >= value, "Insufficient allowance!");

                unchecked {
                    allowance[from][msg.sender] = allowed - value;
                }
            }
        }

        unchecked {
            balanceOf[from] = balance - value;
            balanceOf[to] = balanceOf[to] + value;
        }

        emit Transfer(from, to, value);

        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;

        emit Approval(msg.sender, spender, value);

        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        uint256 newValue = allowance[msg.sender][spender] + addedValue;
        allowance[msg.sender][spender] = newValue;

        emit Approval(msg.sender, spender, newValue);

        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        uint256 allowed = allowance[msg.sender][spender];
        require(allowed >= subtractedValue, "Insufficient allowance!");
        unchecked{
            allowed = allowed - subtractedValue;
        }
        allowance[msg.sender][spender] = allowed;

        emit Approval(msg.sender, spender, allowed);

        return true;
    }

    function totalMint() external view returns (uint256) {
        if (totalUnstaked < totalStaked) {
            return 0;
        } else {
            return totalUnstaked - totalStaked;
        }
    }

    function _mint(uint256 _assets, uint256 _shares, address _receiver) internal {
        require(_receiver != address(0) && _receiver != address(this), "Invalid recipient address");

        totalStaked = totalStaked + _assets;
        IMSD(usx).burn(msg.sender, _assets);

        balanceOf[_receiver] = balanceOf[_receiver] + _shares;
        totalSupply = totalSupply + _shares;

        emit Deposit(msg.sender, _receiver, _assets, _shares);
    }

    function _burn(uint256 _assets, uint256 _shares, address _receiver, address _owner) internal {
        uint256 _spenderBalance = balanceOf[_owner];
        require(_spenderBalance > _shares, "Spender has insufficient balance!");

        if (_owner != msg.sender) {
            uint256 _allowance = allowance[_owner][msg.sender];
            if (_allowance != type(uint256).max) {
                require(_allowance >= _shares, "Insufficient allowance!");
                unchecked {
                    allowance[_owner][msg.sender] = _allowance - _shares;
                }
            }
        }

        unchecked {
            balanceOf[_owner] = _spenderBalance - _shares;
            totalSupply = totalSupply - _shares;
        }

        totalUnstaked = totalUnstaked + _assets;
        IMSDController(msdController).mintMSD(usx, _receiver, _assets);

        emit Withdraw(msg.sender, _receiver, _owner, _assets, _shares);
    }

    // ERC 4626
    function asset() external view returns (address) {
        return usx;
    }

    function totalAssets() external view returns (uint256) {
        return convertToAssets(totalSupply);
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 lastAccumulatedTime = IUSXSavingRate(usxSavingRate).lastAccumulatedTime();
        uint256 usr = IUSXSavingRate(usxSavingRate).usr();
        uint256 rateAccumulator = (block.timestamp > lastAccumulatedTime) ? _rpow(usr, block.timestamp - lastAccumulatedTime) * IUSXSavingRate(usxSavingRate).rateAccumulator() / RAY : IUSXSavingRate(usxSavingRate).rateAccumulator();
        return assets * RAY / rateAccumulator;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 lastAccumulatedTime = IUSXSavingRate(usxSavingRate).lastAccumulatedTime();
        uint256 usr = IUSXSavingRate(usxSavingRate).usr();
        uint256 rateAccumulator = (block.timestamp > lastAccumulatedTime) ? _rpow(usr, block.timestamp - lastAccumulatedTime) * IUSXSavingRate(usxSavingRate).rateAccumulator() / RAY : IUSXSavingRate(usxSavingRate).rateAccumulator();
        return shares * rateAccumulator / RAY;
    }

    function maxDeposit(address) external view returns (uint256) {
        return convertToAssets(mintCap - totalSupply);
    }

    function previewDeposit(uint256 assets) external view returns (uint256) {
        return convertToShares(assets);
    }

    function deposit(uint256 assets, address receiver) external whenNotPaused returns (uint256 shares) {
        uint256 usrRateAccumulator = IUSXSavingRate(usxSavingRate).accumulateUsr();
        shares = assets * RAY / usrRateAccumulator;

        require(shares + totalSupply <= mintCap, "Exceeds mint cap!");
        _mint(assets, shares, receiver);
    }

    function maxMint(address) external view returns (uint256) {
        return mintCap - totalSupply;
    }

    function previewMint(uint256 shares) external view returns (uint256) {
        uint256 lastAccumulatedTime = IUSXSavingRate(usxSavingRate).lastAccumulatedTime();
        uint256 usr = IUSXSavingRate(usxSavingRate).usr();
        uint256 rateAccumulator = (block.timestamp > lastAccumulatedTime) ? _rpow(usr, block.timestamp - lastAccumulatedTime) * IUSXSavingRate(usxSavingRate).rateAccumulator() / RAY : IUSXSavingRate(usxSavingRate).rateAccumulator();
        return _divup(shares * rateAccumulator, RAY);
    }

    function mint(uint256 shares, address receiver) external whenNotPaused returns (uint256 assets){
        require(shares + totalSupply <= mintCap, "Exceeds mint cap!");
        uint256 usrRateAccumulator = IUSXSavingRate(usxSavingRate).accumulateUsr();
        assets = _divup(shares * usrRateAccumulator, RAY);
        _mint(assets, shares, receiver);
    }

    function maxWithdraw(address owner) external view returns (uint256) {
        return convertToAssets(balanceOf[owner]);
    }

    function previewWithdraw(uint256 assets) external view returns (uint256) {
        uint256 lastAccumulatedTime = IUSXSavingRate(usxSavingRate).lastAccumulatedTime();
        uint256 usr = IUSXSavingRate(usxSavingRate).usr();
        uint256 rateAccumulator = (block.timestamp > lastAccumulatedTime) ? _rpow(usr, block.timestamp - lastAccumulatedTime) * IUSXSavingRate(usxSavingRate).rateAccumulator() / RAY : IUSXSavingRate(usxSavingRate).rateAccumulator();
        return _divup(assets * RAY, rateAccumulator);
    }

    function withdraw(uint256 assets, address receiver, address owner) external whenNotPaused returns (uint256 shares) {
        uint256 usrRateAccumulator = IUSXSavingRate(usxSavingRate).accumulateUsr();
        shares = _divup(assets * RAY, usrRateAccumulator);

        _burn(assets, shares, receiver, owner);
    }

    function maxRedeem(address owner) external view returns (uint256) {
        return balanceOf[owner];
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return convertToAssets(shares);
    }

    function redeem(uint256 shares, address receiver, address owner) external whenNotPaused returns (uint256 assets) {
        uint256 usrRateAccumulator = IUSXSavingRate(usxSavingRate).accumulateUsr();
        assets = shares * usrRateAccumulator / RAY;

        _burn(assets, shares, receiver, owner);
    }

    // --- Approve by signature ---
    function _isValidSignature(
        address signer,
        bytes32 digest,
        bytes memory signature
    ) internal view returns (bool) {
        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := mload(add(signature, 0x20))
                s := mload(add(signature, 0x40))
                v := byte(0, mload(add(signature, 0x60)))
            }
            if (signer == ecrecover(digest, v, r, s)) {
                return true;
            }
        }

        (bool success, bytes memory result) = signer.staticcall(
            abi.encodeWithSelector(IERC1271.isValidSignature.selector, digest, signature)
        );
        return (success &&
            result.length == 32 &&
            abi.decode(result, (bytes4)) == IERC1271.isValidSignature.selector);
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        bytes memory signature
    ) public {
        require(block.timestamp <= deadline, "Permit expired!");
        require(owner != address(0), "Invalid owner!");

        uint256 nonce;
        unchecked { nonce = nonces[owner]++; }

        bytes32 digest =
            keccak256(abi.encodePacked(
                "\x19\x01",
                block.chainid == deploymentChainId ? _DOMAIN_SEPARATOR : _calculateDomainSeparator(block.chainid),
                keccak256(abi.encode(
                    PERMIT_TYPEHASH,
                    owner,
                    spender,
                    value,
                    nonce,
                    deadline
                ))
            ));

        require(_isValidSignature(owner, digest, signature), "Invalid permit!");

        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        permit(owner, spender, value, deadline, abi.encodePacked(r, s, v));
    }
}
