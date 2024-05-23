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
    let user1:any;
    let RAY = ethers.BigNumber.from("1000000000000000000000000000"); // 1e27

    before(async function () {
      const {deployer, sUSX, users, usx} = await setup();
      owner = deployer;
      user1 = users[1];

      expect(await owner.sUSX.usrConfigsLength()).to.eq("1");
      // Approve to sUSX to deposit
      await user1.usx.approve(user1.sUSX.address, ethers.constants.MaxUint256);
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
        let beforeAccumulatedRate = await user1.sUSX.currentAccumulatedRate();
        let usrDetails = await user1.sUSX.usrDetails(0);
        let toIncreaseTime = usrDetails.startTime - await getCurrentTime();

        // Increase time to accumulate rate.
        await increaseTime(toIncreaseTime + 1);
        await increaseBlock(1);
        expect(await user1.sUSX.currentAccumulatedRate()).to.gt(beforeAccumulatedRate);

        // Deposit: check sUSX
        let nextRate = await user1.sUSX.getAccumulatedRateByTime((await getCurrentTime())+1);
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

      it("Deposit revert when pause contract", async function() {
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

      it("Deposit revert when exceeding mint cap", async function() {
        // Get free token
        let faucetAmount = await user1.sUSX.maxDeposit(user1.address);
        // Due to rate accumulated and calculation rounding down, 
        // so add 1 more to make sure it's enough.
        await user1.usx.mint(user1.address, faucetAmount.add("1"));

        // When call `deposit()`, the rate will accumulate for 1 second more
        let nextRate = await user1.sUSX.getAccumulatedRateByTime((await getCurrentTime()) + 1);
        let mintCap = await user1.sUSX.mintCap();
        let totalSupply = await user1.sUSX.totalSupply();
        let maxDepositAmount = mintCap.sub(totalSupply).mul(nextRate).div(RAY);
        // It will be rounded down when calculate the share amount,
        // so deposit 1 more to cost the whole mint cap.
        await user1.sUSX.deposit(maxDepositAmount.add("1"), user1.address);

        maxDepositAmount = await user1.sUSX.maxDeposit(user1.address);
        expect(maxDepositAmount).to.eq("0");

        await expect(
          // Rounded down, deposit 1 more.
          user1.sUSX.deposit(2, user1.address)
        ).to.be.revertedWith("Exceeds mint cap!");
      });
    });

    describe("Withdraw", async function () {
      it("Withdraw Normally", async function() {
        let withdrawAmount = ethers.utils.parseEther("1000");
        // Withdraw twice to check usx and sUSX
        expect(await user1.sUSX.balanceOf(user1.address)).to.gt(withdrawAmount.mul(2));

        // Withdraw: check USX
        await expect(
          user1.sUSX.withdraw(withdrawAmount, user1.address, user1.address)
        ).to.changeTokenBalance(user1.usx, user1.address, withdrawAmount);

        // Withdraw: check sUSX
        let nextRate = await user1.sUSX.getAccumulatedRateByTime((await getCurrentTime())+1);
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
    });
});
