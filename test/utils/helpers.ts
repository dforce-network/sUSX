import hre from 'hardhat';
const {time} = require("@nomicfoundation/hardhat-network-helpers");

// Pause/Unpause mining automatically.
export async function miningAutomatically(automatic:boolean) {
	await hre.network.provider.send("evm_setAutomine", [automatic]);
}

// Simulate to mine new blocks.
export async function increaseBlock(blockNumber:number) {
  while (blockNumber > 0) {
    blockNumber--;
    await hre.network.provider.request({
      method: "evm_mine",
      params: [],
    });
  }
}

// Simulate the time passed.
export async function increaseTime(time:number) {
  await hre.network.provider.request({
    method: "evm_increaseTime",
    params: [time],
  });
}

// Get current timestamp
export async function getCurrentTime() {
  return await time.latest();
}
