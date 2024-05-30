import {expect} from 'chai';
import {ethers, deployments, network, getUnnamedAccounts, getNamedAccounts} from 'hardhat';
import {MockERC20, SUSX} from '../typechain-types';
import {setupUser, setupUsers} from './utils';
import {increaseBlock, increaseTime, miningAutomatically, getCurrentTime} from './utils/helpers';

const setup = deployments.createFixture(async () => {
	await deployments.fixture('sUSX');
	const {deployer} = await getNamedAccounts();
	const contracts = {
		usx: await ethers.getContract<MockERC20>('USX'),
		sUSX: await ethers.getContract<SUSX>('sUSX'),
	};

	const users = await setupUsers(await getUnnamedAccounts(), contracts);
	return {
		...contracts,
		users,
		deployer: await setupUser(deployer, contracts),
	};
});

describe('sUSX', function () {
    let owner: any;
    let user1: any;
    let alice: any;
    let bob: any;
    let RAY = ethers.BigNumber.from("1000000000000000000000000000"); // 1e27

    before(async function () {
      const {deployer, sUSX, users, usx} = await setup();
      owner = deployer;
      user1 = users[1];
      alice = users[10];
      bob = users[11];

      expect(await owner.sUSX.usrConfigsLength()).to.eq("1");
      // Approve to sUSX to deposit
      await user1.usx.approve(user1.sUSX.address, ethers.constants.MaxUint256);
      // Approve to sUSX to deposit
      await alice.usx.approve(user1.sUSX.address, ethers.constants.MaxUint256);
      // Approve to sUSX to deposit
      await bob.usx.approve(user1.sUSX.address, ethers.constants.MaxUint256);
    });

    describe("Deposit", async function () {
      it("Deposit Normally", async function() {
        // Get free token
        let faucetAmount = ethers.utils.parseEther("10000");
        await user1.usx.mint(user1.address, faucetAmount);
        expect(await user1.usx.balanceOf(user1.address)).to.eq(faucetAmount);
        // Deposit: check USX
        let depositAmount = ethers.utils.parseEther("100");
        await expect(
            user1.sUSX.deposit(depositAmount, user1.address)
        ).to.changeTokenBalance(user1.usx, user1.address, depositAmount.mul(-1));

        // Just deploy the whole contracts, 
        // so increase timestamp manually to increase usr accumulated rate.
        let beforeAccumulatedRate = await user1.sUSX.currentRate();
        let usrDetails = await user1.sUSX.usrConfigs(0);
        let toIncreaseTime = usrDetails.startTime - await getCurrentTime();

        // Increase time to accumulate rate.
        await increaseTime(toIncreaseTime + 1);
        await increaseBlock(1);
        expect(await user1.sUSX.currentRate()).to.gt(beforeAccumulatedRate);

        // Deposit: check sUSX
        let nextRate = await user1.sUSX.getRateByTime((await getCurrentTime())+1);
        let shareMintedAmount = depositAmount.mul(RAY).div(nextRate);
        await expect( 
          user1.sUSX.deposit(depositAmount, user1.address)
        ).to.changeTokenBalance(user1.sUSX, user1.address, shareMintedAmount);
      });

      it("Deposit 1 wei asset, but get nothing", async function() {
        // Deposit: check USX
        await expect(
            user1.sUSX.deposit(1, user1.address)
        ).to.changeTokenBalance(user1.usx, user1.address, -1);

        // Deposit: check sUSX
        await expect( 
          user1.sUSX.deposit(1, user1.address)
        ).to.changeTokenBalance(user1.sUSX, user1.address, 0);
      });

      it("Deposit revert when contract is paused", async function() {
        await owner.sUSX.pause();
        expect(await owner.sUSX.paused()).to.be.true;

        await expect(
          user1.sUSX.deposit(1, user1.address)
        ).to.be.revertedWith("Pausable: paused");

        // Reset pause
        await owner.sUSX.unpause();
        expect(await owner.sUSX.paused()).to.be.false;
      });

      it("Deposit revert when recipient is invalid", async function() {
        // Revert due to recipient is zero address
        await expect(
          user1.sUSX.deposit(1, ethers.constants.AddressZero)
        ).to.be.revertedWith("Invalid recipient address!");

        // Revert due to recipient is sUSX contract
        await expect(
          user1.sUSX.deposit(1, user1.sUSX.address)
        ).to.be.revertedWith("Invalid recipient address!");
      });

      it("Deposit revert when caller doesn't have enough assets", async function () {
        let depositAmount = ethers.utils.parseEther("1000");
        expect(await alice.usx.balanceOf(alice.address)).to.lt(depositAmount);

        await expect(
          alice.sUSX.deposit(depositAmount, alice.address)
        ).to.be.revertedWith("ERC20: burn amount exceeds balance");
      });

      it("Deposit revert when exceeding mint cap", async function() {
        // Get free token
        let faucetAmount = await user1.sUSX.maxDeposit(user1.address);
        // Due to rate accumulated and calculation rounding down, 
        // so add 1 more to make sure it's enough.
        await user1.usx.mint(user1.address, faucetAmount.add("1"));

        // When call `deposit()`, the rate will accumulate for 1 second more
        let nextRate = await user1.sUSX.getRateByTime((await getCurrentTime())+1);
        let mintCap = await user1.sUSX.mintCap();
        let totalSupply = await user1.sUSX.totalSupply();
        let maxDepositAmount = mintCap.sub(totalSupply).mul(nextRate).div(RAY);
        // It will be rounded down when calculate the share amount,
        // so deposit `maxDepositAmount` will leave 1 wei share to reach the whole mint cap.
        await user1.sUSX.deposit(maxDepositAmount, user1.address);
        expect(await user1.sUSX.maxDeposit(user1.address)).to.eq(1);

        await expect(
          // It will be rounded down when calculate the share amount, and current `maxDepositAmount = 1`,
          // so deposit 2 wei asset to reach the whole mint cap.
          user1.sUSX.deposit(2, user1.address)
        ).to.be.revertedWith("ERC4626: deposit more than max");

        // Withdraw deposit to reset the mint cap
        await user1.sUSX.withdraw(maxDepositAmount, user1.address, user1.address);
      });
    });

    describe("Mint", async function () {
      it("Mint Normally", async function() {
        let mintAmount = ethers.utils.parseEther("1000");
        // Mint twice to check usx and sUSX, so user1 should have enough USX
        expect(await user1.usx.balanceOf(user1.address)).to.gt(mintAmount.mul(2));
        // Should not exceed mint cap
        expect(await user1.sUSX.maxMint(user1.address)).to.gt(mintAmount.mul(2));

        // Mint: check USX
        let nextRate = await user1.sUSX.getRateByTime((await getCurrentTime())+1);
        // Rounding down, so add 1 more asset.
        let assetBurnedAmount = mintAmount.mul(nextRate).div(RAY).add(1);
        await expect(
          user1.sUSX.mint(mintAmount, user1.address)
        ).to.changeTokenBalance(user1.usx, user1.address, assetBurnedAmount.mul(-1));

        // Mint: check sUSX
        await expect(
          user1.sUSX.mint(mintAmount, user1.address)
        ).to.changeTokenBalance(user1.sUSX, user1.address, mintAmount);
      });

      it("Mint 1 wei share, cost at least 2 wei asset", async function() {
        // Mint: check USX
        // Rounding down, so add 1 more asset.
        await expect(
          user1.sUSX.mint(1, user1.address)
        ).to.changeTokenBalance(user1.usx, user1.address, -2);

        // Mint: check sUSX
        await expect(
          user1.sUSX.mint(1, user1.address)
        ).to.changeTokenBalance(user1.sUSX, user1.address, 1);
      
      });

      it("Mint revert when contract is paused", async function() {
        await owner.sUSX.pause();
        expect(await owner.sUSX.paused()).to.be.true;

        await expect(
          user1.sUSX.mint(1, user1.address)
        ).to.be.revertedWith("Pausable: paused");

        // Reset pause
        await owner.sUSX.unpause();
        expect(await owner.sUSX.paused()).to.be.false;
      });

      it("Mint revert when mint more than max", async function() {
        let maxMintAmount = await user1.sUSX.maxMint(user1.address);
        await expect(
          user1.sUSX.mint(maxMintAmount.add(1), user1.address)
        ).to.be.revertedWith("ERC4626: mint more than max");
      });

      it("Mint revert when recipient is invalid", async function() {
        // Revert due to recipient is zero address
        await expect(
          user1.sUSX.mint(1, ethers.constants.AddressZero)
        ).to.be.revertedWith("Invalid recipient address!");

        // Revert due to recipient is sUSX contract
        await expect(
          user1.sUSX.mint(1, user1.sUSX.address)
        ).to.be.revertedWith("Invalid recipient address!");
      });

      it("Mint revert when caller doesn't have enough assets", async function () {
        let mintAmount = ethers.utils.parseEther("1000");
        expect(await alice.usx.balanceOf(alice.address)).to.lt(mintAmount);

        // Approve to sUSX to mint
        await alice.usx.approve(alice.sUSX.address, ethers.constants.MaxUint256);
        await expect(
          alice.sUSX.mint(mintAmount, alice.address)
        ).to.be.revertedWith("ERC20: burn amount exceeds balance");
      
      });
    });

    describe("Withdraw", async function () {
      it("Withdraw Normally", async function() {
        // Deposit at first
        let depositAmount = ethers.utils.parseEther("1000");
        await user1.sUSX.deposit(depositAmount, user1.address);
        let withdrawAmount = depositAmount.div(2);
        // Withdraw twice to check usx and sUSX
        expect(await user1.sUSX.maxWithdraw(user1.address)).to.gt(withdrawAmount.mul(2));

        // Withdraw: check USX
        await expect(
          user1.sUSX.withdraw(withdrawAmount, user1.address, user1.address)
        ).to.changeTokenBalance(user1.usx, user1.address, withdrawAmount);

        // Withdraw: check sUSX
        let nextRate = await user1.sUSX.getRateByTime((await getCurrentTime())+1);
        // Due to math rounding up of the rate calculation, so add 1 share more.
        let shareBurnedAmount = withdrawAmount.mul(RAY).div(nextRate).add(1);

        await expect(
          user1.sUSX.withdraw(withdrawAmount, user1.address, user1.address)
        ).to.changeTokenBalance(user1.sUSX, user1.address, shareBurnedAmount.mul(-1));
      });

      it("Withdraw 1 wei asset, cost 1 share at least", async function() {
        // Check USX
        await expect(
          user1.sUSX.withdraw(1, user1.address, user1.address)
        ).to.changeTokenBalance(user1.usx, user1.address, 1);

        // Check sUSX
        await expect(
          user1.sUSX.withdraw(1, user1.address, user1.address)
        ).to.changeTokenBalance(user1.sUSX, user1.address, -1);
      });

      it("Withdraw revert when contract is paused", async function() {
        await owner.sUSX.pause();
        expect(await owner.sUSX.paused()).to.be.true;

        await expect(
          user1.sUSX.withdraw(1, user1.address, user1.address)
        ).to.be.revertedWith("Pausable: paused");

        // Reset pause
        await owner.sUSX.unpause();
        expect(await owner.sUSX.paused()).to.be.false;
      });

      it("Withdraw revert when withdraw more than max", async function() {
        // Revert when withdraw from caller self.
        let nextRate = await user1.sUSX.getRateByTime((await getCurrentTime())+1);
        let user1ShareBalance = await user1.sUSX.balanceOf(user1.address);
        let maxWithdrawAmount = user1ShareBalance.mul(nextRate).div(RAY);

        await expect(
          user1.sUSX.withdraw(maxWithdrawAmount.add(1), user1.address, user1.address)
        ).to.be.revertedWith("ERC4626: withdraw more than max");

        // Revert when withdraw from others.
        nextRate = await user1.sUSX.getRateByTime((await getCurrentTime())+1);
        let aliceShareBalance = await alice.sUSX.balanceOf(alice.address);
        let maxWithdrawAmountFromAlice = aliceShareBalance.mul(nextRate).div(RAY);
        await expect(
          user1.sUSX.withdraw(maxWithdrawAmountFromAlice.add(1), user1.address, alice.address)
        ).to.be.revertedWith("ERC4626: withdraw more than max");
      });

      it("Withdraw revert when recipient is invalid", async function() {
        // Deposit some at first
        let depositAmount = ethers.utils.parseEther("1");
        await user1.sUSX.deposit(depositAmount, user1.address);

        // Revert due to recipient is zero address
        await expect(
          user1.sUSX.withdraw(1, ethers.constants.AddressZero, user1.address)
        ).to.be.revertedWith("Invalid recipient address!");

        // Revert due to recipient is sUSX contract
        await expect(
          user1.sUSX.withdraw(1, user1.sUSX.address, user1.address)
        ).to.be.revertedWith("Invalid recipient address!");
      });

      it("Withdraw revert when caller doesn't have enough approval amount from spender", async function() {
        // Get free token
        let faucetAmount = ethers.utils.parseEther("1000");
        await alice.usx.mint(alice.address, faucetAmount);
        // Approve to sUSX to deposit
        await alice.usx.approve(user1.sUSX.address, ethers.constants.MaxUint256);
        // Deposit
        await alice.sUSX.deposit(faucetAmount, alice.address);

        // Revert when alice doesn't approve user1 to withdraw
        let withdrawAmountFromAlice = faucetAmount.div(2);
        // Ensure it will not revert by `ERC4626: withdraw more than max`
        expect(await alice.sUSX.maxWithdraw(alice.address)).to.gt(withdrawAmountFromAlice);

        await expect(
          user1.sUSX.withdraw(withdrawAmountFromAlice, user1.address, alice.address)
        ).to.be.revertedWith("ERC20: insufficient allowance");
      });
    });

    describe("Redeem", async function () {
      it("Redeem Normally", async function() {
        // Deposit at first
        let depositAmount = ethers.utils.parseEther("1000");
        await user1.sUSX.deposit(depositAmount, user1.address);
        let redeemAmount = depositAmount.div(4);
        // Redeem twice to check usx and sUSX
        expect(await user1.sUSX.maxRedeem(user1.address)).to.gt(redeemAmount.mul(2));

        // Redeem: check USX
        let nextRate = await user1.sUSX.getRateByTime((await getCurrentTime())+1);
        let assetMintedAmount = redeemAmount.mul(nextRate).div(RAY);
        await expect(
          user1.sUSX.redeem(redeemAmount, user1.address, user1.address)
        ).to.changeTokenBalance(user1.usx, user1.address, assetMintedAmount);

        // Redeem: check sUSX
        await expect(
          user1.sUSX.redeem(redeemAmount, user1.address, user1.address)
        ).to.changeTokenBalance(user1.sUSX, user1.address, redeemAmount.mul(-1));
      });

      it("Redeem by 1 wei share, get 1 asset at least", async function() {
        // Deposit some at first
        let depositAmount = ethers.utils.parseEther("1");
        await user1.sUSX.deposit(depositAmount, user1.address);

        // Check USX
        await expect(
          user1.sUSX.redeem(1, user1.address, user1.address)
        ).to.changeTokenBalance(user1.usx, user1.address, 1);

        // Check sUSX
        await expect(
          user1.sUSX.redeem(1, user1.address, user1.address)
        ).to.changeTokenBalance(user1.sUSX, user1.address, -1);
      });

      it("Redeem revert when contract is paused", async function() {
        // Deposit some at first
        await user1.sUSX.deposit(100, user1.address);

        await owner.sUSX.pause();
        expect(await owner.sUSX.paused()).to.be.true;

        await expect(
          user1.sUSX.redeem(1, user1.address, user1.address)
        ).to.be.revertedWith("Pausable: paused");

        // Reset pause
        await owner.sUSX.unpause();
        expect(await owner.sUSX.paused()).to.be.false;
      });

      it("Redeem revert when redeem more than max", async function() {
        let maxRedeemAmount = await user1.sUSX.maxRedeem(user1.address);

        await expect(
          user1.sUSX.redeem(maxRedeemAmount.add(1), user1.address, user1.address)
        ).to.be.revertedWith("ERC4626: redeem more than max");
      });

      it("Redeem revert when recipient is invalid", async function() {
        // Deposit some at first
        let depositAmount = ethers.utils.parseEther("1");
        await user1.sUSX.deposit(depositAmount, user1.address);

        // Revert due to recipient is zero address
        await expect(
          user1.sUSX.redeem(1, ethers.constants.AddressZero, user1.address)
        ).to.be.revertedWith("Invalid recipient address!");

        // Revert due to recipient is sUSX contract
        await expect(
          user1.sUSX.redeem(1, user1.sUSX.address, user1.address)
        ).to.be.revertedWith("Invalid recipient address!");
      });

      it("Redeem revert when caller doesn't have enough approval amount from spender", async function() {
        // Get free token
        let faucetAmount = ethers.utils.parseEther("1000");
        await alice.usx.mint(alice.address, faucetAmount);
        // Approve to sUSX to deposit
        await alice.usx.approve(user1.sUSX.address, ethers.constants.MaxUint256);
        // Deposit
        await alice.sUSX.deposit(faucetAmount, alice.address);

        // Revert when alice doesn't approve user1 to redeem
        let redeemAmountFromAlice = faucetAmount.div(2);
        // Ensure it will not revert by `ERC4626: redeem more than max`
        expect(await alice.sUSX.maxRedeem(alice.address)).to.gt(redeemAmountFromAlice);

        await expect(
          user1.sUSX.withdraw(redeemAmountFromAlice, user1.address, alice.address)
        ).to.be.revertedWith("ERC20: insufficient allowance");
      });
    });
});
