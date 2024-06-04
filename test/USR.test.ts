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

describe('USX Rating', function () {
    let allUsers: any;
    let owner: any;
    let user1: any;
    let alice: any;
    let bob: any;
    let RAY = ethers.BigNumber.from("1000000000000000000000000000"); // 1e27

    before(async function () {
      const {deployer, sUSX, users, usx} = await setup();
      allUsers = users;
      owner = deployer;
      user1 = users[1];
      alice = users[10];
      bob = users[11];

      // All user accounts approve to sUSX to deposit
      for (let i = 0; i < users.length; i++) {
        await users[i].usx.approve(users[i].sUSX.address, ethers.constants.MaxUint256);
      }
    });

    describe("Add new USR Config", async function () {
      it("Add new USR Config normally", async function () {
        let usrConfigsLength = await owner.sUSX.usrConfigsLength();
        let lastUSRConfig = await owner.sUSX.usrConfigs(usrConfigsLength.sub(1));
        let newStartTime = lastUSRConfig.endTime.add(600); // 10 minutes later
        let newEndTime = newStartTime.add(3600); // 1 hour later
        let newUsr = lastUSRConfig.usr;

        // Add new USR config
        await owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr);
        let newUSRConfig = await owner.sUSX.usrConfigs(usrConfigsLength);
        expect(newUSRConfig.startTime).to.eq(newStartTime);
        expect(newUSRConfig.endTime).to.eq(newEndTime);
        expect(newUSRConfig.usr).to.eq(newUsr);
        expect(await owner.sUSX.usrConfigsLength()).to.eq(usrConfigsLength.add(1));
      });

      it("Add new USR Config revert when caller has no permission", async function () {
        let usrConfigsLength = await owner.sUSX.usrConfigsLength();
        let lastUSRConfig = await owner.sUSX.usrConfigs(usrConfigsLength.sub(1));
        let newStartTime = lastUSRConfig.endTime.add(300); // 5 minutes later
        let newEndTime = newStartTime.add(3600); // 1 hour later
        let newUsr = lastUSRConfig.usr;

        // Add new USR config
        await expect(alice.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr)).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Add new USR Config revert when `newStartTime` is not later than current time", async function () {
        let newStartTime = await getCurrentTime() - 1; // 1s ago
        let newEndTime = newStartTime + 3600; // 1 hour later
        let newUsr = 1000;

        // Add new USR config
        await expect(owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr)).to.be.revertedWith("New usr start time should be later!");
      });

      it("Add new USR Config revert when `newStartTime` is not later than last epoch end time", async function () {
        let usrConfigsLength = await owner.sUSX.usrConfigsLength();
        let lastUSRConfig = await owner.sUSX.usrConfigs(usrConfigsLength.sub(1));
        let newStartTime = lastUSRConfig.endTime.sub(300); // 5 minutes before
        let newEndTime = newStartTime.add(3600); // 1 hour later
        let newUsr = 1000;

        // Add new USR config
        await expect(owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr)).to.be.revertedWith("New usr start time should be greater than last end time!");
      });

      it("Add new USR Config revert when `newEndTime` is not later than `newStartTime`", async function () {
        let usrConfigsLength = await owner.sUSX.usrConfigsLength();
        let lastUSRConfig = await owner.sUSX.usrConfigs(usrConfigsLength.sub(1));
        let newStartTime = lastUSRConfig.endTime.add(300); // 5 minutes later
        let newEndTime = newStartTime.sub(300); // 5 minutes ago
        let newUsr = lastUSRConfig.usr;

        // Add new USR config
        await expect(owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr)).to.be.revertedWith("Invalid new usr end time!");
      });

      it("Add new USR Config revert when `_newUsr` is invalid", async function () {
        let usrConfigsLength = await owner.sUSX.usrConfigsLength();
        let lastUSRConfig = await owner.sUSX.usrConfigs(usrConfigsLength.sub(1));
        let newStartTime = lastUSRConfig.endTime.add(300); // 5 minutes later
        let newEndTime = newStartTime.add(3600); // 1 hour later
        let newUsr;

        // New USR too small
        newUsr = 0;
        await expect(owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr)).to.be.revertedWith("Invalid new usr value!");
        // New USR too big
        newUsr = ethers.BigNumber.from("2").mul(RAY);
        await expect(owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr)).to.be.revertedWith("Invalid new usr value!");
      });

      
    });

    describe("Check Current/Next APY", async function () {
      it("Epoch 0 does not start yet", async function () {
        expect(await owner.sUSX.usrConfigsLength()).to.gte("0");
        let usrConfig = await owner.sUSX.usrConfigs(0);
        // Epoch 0 does not start yet
        expect(usrConfig.startTime).to.gt(await getCurrentTime());

        // USR config 0 will work later, so current APY is 0
        expect((await owner.sUSX.currentAPY())._apy).to.eq("0");
        // And next USR will use the USR config 0
        expect((await owner.sUSX.nextAPY())._apy).to.gt("0");
        expect((await owner.sUSX.nextAPY())._startTime).to.eq(usrConfig.startTime);
        expect((await owner.sUSX.nextAPY())._endTime).to.eq(usrConfig.endTime);
      });

      it("Epoch 0 starts", async function () {
        // Increase time to enter epoch 0
        let usrConfig = await owner.sUSX.usrConfigs(0);
        await increaseTime((usrConfig.startTime.sub(await getCurrentTime()).add(1)).toNumber());
        await increaseBlock(1);
        expect(await getCurrentTime()).to.gt(usrConfig.startTime);
        expect(await getCurrentTime()).to.lt(usrConfig.endTime);

        // Epoch 0 starts
        let currentAPYDetails = await owner.sUSX.currentAPY();
        expect(currentAPYDetails._apy).to.gt(0);
        expect(currentAPYDetails._startTime).to.eq(usrConfig.startTime);
        expect(currentAPYDetails._endTime).to.eq(usrConfig.endTime);

        // Has epoch 1
        expect(await owner.sUSX.usrConfigsLength()).to.gte("1");
        let nextUsrConfig = await owner.sUSX.usrConfigs(1);
        // Epoch 1 does not start yet
        expect(nextUsrConfig.startTime).to.gt(usrConfig.endTime);
        let nextAPYDetails = await owner.sUSX.nextAPY();
        expect(nextAPYDetails._apy).to.gt("0");
        expect(nextAPYDetails._startTime).to.eq(nextUsrConfig.startTime);
        expect(nextAPYDetails._endTime).to.eq(nextUsrConfig.endTime);
      });

      it("Epoch 0 ends, and epoch 1 does not start yet", async function () {
        // Increase time to end epoch 0
        let usrConfig = await owner.sUSX.usrConfigs(0);
        await increaseTime((usrConfig.endTime.sub(await getCurrentTime()).add(1)).toNumber());
        await increaseBlock(1);
        expect(usrConfig.endTime).to.lt(await getCurrentTime());

        // Epoch 1 does not start yet
        expect(await getCurrentTime()).to.lt((await owner.sUSX.usrConfigs(1)).startTime);
        // Current APY should be 0
        let currentAPYDetails = await owner.sUSX.currentAPY();
        expect(currentAPYDetails._apy).to.eq("0");
        expect(currentAPYDetails._startTime).to.eq(0);
        expect(currentAPYDetails._endTime).to.eq(0);

        // Epoch 1 does not start yet, use USR config 1 for next APY
        let nextUsrConfig = await owner.sUSX.usrConfigs(1);
        let nextAPYDetails = await owner.sUSX.nextAPY();
        expect(nextAPYDetails._apy).to.gt("0");
        expect(nextAPYDetails._startTime).to.eq(nextUsrConfig.startTime);
        expect(nextAPYDetails._endTime).to.eq(nextUsrConfig.endTime);
      });

      it("Epoch 1 starts, and no epoch 2", async function () {
        // Do not have epoch 2 yet
        expect(await owner.sUSX.usrConfigsLength()).to.eq(2);

        let usrConfig = await owner.sUSX.usrConfigs(1);
        // Increase time to enter epoch 1
        await increaseTime((usrConfig.startTime.sub(await getCurrentTime()).add(1)).toNumber());
        await increaseBlock(1);
        expect(await getCurrentTime()).to.gt(usrConfig.startTime);
        expect(await getCurrentTime()).to.lt(usrConfig.endTime);

        // Epoch 1 starts
        let currentAPYDetails = await owner.sUSX.currentAPY();
        console.log("currentAPYDetails", currentAPYDetails.toString());
        expect(currentAPYDetails._apy).to.gt(0);
        expect(currentAPYDetails._startTime).to.eq(usrConfig.startTime);
        expect(currentAPYDetails._endTime).to.eq(usrConfig.endTime);

        // No epoch 2 yet
        let nextAPYDetails = await owner.sUSX.nextAPY();
        expect(nextAPYDetails._apy).to.eq("0");
        expect(nextAPYDetails._startTime).to.eq(0);
        expect(nextAPYDetails._endTime).to.eq(0);
      });

      it("Epoch 1 ends, and no epoch 2", async function () {
        // Do not have epoch 2 yet
        expect(await owner.sUSX.usrConfigsLength()).to.eq(2);

        let usrConfig = await owner.sUSX.usrConfigs(1);
        // Increase time to end epoch 1
        await increaseTime((usrConfig.endTime.sub(await getCurrentTime()).add(1)).toNumber());
        await increaseBlock(1);
        expect(usrConfig.endTime).to.lt(await getCurrentTime());

        // No epoch 2 yet
        let currentAPYDetails = await owner.sUSX.currentAPY();
        expect(currentAPYDetails._apy).to.eq(0);
        expect(currentAPYDetails._startTime).to.eq(0);
        expect(currentAPYDetails._endTime).to.eq(0);

        let nextAPYDetails = await owner.sUSX.nextAPY();
        expect(nextAPYDetails._apy).to.eq("0");
        expect(nextAPYDetails._startTime).to.eq(0);
        expect(nextAPYDetails._endTime).to.eq(0);
      });
    });
});
