import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import {deploy, execute} from "../utils/utils";

const deployFunction: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
	const {deployments, getNamedAccounts, ethers} = hre;
  const {read} = deployments;
  const {deployer} = await getNamedAccounts();

  let proxyAdmin;
	let usx;
	let msdController;
  let mintCap = ethers.utils.parseEther("10000"); // sUSX
  let startTime = Math.floor(Date.now() / 1000) + 300; // delay 5 minutes
  let endTime = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // delay 1 day
  let usr = ethers.BigNumber.from("1000000003022265980097387650"); // Math.pow(1.1, 1/(365**24*3600)) * 10 ** 27;
  let initialRate = ethers.BigNumber.from("10").pow(27);
  let bridge = "";

	if (!hre.network.live) {
    // Deploy usx when use local environment
    proxyAdmin = await deploy(
			hre,
			"proxyAdmin",	// instance name
			"ProxyAdmin2Step", // contractName
		);
		usx = await deploy(
			hre,
			"USX",	// instance name
			"MockERC20", // contractName
			["Mock ERC20 Token", "MET"], // constructorArgs
		);
		msdController = await deploy(
			hre,
			"msdController",	// instance name
			"MockMSDController", // contractName
		);
    bridge=deployer;
	} else {
		usx = await deployments.get("USX");
		msdController = await deployments.get("msdController");
	}

  let initArgs = ["USX Savings", "sUSX", usx.address, msdController.address, mintCap, startTime, endTime, usr, initialRate, bridge];

  if (!hre.network.live) {
    await deploy(
      hre,
      "sUSX",
      "sUSX",
      initArgs,
      false,
    );

  } else {
    await deploy(
      hre,
      "sUSX",
      "sUSX",
      [],
      true,
      "initialize",
      initArgs
    );
  }
};

deployFunction.tags = ["sUSX"];
export default deployFunction;
