const { assert, expect } = require("chai")
const { network, getNamedAccounts, deployments, ethers } = require("hardhat")
const {
    developmentChains,
    networkConfig,
} = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery Unit Tests", function () {
          let lottery, vrfCoordinatorV2Mock, entranceFee, deployer, interval
          const chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              lottery = await ethers.getContract("Lottery", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract(
                  "VRFCoordinatorV2Mock",
                  deployer
              )
              entranceFee = await lottery.getEntranceFee()
              interval = await lottery.getInterval()
          })

          describe("constructor", function () {
              it("Initializes the Lottery Correctly", async function () {
                  const lotteryState = await lottery.getLotteryState()

                  assert.equal(lotteryState.toString(), "0")
                  assert.equal(
                      interval.toString(),
                      networkConfig[chainId]["interval"]
                  )
              })
          })

          describe("Enter Lottery", function () {
              it("Reverts when users don,t pay enough", async function () {
                  await expect(lottery.enterLottery()).to.be.revertedWith(
                      "Lottery__NotEnoughETHEntered"
                  )
              })
              it("Records Players when they enter", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  const playerFromContract = await lottery.getPlayers(0)
                  assert.equal(playerFromContract, deployer)
              })
              it("Emits event on enter", async function () {
                  await expect(
                      lottery.enterLottery({
                          value: entranceFee,
                      })
                  ).to.emit(lottery, "LotteryEnter")
              })
              it("Doesn't Allow Entrance when Lottery is calculating", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.send("evm_mine", [])
                  await lottery.performUpkeep([])
                  await expect(
                      lottery.enterLottery({ value: entranceFee })
                  ).to.be.revertedWith("Lottery__NotOpen")
              })
          })
          describe("checkUpkeep", function () {
              it("Returns false if people haven't sent ETH", async function () {
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep(
                      []
                  )
                  assert(!upkeepNeeded)
              })
              it("Returns False If Lottery isn't Open", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.send("evm_mine", [])
                  await lottery.performUpkeep([])
                  const lotteryState = await lottery.getLotteryState()
                  const upkeepNeeded = await lottery.callStatic.checkUpkeep([])
                  assert.equal(
                      lotteryState.toString() == "1",
                      upkeepNeeded.upKeepNeeded == false
                  )
              })
              it("returns false if enough time hasn't passed", async () => {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() - 1,
                  ])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await lottery.callStatic.checkUpkeep(
                      []
                  )
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.send("evm_mine", [])
                  const [upkeepNeeded] = await lottery.callStatic.checkUpkeep(
                      []
                  )
                  assert(upkeepNeeded)
              })
          })
          describe("performupkeep", function () {
              it("can only run if checkupKeep is true", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.send("evm_mine", [])
                  const tx = await lottery.performUpkeep([])
                  assert(tx)
              })
              it("Reverts when checkUpKeep is false", async function () {
                  await expect(lottery.performUpkeep([])).to.be.revertedWith(
                      "Lottery_UpKeepNotNeeded"
                  )
              })
              it("Updates the lottery satate, emits an event and calls the vrfcoordinator", async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await lottery.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId
                  const lotteryState = await lottery.getLotteryState()
                  assert(requestId.toNumber() > 0)
                  assert(lotteryState.toString() == "1")
              })
          })
          describe("fulfillRandomWords", function () {
              beforeEach(async function () {
                  await lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [
                      interval.toNumber() + 1,
                  ])
                  await network.provider.send("evm_mine", [])
              })

              it("Can only be called after performUpKeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(
                          0,
                          lottery.address
                      )
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(
                          1,
                          lottery.address
                      )
                  ).to.be.revertedWith("nonexistent request")
              })
              it("Picks a winner, resets the lottery, and sends money", async function () {
                  const additionalEntrances = 3
                  const startingAccountIndex = 1
                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrances;
                      i++
                  ) {
                      const accountConnectedLottery = lottery.connect(
                          accounts[i]
                      )
                      await accountConnectedLottery.enterLottery({
                          value: entranceFee,
                      })
                  }
                  const startingTimeStamp = await lottery.getLatestTimeStamp()

                  await new Promise(async (resolve, reject) => {
                      lottery.once("WinnerPicked", async () => {
                          console.log("Found the Event!")
                          try {
                              const recentWinner =
                                  await lottery.getRecentWinner()
                              console.log(recentWinner)
                              console.log(accounts[2].address)
                              console.log(accounts[1].address)
                              console.log(accounts[0].address)
                              console.log(accounts[3].address)

                              const lotteryState =
                                  await lottery.getLotteryState()
                              const endingTimeStamp =
                                  await lottery.getLatestTimeStamp()
                              const numPlayers =
                                  await lottery.getNumberOfPlayers()
                              const winnerEndingBalance =
                                  await accounts[1].getBalance()
                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(lotteryState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)

                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      entranceFee
                                          .mul(additionalEntrances)
                                          .add(entranceFee)
                                          .toString()
                                  )
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      const tx = await lottery.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance =
                          await accounts[1].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          lottery.address
                      )
                  })
              })
          })
      })
