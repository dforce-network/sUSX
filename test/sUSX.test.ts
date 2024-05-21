import {expect} from 'chai';
import {ethers, deployments, network, getUnnamedAccounts, getNamedAccounts} from 'hardhat';
import {MockERC20, SUSX} from '../typechain-types';
import {setupUser, setupUsers} from './utils';
import {miningAutomatically, getCurrentTime} from './utils/helpers';

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
    let admin;
    let user1:any;

    before(async function () {
      const {deployer, sUSX, users, usx} = await setup();
      admin = deployer;
      user1 = users[1];

      expect(await admin.sUSX.usrConfigsLength()).to.eq("1");
    });

    describe("Public functions", async function () {
      it("Deposit", async function() {
          // Get free token
          let faucetAmount = ethers.utils.parseEther("10000");
          await user1.usx.mint(user1.address, faucetAmount);
          expect(await user1.usx.balanceOf(user1.address)).to.eq(faucetAmount);
          // Approve to sUSX to deposit
          await user1.usx.approve(user1.sUSX.address, ethers.constants.MaxUint256);
          // Deposit
          let depositAmount = ethers.utils.parseEther("100");
          await expect(() => 
              user1.sUSX.deposit(depositAmount, user1.address)
          ).to.changeTokenBalance(user1.usx, user1.address, depositAmount.mul(-1));
      });
    });
});
