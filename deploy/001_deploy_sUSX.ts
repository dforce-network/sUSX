import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import {deploy, execute} from "../utils/utils";
import { network } from "hardhat";

const deployFunction: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const {deployments, getNamedAccounts, ethers} = hre;
  const {execute, read} = deployments;
  const {deployer} = await getNamedAccounts();

  let proxyAdmin;
  let usx;
  let msdController;
  let mintCap; // sUSX
  let startTime = 1719489600;
  let endTime = 1726488000;
  let usr = ethers.BigNumber.from("1000000004431822129783702592"); // Math.pow(1.15, 1/(365*24*3600)) * 10 ** 27;
  let initialRate = ethers.BigNumber.from("10").pow(27);

  if (!hre.network.live) {
    // Deploy usx when use local environment
    proxyAdmin = await deploy(
      hre,
      "proxyAdmin", // instance name
      "ProxyAdmin2Step" // contractName
    );
    usx = await deploy(
      hre,
      "USX", // instance name
      "MockERC20", // contractName
      ["Mock ERC20 Token", "MET"] // constructorArgs
    );
    msdController = await deploy(
      hre,
      "msdController", // instance name
      "MockMSDController" // contractName
    );
  } else {
    usx = await deployments.get("USX");
    msdController = await deployments.get("msdController");
  }

  if (network.name == "mainnet") {
    mintCap = ethers.utils.parseEther("3000000");
  } else if (network.name == "arbitrum") {
    mintCap = ethers.utils.parseEther("4000000");
  } else if (network.name == "optimism") {
    mintCap = ethers.utils.parseEther("1000000");
  } else if (network.name == "base") {
    mintCap = ethers.utils.parseEther("1000000");
  } else if (network.name == "bsc") {
    mintCap = ethers.utils.parseEther("1000000");
  } else {
    throw (network.name, " does not support!");
  }

  let initArgs = [
    "Saving USX",
    "sUSX",
    usx.address,
    msdController.address,
    mintCap,
    startTime,
    endTime,
    usr,
    initialRate,
  ];

  if (!hre.network.live) {
    let sUSX = await deploy(hre, "sUSX", "sUSX", initArgs, false);

    let bridgeRoleString = await read("sUSX", "BRIDGER_ROLE");
    let pauserRoleString = await read("sUSX", "PAUSER_ROLE");

    // Set bridge role for sUSX
    await execute(
      "sUSX",
      {from: deployer, log: true},
      "grantRole",
      bridgeRoleString,
      deployer
    );

    // Set pauser role for sUSX
    await execute(
      "sUSX",
      {from: deployer, log: true},
      "grantRole",
      pauserRoleString,
      deployer
    );

    // Set mint cap for usx in the msdController
    await execute(
      "msdController",
      {from: deployer, log: true},
      "_addMSD",
      usx.address,
      [sUSX.address], // minters
      [ethers.utils.parseEther("200000000")] // caps
    );
  } else {
    await deploy(hre, "sUSX", "sUSX", [...initArgs
    ], true, "initialize", initArgs, false);
  }
};

deployFunction.tags = ["sUSX"];
export default deployFunction;
