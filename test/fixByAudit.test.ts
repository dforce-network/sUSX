import {expect} from "chai";
import {
  ethers,
  deployments,
  getUnnamedAccounts,
  getNamedAccounts,
} from "hardhat";
import {MockERC20, MockMSDController, SUSX} from "../typechain-types";
import {setupUser, setupUsers} from "./utils";
import {
  increaseBlock,
  getCurrentTime,
} from "./utils/helpers";
import {setNextBlockTimestamp} from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time";


const setup = deployments.createFixture(async () => {
  await deployments.fixture("sUSX");
  const {deployer} = await getNamedAccounts();
  const contracts = {
    msdController: await ethers.getContract<MockMSDController>("msdController"),
    sUSX: await ethers.getContract<SUSX>("sUSX"),
    usx: await ethers.getContract<MockERC20>("USX"),
  };

  const users = await setupUsers(await getUnnamedAccounts(), contracts);
  return {
    ...contracts,
    users,
    deployer: await setupUser(deployer, contracts),
  };
});

describe("Fix by audit report", function () {
  let allUsers: any;
  let owner: any;
  let user1: any;
  let RAY = ethers.BigNumber.from("1000000000000000000000000000"); // 1e27

  beforeEach(async function () {
    const {deployer, sUSX, users, usx} = await setup();
    allUsers = users;
    owner = deployer;
    user1 = users[1];

    expect(await owner.sUSX.usrConfigsLength()).to.eq("1");
    // All user accounts get free token and approve to sUSX to deposit
    let faucetAmount = ethers.utils.parseEther("10000");
    
    // Approve to sUSX to deposit
    await owner.usx.approve(owner.sUSX.address, ethers.constants.MaxUint256);
    for (let i = 0; i < users.length; i++) {
      await owner.usx.mint(users[i].address, faucetAmount);
      await users[i].usx.approve(
        users[i].sUSX.address,
        ethers.constants.MaxUint256
      );
    }
  });

  it("H-01: MintCap Check Missing in Cross-Chain Transfer", async function () {
    // In the test case, only the owner address has the bridge role
    expect(
      await owner.sUSX.hasRole(await owner.sUSX.BRIDGER_ROLE(), owner.address)
    ).to.be.true;

    let depositAmount = ethers.utils.parseEther("5000");
    // Deposit
    await owner.sUSX.deposit(depositAmount, owner.address);

    // Get epoch 0 config
    let usrConfig = await owner.sUSX.usrConfigs(0);
    
    // Only 1 epoch at here, pass the whole epoch to earn interest.
    await setNextBlockTimestamp(usrConfig.endTime);
    await increaseBlock(1);

    // Many situations can meet the case requirement, 
    // at here, make a case that decrease the MSD mint cap.
    let originalUSXMintCap = await owner.msdController.mintCaps(
      owner.usx.address,
      owner.sUSX.address
    );

    await owner.msdController._addMSD(
      owner.usx.address,
      [owner.sUSX.address],
      [0]
    );

    let ownerShareAmount = await owner.sUSX.balanceOf(owner.address);

    await expect(
      owner.sUSX.outboundTransferShares(ownerShareAmount, owner.address)
    ).to.revertedWith("outboundTransferShares: Exceed underlying mint cap!");

    // Revert MSD mint cap to make MSD mint cap be greater than `totalMint`
    await owner.msdController._addMSD(
      owner.usx.address,
      [owner.sUSX.address],
      [originalUSXMintCap]
    );

    // It can outbound transfer shares successfully now
    await expect(
      owner.sUSX.outboundTransferShares(ownerShareAmount, owner.address)
    ).to.changeTokenBalance(owner.sUSX, owner.address, ownerShareAmount.mul(-1));
  });

  it("M-01: Inaccurate maxWithdraw and maxRedeem Function Results", async function () {
    let depositAmount = ethers.utils.parseEther("5000");
    // Deposit
    await owner.sUSX.deposit(depositAmount, owner.address);

    // Get epoch 0 config
    let usrConfig = await owner.sUSX.usrConfigs(0);
    
    // Only 1 epoch at here, pass the whole epoch to earn interest.
    await setNextBlockTimestamp(usrConfig.endTime);
    await increaseBlock(1);

    // Calculate user max withdraw/redeem
    let ownerShareBalance = await owner.sUSX.balanceOf(owner.address);
    let calculatedOwnerMaxWithdrawAssets = await owner.sUSX.convertToAssets(ownerShareBalance);
    let calculatedOwnerMaxRedeemShares = ownerShareBalance;

    // When MSD mint cap is greater than sUSX mint cap, use user own balance
    expect(await owner.sUSX.maxWithdraw(owner.address)).to.eq(calculatedOwnerMaxWithdrawAssets);
    expect(await owner.sUSX.maxRedeem(owner.address)).to.eq(calculatedOwnerMaxRedeemShares);

    // When MSD mint cap is less than sUSX mint cap, use MSD mint cap.
    // Set MSD mint cap
    let newMsdMintCap = ethers.utils.parseEther("1");
    await owner.msdController._addMSD(
      owner.usx.address,
      [owner.sUSX.address],
      [newMsdMintCap]
    );

    expect(await owner.sUSX.maxWithdraw(owner.address)).to.eq(depositAmount.add(newMsdMintCap));
    // Max redeem shares should be calculated by MSD mint cap
    calculatedOwnerMaxRedeemShares = depositAmount.add(newMsdMintCap).mul(RAY).div(await owner.sUSX.currentRate());
    expect(await owner.sUSX.maxRedeem(owner.address)).to.eq(calculatedOwnerMaxRedeemShares);
  });

  it("M-02: Missing Function for Future Config Edits", async function () {
    // Add a new epoch
    let lastEpochConfig = await owner.sUSX.usrConfigs(await owner.sUSX.usrConfigsLength() - 1);

    let newStartTime = lastEpochConfig.endTime.add(300); // 5 minutes later
    let beforeNewEndTime = newStartTime.add(
      lastEpochConfig.endTime.sub(lastEpochConfig.startTime)
    );
    let newUsr = lastEpochConfig.usr;
    await owner.sUSX._addNewUsrConfig(newStartTime, beforeNewEndTime, newUsr);
    lastEpochConfig = await owner.sUSX.usrConfigs(await owner.sUSX.usrConfigsLength() - 1);

    // The last epoch does not start
    expect(lastEpochConfig.endTime).to.gt(await getCurrentTime());

    // 0.0 Update last epoch end time
    let afterNewEndTime = lastEpochConfig.endTime.sub(500); // End five minutes early
    await owner.sUSX._updateLastEpochEndTime(afterNewEndTime);

    lastEpochConfig = await owner.sUSX.usrConfigs(await owner.sUSX.usrConfigsLength() - 1);
    expect(lastEpochConfig.endTime).to.not.eq(beforeNewEndTime);
    expect(lastEpochConfig.endTime).to.eq(afterNewEndTime);

    // 0.1 Revert when new end time is not greater than the epoch start time
    await expect(owner.sUSX._updateLastEpochEndTime(lastEpochConfig.startTime)).to.revertedWith(
      "Invalid new epoch end time!"
    );

    // 0.2 Revert when new end time is not greater than the current time
    await expect(owner.sUSX._updateLastEpochEndTime(await getCurrentTime())).to.revertedWith(
      "Invalid new epoch end time!"
    );

    // 0.3 Revert when the last epoch has ended
    await setNextBlockTimestamp(afterNewEndTime);
    await increaseBlock(1);
    await expect(owner.sUSX._updateLastEpochEndTime(afterNewEndTime)).to.revertedWith(
      "Last epoch has ended!"
    );

    // Add a new epoch to delete
    newStartTime = lastEpochConfig.endTime.add(300); // 5 minutes later
    beforeNewEndTime = newStartTime.add(
      lastEpochConfig.endTime.sub(lastEpochConfig.startTime)
    );
    newUsr = lastEpochConfig.usr;
    await owner.sUSX._addNewUsrConfig(newStartTime, beforeNewEndTime, newUsr);

    // 1.0 Delete last epoch
    let beforeEpochLength = await owner.sUSX.usrConfigsLength();
    await owner.sUSX._deleteLastEpoch();
    expect(await owner.sUSX.usrConfigsLength()).to.eq(beforeEpochLength.sub(1));

    // Add a new epoch to delete
    newStartTime = lastEpochConfig.endTime.add(300); // 5 minutes later
    beforeNewEndTime = newStartTime.add(
      lastEpochConfig.endTime.sub(lastEpochConfig.startTime)
    );
    newUsr = lastEpochConfig.usr;
    await owner.sUSX._addNewUsrConfig(newStartTime, beforeNewEndTime, newUsr);

    // 1.1 Revert when the last epoch has started
    await setNextBlockTimestamp(newStartTime);
    await increaseBlock(1);
    await expect(owner.sUSX._deleteLastEpoch()).to.revertedWith("Last epoch has started!");
  });

  it("M-05: Potential Deposit Blockage", async function () {
    let depositAmount = ethers.utils.parseEther("5000");
    // Deposit
    await owner.sUSX.deposit(depositAmount, owner.address);

    // Get epoch 0 config
    let usrConfig = await owner.sUSX.usrConfigs(0);
    
    // Only 1 epoch at here, pass the whole epoch to make rate is greater than 1.
    await setNextBlockTimestamp(usrConfig.endTime);
    await increaseBlock(1);

    // Do not consider `mintCap`
    let calculatedMaxShares = (await owner.sUSX.mintCap()).sub(await owner.sUSX.totalSupply())
    let calculatedMaxDepositAmount = await owner.sUSX.convertToAssets(calculatedMaxShares);
    let calculatedMaxMintAmount = calculatedMaxShares;

    // When the `mintCap` is greater than `totalSupply` in the sUSX
    let maxDepositAmount = await owner.sUSX.maxDeposit(owner.address);
    let maxMintAmount = await owner.sUSX.maxMint(owner.address);

    expect(maxDepositAmount).to.eq(calculatedMaxDepositAmount);
    expect(maxMintAmount).to.eq(calculatedMaxMintAmount);

    // When the `mintCap` is less than `totalSupply` in the sUSX
    await owner.sUSX._setMintCap(depositAmount.div(2));
    expect(await owner.sUSX.mintCap()).to.lt(await owner.sUSX.totalSupply());

    expect(await owner.sUSX.maxDeposit(owner.address)).to.eq(0);
    expect(await owner.sUSX.maxMint(owner.address)).to.eq(0);
  });
});
