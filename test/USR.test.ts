import {expect} from 'chai';
import {ethers, deployments, network, getUnnamedAccounts, getNamedAccounts} from 'hardhat';
import {MockERC20, MockMSDController, SUSX} from '../typechain-types';
import {setupUser, setupUsers} from './utils';
import {increaseBlock, increaseTime, miningAutomatically, getCurrentTime} from './utils/helpers';
import { BigNumber } from 'ethers';

function _rpow(x: BigNumber, n: BigNumber, base: BigNumber): BigNumber {
    if (x.isZero()) {
        return n.isZero() ? base : BigNumber.from(0);
    }

    let z = n.mod(2).isZero() ? base : x;
    const half = base.div(2);

    while (n.gt(1)) {
        n = n.div(2);
        let xx = x.mul(x);
        if (!xx.div(x).eq(x)) throw new Error("overflow");

        let xxRound = xx.add(half);
        if (xxRound.lt(xx)) throw new Error("overflow");

        x = xxRound.div(base);

        if (!n.mod(2).isZero()) {
            let zx = z.mul(x);
            if (!zx.div(x).eq(z)) throw new Error("overflow");

            let zxRound = zx.add(half);
            if (zxRound.lt(zx)) throw new Error("overflow");

            z = zxRound.div(base);
        }
    }

    return z;
}

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

describe('USX Saving Rating', function () {
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

      // Distribute usx and approve to sUSX to deposit
    for (let i = 0; i < users.length; i++) {
      await users[i].usx.mint(users[i].address, ethers.utils.parseEther("1000000"));
      await users[i].usx.approve(users[i].sUSX.address, ethers.constants.MaxUint256);
    }
    });

    // Do actions in a epoch, including deposit, withdraw, mint, redeem, transfer, transferFrom
    async function actInEpoch(usrConfig: any) {
      // Enter epoch 0
      if (usrConfig.startTime > await getCurrentTime()) {
        await increaseTime((usrConfig.startTime.sub(await getCurrentTime())).toNumber());
        await increaseBlock(1);
      }
        
      expect(await getCurrentTime()).to.gte(usrConfig.startTime);
      // User do some actions: deposit, mint
      let depositAmount = ethers.utils.parseEther("1000");
      await user1.sUSX.deposit(depositAmount, user1.address);
      await user1.sUSX.mint(depositAmount, user1.address);
      // Increase some time
      await increaseTime(300); // 5 minutes later
      await increaseBlock(1);
      expect(await getCurrentTime()).to.lt(usrConfig.endTime);
      // User do some actions: withdraw, redeem
      let withdrawAmount = ethers.utils.parseEther("200");
      await user1.sUSX.withdraw(withdrawAmount, user1.address, user1.address);
      await user1.sUSX.redeem(withdrawAmount, user1.address, user1.address);
      // Increase some time
      await increaseTime(300); // 5 minutes later
      await increaseBlock(1);
      expect(await getCurrentTime()).to.lt(usrConfig.endTime);
      // User do some actions: transfer, transferFrom
      let transferAmount = ethers.utils.parseEther("100");
      await user1.sUSX.transfer(alice.address, transferAmount);
      await user1.sUSX.approve(bob.address, transferAmount);
      await bob.sUSX.transferFrom(user1.address, bob.address, transferAmount);
      // Increase some time
      await increaseTime(300); // 5 minutes later
      await increaseBlock(1);
      expect(await getCurrentTime()).to.lt(usrConfig.endTime);
    }

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

        // // When does not have epoch 1, next APY will be 0
        // expect(await owner.sUSX.usrConfigsLength()).to.eq(1);
        // expect((await owner.sUSX.nextAPY())._apy).to.eq("0");

        // // Has epoch 1
        // expect(await owner.sUSX.usrConfigsLength()).to.gte("1");
        // let nextUsrConfig = await owner.sUSX.usrConfigs(1);
        // // Epoch 1 does not start yet
        // expect(nextUsrConfig.startTime).to.gt(usrConfig.endTime);
        // let nextAPYDetails = await owner.sUSX.nextAPY();
        // expect(nextAPYDetails._apy).to.gt("0");
        // expect(nextAPYDetails._startTime).to.eq(nextUsrConfig.startTime);
        // expect(nextAPYDetails._endTime).to.eq(nextUsrConfig.endTime);
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

    describe.only("Check Rate", async function () {
      it("Check the start rate of a new epoch", async function () {
        // 1. Usr in the epoch 0 uses the positive interest rate, then check start rate in the epoch 1
        // Get current usr config length
        let usrConfigsLength = await owner.sUSX.usrConfigsLength();
        // Get last usr config
        let lastUSRConfig = await owner.sUSX.usrConfigs(usrConfigsLength.sub(1));
        // Set new usr config with the positive interest rate
        let newStartTime = lastUSRConfig.endTime.add(600); // 10 minutes later
        let newEndTime = newStartTime.add(3600); // 1 hour later
        let newUsr = ethers.BigNumber.from("1000000003022265980097387650"); // Math.pow(1.1, 1/(365*24*3600)) * 10 ** 27;
        // Add new USR config: mark this new epoch as epoch 0
        await owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr);
        expect(await owner.sUSX.usrConfigsLength()).to.eq(usrConfigsLength.add(1));
        let epoch0USRConfig = await owner.sUSX.usrConfigs(usrConfigsLength);
        // epoch0USRConfig.usr > RAY due to the positive interest rate
        expect(epoch0USRConfig.usr).to.gt(RAY);

        // Set a new epoch to check its start rate: mark this new epoch as epoch 1
        newStartTime = newEndTime.add(3600); // 1 hour later
        newEndTime = newStartTime.add(3600); // 1 hour later
        newUsr = ethers.BigNumber.from("999999996977734019902612350"); // Math.pow(0.9, 1/(365*24*3600)) * 10 ** 27;
        // Add new USR config
        usrConfigsLength = await owner.sUSX.usrConfigsLength();
        await owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr);
        expect(await owner.sUSX.usrConfigsLength()).to.eq(usrConfigsLength.add(1));

        // Get epoch 1 usr config
        let epoch1USRConfig = await owner.sUSX.usrConfigs(usrConfigsLength);
        // The start rate should be equal to the rate at the start time at every epoch
        expect(await owner.sUSX.getRateByTime(epoch1USRConfig.startTime)).to.eq(epoch1USRConfig.startRate);
        expect(await owner.sUSX.getRateByTime(epoch0USRConfig.endTime)).to.eq(epoch1USRConfig.startRate);

        // The start rate in the latest epoch should be equal to the rate at the end of the previous epoch
        // Calculate start rate at the epoch 1 by _rpow
        let expectedEpoch1StartRate = _rpow(epoch0USRConfig.usr, epoch0USRConfig.endTime.sub(epoch0USRConfig.startTime), RAY).mul(epoch0USRConfig.startRate).div(RAY);
        expect(epoch1USRConfig.startRate).to.eq(expectedEpoch1StartRate);

        // 2. Usr in the epoch 1 uses the negative interest rate, then check start rate in the epoch 2
        // epoch1USRConfig.usr > RAY due to the negative interest rate
        expect(epoch1USRConfig.usr).to.lt(RAY);

        // Set a new epoch to check its start rate: mark this new epoch as epoch 2
        newStartTime = epoch1USRConfig.endTime.add(3600); // 1 hour later
        newEndTime = newStartTime.add(3600); // 1 hour later
        newUsr = ethers.BigNumber.from("1000000003022265980097387650"); // Math.pow(1.1, 1/(365*24*3600)) * 10 ** 27;
        // Add new USR config
        usrConfigsLength = await owner.sUSX.usrConfigsLength();
        await owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr);
        expect(await owner.sUSX.usrConfigsLength()).to.eq(usrConfigsLength.add(1)); 

        // Get epoch 2 usr config
        let epoch2USRConfig = await owner.sUSX.usrConfigs(usrConfigsLength);
        // The start rate should be equal to the rate at the start time at every epoch
        expect(await owner.sUSX.getRateByTime(epoch2USRConfig.startTime)).to.eq(epoch2USRConfig.startRate);
        expect(await owner.sUSX.getRateByTime(epoch1USRConfig.endTime)).to.eq(epoch2USRConfig.startRate);
        
        // Calculate start rate at the epoch 2 by _rpow
        // The start rate in the latest epoch should be equal to the rate at the end of the previous epoch
        let expectedEpoch2StartRate = _rpow(epoch1USRConfig.usr, epoch1USRConfig.endTime.sub(epoch1USRConfig.startTime), RAY).mul(epoch1USRConfig.startRate).div(RAY);
        expect(epoch2USRConfig.startRate).to.eq(expectedEpoch2StartRate);
      });

      it("User actions in a epoch do not effect the start rate in the next epoch", async function () {
        // Get current usr config length
        let usrConfigsLength = await owner.sUSX.usrConfigsLength();
        // Get last usr config
        let lastUSRConfig = await owner.sUSX.usrConfigs(usrConfigsLength.sub(1));
        // Set new usr config with the positive interest rate
        let newStartTime = lastUSRConfig.endTime.add(600); // 10 minutes later
        let newEndTime = newStartTime.add(3600); // 1 hour later
        let newUsr = ethers.BigNumber.from("1000000003022265980097387650"); // Math.pow(1.1, 1/(365*24*3600)) * 10 ** 27;
        // Add new USR config: mark this new epoch as epoch 0
        await owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr);
        expect(await owner.sUSX.usrConfigsLength()).to.eq(usrConfigsLength.add(1));
        let epoch0USRConfig = await owner.sUSX.usrConfigs(usrConfigsLength);
        // epoch0USRConfig.usr > RAY due to the positive interest rate
        expect(epoch0USRConfig.usr).to.gt(RAY);
        
        // 1. Usr in the epoch 0 uses the positive interest rate, then check start rate in the epoch 1
        let expectedEpoch1StartRate = _rpow(epoch0USRConfig.usr, epoch0USRConfig.endTime.sub(epoch0USRConfig.startTime), RAY).mul(epoch0USRConfig.startRate).div(RAY);
        // Enter epoch 0 to do some actions: deposit, withdraw, mint, redeem, transfer, transferFrom
        await actInEpoch(epoch0USRConfig);

        // Set a new epoch to check its start rate: mark this new epoch as epoch 1
        newStartTime = newEndTime.add(3600); // 1 hour later
        newEndTime = newStartTime.add(3600); // 1 hour later
        newUsr = ethers.BigNumber.from("999999996977734019902612350"); // Math.pow(0.9, 1/(365*24*3600)) * 10 ** 27;
        // Add new USR config
        usrConfigsLength = await owner.sUSX.usrConfigsLength();
        await owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr);
        expect(await owner.sUSX.usrConfigsLength()).to.eq(usrConfigsLength.add(1));
        // Get epoch 1 usr config
        let epoch1USRConfig = await owner.sUSX.usrConfigs(usrConfigsLength);
        // epoch1SRConfig.usr < RAY due to the negative interest rate
        expect(epoch1USRConfig.usr).to.lt(RAY);
        // User actions in epoch 0 do not effect the start rate in epoch 1
        expect(expectedEpoch1StartRate).to.eq(epoch1USRConfig.startRate);

        // 2. Usr in the epoch 1 uses the negative interest rate, then check start rate in the epoch 2
        let expectedEpoch2StartRate = _rpow(epoch1USRConfig.usr, epoch1USRConfig.endTime.sub(epoch1USRConfig.startTime), RAY).mul(epoch1USRConfig.startRate).div(RAY);
        // Enter epoch 1 to do some actions: deposit, withdraw, mint, redeem, transfer, transferFrom
        await actInEpoch(epoch1USRConfig);

        // Set a new epoch to check its start rate: mark this new epoch as epoch 1
        newStartTime = newEndTime.add(3600); // 1 hour later
        newEndTime = newStartTime.add(3600); // 1 hour later
        newUsr = ethers.BigNumber.from("1000000003022265980097387650"); // Math.pow(1.1, 1/(365*24*3600)) * 10 ** 27;
        // Add new USR config
        usrConfigsLength = await owner.sUSX.usrConfigsLength();
        await owner.sUSX._addNewUsrConfig(newStartTime, newEndTime, newUsr);
        expect(await owner.sUSX.usrConfigsLength()).to.eq(usrConfigsLength.add(1));
        // Get epoch 2 usr config
        let epoch2USRConfig = await owner.sUSX.usrConfigs(usrConfigsLength);
        // User actions in epoch 1 do not effect the start rate in epoch 2
        expect(expectedEpoch2StartRate).to.eq(epoch2USRConfig.startRate);
      });
    });
});
