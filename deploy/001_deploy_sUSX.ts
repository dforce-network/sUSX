import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import {deploy, execute} from "../utils/utils";

const deployFunction: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
	const {deployments, getNamedAccounts, ethers} = hre;
  const {read} = deployments;
  let proxyAdmin;
	let usx;
	let msdController;
  let mintCap = ethers.utils.parseEther("10000"); // sUSX
  let startTime = (Date.now() / 1000).toFixed() + 300; // delay 5 minutes
  let endTime = (Date.now() / 1000).toFixed() + 60 * 60 * 24; // delay 1 day
  let usr = ethers.BigNumber.from("1000000003022265980097387650"); // Math.pow(1.1, 1/(365**24*3600)) * 10 ** 27;

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
	} else {
		usx = await deployments.get("USX");
		msdController = await deployments.get("msdController");
	}

  if (!hre.network.live) {
    await deploy(
      hre,
      "sUSX",
      "sUSX",
      [usx.address, msdController.address, mintCap, startTime, endTime, usr],
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
      [usx.address, msdController.address, mintCap, startTime, endTime, usr]
    );
  }
};

deployFunction.tags = ["sUSX"];
export default deployFunction;
