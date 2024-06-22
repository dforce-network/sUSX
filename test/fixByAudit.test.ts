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

describe("USX Saving", function () {
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
});
