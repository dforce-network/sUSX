import {expect} from 'chai';
import {ethers, deployments, network, getUnnamedAccounts, getNamedAccounts} from 'hardhat';
import {MockERC20, MockMSDController, SUSX} from '../typechain-types';
import {setupUser, setupUsers} from './utils';
import {increaseBlock, increaseTime, miningAutomatically, getCurrentTime} from './utils/helpers';

const setup = deployments.createFixture(async () => {
	await deployments.fixture('sUSX');
	const {deployer} = await getNamedAccounts();
	const contracts = {
    msdController: await ethers.getContract<MockMSDController>('msdController'),
		sUSX: await ethers.getContract<SUSX>('sUSX'),
		usx: await ethers.getContract<MockERC20>('USX'),
	};

	const users = await setupUsers(await getUnnamedAccounts(), contracts);
	return {
		...contracts,
		users,
		deployer: await setupUser(deployer, contracts),
	};
});

describe('USX Saving', function () {
    let allUsers: any;
    let owner: any;
    let user1: any;
    let alice: any;
    let bob: any;
    let RAY = ethers.BigNumber.from("1000000000000000000000000000"); // 1e27

    // All users redeem all their shares to clear the sUSX contract
    async function clearSUSX() {
      for (let i = 0; i < allUsers.length; i++) {
        let shareBalance = await allUsers[i].sUSX.balanceOf(allUsers[i].address);
        if (shareBalance.gt(0)) {
          await allUsers[i].sUSX.redeem(shareBalance, allUsers[i].address, allUsers[i].address);
        }
      }
    }

    // Deposit/Mint/Withdraw/Redeem/Transfer/TransferFrom will revert when contract is paused.
    async function sUSXShutdownWhenPause() {
      await expect(
        user1.sUSX.deposit(1, user1.address)
      ).to.be.revertedWith("Pausable: paused");
      await expect(
        user1.sUSX.mint(1, user1.address)
      ).to.be.revertedWith("Pausable: paused");
      await expect(
        user1.sUSX.withdraw(1, user1.address, user1.address)
      ).to.be.revertedWith("Pausable: paused");
      await expect(
        user1.sUSX.redeem(1, user1.address, user1.address)
      ).to.be.revertedWith("Pausable: paused");
      await expect(
        user1.sUSX.transfer(alice.address, 1)
      ).to.be.revertedWith("Pausable: paused");
      // User1 approve to alice to transferFrom
      await user1.sUSX.approve(alice.address, ethers.constants.MaxUint256);
      await expect(
        alice.sUSX.transferFrom(user1.address, alice.address, 1)
      ).to.be.revertedWith("Pausable: paused");
    }

    // Deposit/Mint/Withdraw/Redeem/Transfer/TransferFrom can work well when contract is not paused.
    async function sUSXWorkOnWhenUnpause() {
      // Get free token
      await user1.usx.mint(user1.address, ethers.utils.parseEther("100"));
      // Approve to sUSX to deposit
      await user1.usx.approve(user1.sUSX.address, ethers.constants.MaxUint256);

      await user1.sUSX.deposit(ethers.utils.parseEther("50"), user1.address);
      let baseUint = ethers.utils.parseEther("1");
      await user1.sUSX.mint(baseUint, user1.address);
      await user1.sUSX.withdraw(baseUint, user1.address, user1.address);
      await user1.sUSX.redeem(baseUint, user1.address, user1.address);
      await user1.sUSX.transfer(alice.address, baseUint);
      // User1 approve to alice to transferFrom
      await user1.sUSX.approve(alice.address, ethers.constants.MaxUint256);
      await alice.sUSX.transferFrom(user1.address, alice.address, baseUint);
    }

    before(async function () {
      const {deployer, sUSX, users, usx} = await setup();
      allUsers = users;
      owner = deployer;
      user1 = users[1];
      alice = users[10];
      bob = users[11];

      expect(await owner.sUSX.usrConfigsLength()).to.eq("1");
      // All user accounts approve to sUSX to deposit
      for (let i = 0; i < users.length; i++) {
        await users[i].usx.approve(users[i].sUSX.address, ethers.constants.MaxUint256);
      }
    });


    describe("Initialization", async function () {
      it("Initialize sUSX contract correctly", async function () {
        expect(await owner.sUSX.totalSupply()).to.eq(0);
        expect(await owner.sUSX.totalStaked()).to.eq(0);
        expect(await owner.sUSX.totalUnstaked()).to.eq(0);
        expect(await owner.sUSX.paused()).to.be.false;
      });

      it("Revert when initialize twice", async function () {
        let initArgs = [
            "USX Savings", // name
            "sUSX", // symbol
            owner.usx.address, // usx
            owner.msdController.address, // msdController
            ethers.utils.parseEther("1000000"), // mintCap
            0, // initialUsrStartTime
            0, // initialUsrEndTime
            0, // initialUsr
            0, // initialRate
        ];
        await expect(
          owner.sUSX.initialize(...initArgs)
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });
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

      it("Withdraw revert when reaching mint cap of the USX", async function() {
        let originalUSXMintCap = await owner.msdController.mintCaps(owner.usx.address, owner.sUSX.address);

        // Set USX mint cap to 0, that means no USX interests can be minted.
        await owner.msdController._addMSD(owner.usx.address, [owner.sUSX.address], [0]);
        expect(await owner.msdController.mintCaps(owner.usx.address, owner.sUSX.address)).to.eq(0);

        let totalTotalStaked = await owner.sUSX.totalStaked();
        let currentWithdrawAmount = await owner.sUSX.totalUnstaked();

        // Accumulated rate is greater than 0 means it can generate some interests when sUSX total supply > 0.
        // but usx interests mint cap is 0, so it will revert when redeem all shares.
        expect(await owner.sUSX.currentRate()).to.gt(0);
        expect(await owner.sUSX.totalSupply()).to.gt(0);

        // Increase time to generate interests.
        await increaseTime(1000);
        await increaseBlock(1);

        // Try to redeem all shares with interests.
        for (let i = 0; i < allUsers.length; i++) {
          let nextRate = await allUsers[i].sUSX.getRateByTime((await getCurrentTime())+1);
          let shareBalance = await allUsers[i].sUSX.balanceOf(allUsers[i].address);
          let userTotalFunds = shareBalance.mul(nextRate).div(RAY);
          if (shareBalance.gt(0)) {
            currentWithdrawAmount = currentWithdrawAmount.add(userTotalFunds);
            if (currentWithdrawAmount > totalTotalStaked) {
                await expect(
                  allUsers[i].sUSX.withdraw(userTotalFunds, allUsers[i].address, allUsers[i].address)
                ).to.be.revertedWith("Minter mint capacity reached");
            } else {
              await allUsers[i].sUSX.withdraw(userTotalFunds, allUsers[i].address, allUsers[i].address);
            }
          }
        }
        // Reset USX mint cap
        await owner.msdController._addMSD(owner.usx.address, [owner.sUSX.address], [originalUSXMintCap]);
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

      it("Redeem revert when reaching mint cap of the USX", async function() {
        let originalUSXMintCap = await owner.msdController.mintCaps(owner.usx.address, owner.sUSX.address);

        // Set USX mint cap to 0, that means no USX interests can be minted.
        await owner.msdController._addMSD(owner.usx.address, [owner.sUSX.address], [0]);
        expect(await owner.msdController.mintCaps(owner.usx.address, owner.sUSX.address)).to.eq(0);

        let totalTotalStaked = await owner.sUSX.totalStaked();
        let currentWithdrawAmount = await owner.sUSX.totalUnstaked();

        // Accumulated rate is greater than 0 means it can generate some interests when sUSX total supply > 0.
        // but usx interests mint cap is 0, so it will revert when redeem all shares.
        expect(await owner.sUSX.currentRate()).to.gt(0);
        expect(await owner.sUSX.totalSupply()).to.gt(0);

        // Increase time to generate interests.
        await increaseTime(1000);
        await increaseBlock(1);

        // Try to redeem all shares with interests.
        for (let i = 0; i < allUsers.length; i++) {
          let shareBalance = await allUsers[i].sUSX.balanceOf(allUsers[i].address);
          if (shareBalance.gt(0)) {
            currentWithdrawAmount = currentWithdrawAmount.add(await allUsers[i].sUSX.previewRedeem(shareBalance));
            if (currentWithdrawAmount > totalTotalStaked) {
                await expect(
                  allUsers[i].sUSX.redeem(shareBalance, allUsers[i].address, allUsers[i].address)
                ).to.be.revertedWith("Minter mint capacity reached");
            } else {
              await allUsers[i].sUSX.redeem(shareBalance, allUsers[i].address, allUsers[i].address);
            }
          }
        }

        // Reset USX mint cap
        await owner.msdController._addMSD(owner.usx.address, [owner.sUSX.address], [originalUSXMintCap]);
      });
    });

    describe("sUSX Transfer/TransferFrom", async function () {
      it("Transfer Normally", async function() {
        // Deposit at first
        let depositAmount = ethers.utils.parseEther("10");
        await user1.sUSX.deposit(depositAmount, user1.address);
        let transferAmount = depositAmount.div(5);

        // Transfer: check sUSX
        await expect(
          user1.sUSX.transfer(alice.address, transferAmount)
        ).to.changeTokenBalances(user1.sUSX, [user1.address, alice.address], [transferAmount.mul(-1), transferAmount]);
      });

      it("Transfer revert when contract is paused", async function() {
        await owner.sUSX.pause();
        expect(await owner.sUSX.paused()).to.be.true;

        await expect(
          user1.sUSX.transfer(alice.address, 1)
        ).to.be.revertedWith("Pausable: paused");

        // Reset pause
        await owner.sUSX.unpause();
        expect(await owner.sUSX.paused()).to.be.false;
      });

      it("TransferFrom Normally", async function() {
        // Deposit at first
        let depositAmount = ethers.utils.parseEther("10");
        await user1.sUSX.deposit(depositAmount, user1.address);
        let transferAmount = depositAmount.div(5);
        // Approve to alice to transferFrom
        await user1.sUSX.approve(alice.address, transferAmount);

        // TransferFrom: check sUSX
        await expect(
          alice.sUSX.transferFrom(user1.address, alice.address, transferAmount)
        ).to.changeTokenBalances(user1.sUSX, [user1.address, alice.address], [transferAmount.mul(-1), transferAmount]);
      });

      it("TransferFrom revert when contract is paused", async function() {
        await owner.sUSX.pause();
        expect(await owner.sUSX.paused()).to.be.true;

        // User1 approve to alice to transferFrom
        await user1.sUSX.approve(alice.address, ethers.constants.MaxUint256);
        await expect(
          alice.sUSX.transferFrom(user1.address, alice.address, 1)
        ).to.be.revertedWith("Pausable: paused");

        // Reset pause
        await owner.sUSX.unpause();
        expect(await owner.sUSX.paused()).to.be.false;
      });
    });

    describe("Bridge", async function () {
      it("Bridge out normally", async function() {
        // In the test case, only the owner address has the bridge role
        expect(await owner.sUSX.hasRole(await owner.sUSX.BRIDGER_ROLE(), owner.address)).to.be.true;

        // Bridge sUSX out
        // Get free token
        let faucetAmount = ethers.utils.parseEther("1000");
        await owner.usx.mint(owner.address, faucetAmount);
        // Approve to sUSX to deposit
        await owner.usx.approve(owner.sUSX.address, ethers.constants.MaxUint256);
        // Deposit
        await owner.sUSX.deposit(faucetAmount, owner.address);

        // Bridge out
        let bridgeAmount = faucetAmount.div(5);
        await expect(
          owner.sUSX.outboundTransferShares(bridgeAmount, owner.address)
        ).to.changeTokenBalance(owner.sUSX, owner.address, bridgeAmount.mul(-1));
      });

      it("Bridge out revert when caller doesn't have permission", async function() {
        // In the test case, only the owner address has the bridge role
        expect(await user1.sUSX.hasRole(await owner.sUSX.BRIDGER_ROLE(), user1.address)).to.be.false;

        // Bridge out
        let bridgeAmount = ethers.utils.parseEther("100");
        await expect(
          user1.sUSX.outboundTransferShares(bridgeAmount, user1.address)
        ).to.be.reverted;
        // Revert with `AccessControl: account ${user1.address} is missing role ${bridgeRole}`
      });

      it("Bridge out revert when contract is paused", async function() {
        await owner.sUSX.pause();
        expect(await owner.sUSX.paused()).to.be.true;

        await expect(
          owner.sUSX.outboundTransferShares(1, owner.address)
        ).to.be.revertedWith("Pausable: paused");

        // Reset pause
        await owner.sUSX.unpause();
        expect(await owner.sUSX.paused()).to.be.false;
      });

      it("Bridge in normally", async function() {
        // In the test case, the bridge address is the owner address
        expect(await owner.sUSX.hasRole(await owner.sUSX.BRIDGER_ROLE(), owner.address)).to.be.true;

        // Bridge in
        let bridgeAmount = ethers.utils.parseEther("100");
        await expect(
          owner.sUSX.finalizeInboundTransferShares(bridgeAmount, owner.address)
        ).to.changeTokenBalance(owner.sUSX, owner.address, bridgeAmount);
      });

      it("Bridge in revert when caller doesn't have permission", async function() {
        let bridgeRole = await owner.sUSX.BRIDGER_ROLE();
        // In the test case, only the owner address has the bridge role
        expect(await user1.sUSX.hasRole(bridgeRole, user1.address)).to.be.false;

        // Bridge in
        await expect(
          user1.sUSX.finalizeInboundTransferShares(1, user1.address)
        ).to.be.reverted;
        // Revert with `AccessControl: account ${user1.address} is missing role ${bridgeRole}`
      });

      it("Bridge in revert when contract is paused", async function() {
        await owner.sUSX.pause();
        expect(await owner.sUSX.paused()).to.be.true;

        await expect(
          owner.sUSX.finalizeInboundTransferShares(1, owner.address)
        ).to.be.revertedWith("Pausable: paused");

        // Reset pause
        await owner.sUSX.unpause();
        expect(await owner.sUSX.paused()).to.be.false;
      });
    });

    describe("Pause/Unpause", async function () {
      it("Pause contract normally", async function () {
        // Contract is not paused at first
        expect(await owner.sUSX.paused()).to.be.false;
        // Pause contract by owner
        await owner.sUSX.pause();
        expect(await owner.sUSX.paused()).to.be.true;
        // Deposit/Mint/Withdraw/Redeem/Transfer/TransferFrom will revert when contract is paused.
        await sUSXShutdownWhenPause();
        // Unpause contract by owner
        await owner.sUSX.unpause();
        expect(await owner.sUSX.paused()).to.be.false;

        // Set another account to pause
        expect(await owner.sUSX.hasRole(await owner.sUSX.PAUSER_ROLE(), alice.address)).to.be.false;
        await owner.sUSX.grantRole(await owner.sUSX.PAUSER_ROLE(), alice.address);
        expect(await owner.sUSX.hasRole(await owner.sUSX.PAUSER_ROLE(), alice.address)).to.be.true;
        // Pause contract by guardian account
        await alice.sUSX.pause();
        expect(await owner.sUSX.paused()).to.be.true;
        // Deposit/Mint/Withdraw/Redeem/Transfer/TransferFrom will revert when contract is paused.
        await sUSXShutdownWhenPause();

        // Reset contract: revoke and unpause
        await owner.sUSX.revokeRole(await owner.sUSX.PAUSER_ROLE(), alice.address);
        expect(await owner.sUSX.hasRole(await owner.sUSX.PAUSER_ROLE(), alice.address)).to.be.false;
        await owner.sUSX.unpause();
        expect(await owner.sUSX.paused()).to.be.false;
      });

      it("Pause contract revert when caller doesn't have permission", async function () {
        // Contract is not paused at first
        expect(await owner.sUSX.paused()).to.be.false;

        // Revert when caller doesn't have permission
        expect(await owner.sUSX.hasRole(await owner.sUSX.PAUSER_ROLE(), user1.address)).to.be.false;
        await expect(
          user1.sUSX.pause()
        ).to.be.reverted;
      });

      it("Unpause contract normally", async function () {
        // If contract is not paused, pause it first
        if (!(await owner.sUSX.paused())) {
          await owner.sUSX.pause();
        }
        expect(await owner.sUSX.paused()).to.be.true;
        // Deposit/Mint/Withdraw/Redeem/Transfer/TransferFrom will revert when contract is paused.
        await sUSXShutdownWhenPause();
        // Unpause contract by owner
        await owner.sUSX.unpause();
        expect(await owner.sUSX.paused()).to.be.false;
        // Deposit/Mint/Withdraw/Redeem/Transfer/TransferFrom can work well when contract is not paused.
        await sUSXWorkOnWhenUnpause();
      });
    });

    describe("Set sUSX mint cap", async function () {
      it("Set sUSX mint cap normally", async function () {
        let originalsUSXMintCap = await owner.sUSX.mintCap();
        let newMintCap = originalsUSXMintCap.mul(2);

        let maxMintAmount = await owner.sUSX.maxMint(user1.address);

        // Distribute enough usx to user1 to reach sUSX mint cap
        let nextRate = await owner.sUSX.getRateByTime((await getCurrentTime())+4);
        let mintAmount = maxMintAmount.mul(nextRate).div(RAY);
        await user1.usx.mint(user1.address, mintAmount);

        // It will revert when reaching the mint cap
        await expect(
          user1.sUSX.mint(maxMintAmount.add(1), user1.address)
        ).to.be.revertedWith("ERC4626: mint more than max");

        // Set new mint cap to increase the mint amount
        await owner.sUSX._setMintCap(newMintCap);
        expect(await owner.sUSX.mintCap()).to.eq(newMintCap);

        // It will pass now when mint cap increasing
        await user1.sUSX.mint(maxMintAmount.add(1), user1.address);

        // Reset mint cap
        await owner.sUSX._setMintCap(originalsUSXMintCap);
      });

      it("Set sUSX mint cap revert when caller doesn't have permission", async function () {
        let newMintCap = ethers.utils.parseEther("1000000");
        expect(await user1.sUSX.mintCap()).to.not.eq(newMintCap);
        await expect(
          user1.sUSX._setMintCap(newMintCap)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Set sUSX mint cap revert when new mint cap is the same as the old one", async function () {
        let originalMintCap = await owner.sUSX.mintCap();
        await expect(
          owner.sUSX._setMintCap(originalMintCap)
        ).to.be.revertedWith("New mint cap is the same as the old one!");
      });
    });

    describe("Total assets", async function () {
      // To increase the coverage of the test case, call the following getter functions.
      it("Get total assets", async function() {
        let sUSXTotalSupply = await owner.sUSX.totalSupply();
        let currentRate = await owner.sUSX.currentRate();
        let totalAssets = sUSXTotalSupply.mul(currentRate).div(RAY);
        expect(await owner.sUSX.totalAssets()).to.eq(totalAssets);
      });
      it("Get decimals of sUSX", async function() {
        expect(await owner.sUSX.decimals()).to.eq(18);
      });
    });

    describe("Launch different bridges", async function () {

    });
});
