const fs = require("fs")
const { network, ethers } = require("hardhat")

const FRONT_END_ADDRESSES_FILE =
"../nextjs-lottery-smartcontract/constants/contractAddresses.json"
const FRONT_END_ABI_FILE =
 "../nextjs-lottery-smartcontract/constants/abi.json"




module.exports = async function () {
    if (process.env.UPDATE_FRONT_END) {
        console.log("Updating front end...")
        updateContractAddresses()
        updateAbi()
    }
}

async function updateAbi() {
    const lottery = await ethers.getContract("Lottery")
    fs.writeFileSync(
        FRONT_END_ABI_FILE,
        lottery.interface.format(ethers.utils.FormatTypes.json)
    )
}

async function updateContractAddresses() {
    const lottery = await ethers.getContract("Lottery")
    const contractAddresses = JSON.parse(
        fs.readFileSync(FRONT_END_ADDRESSES_FILE, "utf8")
    )
    const chainId = network.config.chainId.toString()
    if (chainId in contractAddresses) {
        if (!contractAddresses[chainId].includes(lottery.address)) {
            contractAddresses[chainId].push(lottery.address)
        }
    } else {
        contractAddresses[chainId] = [lottery.address]
    }
    fs.writeFileSync(
        FRONT_END_ADDRESSES_FILE,
        JSON.stringify(contractAddresses)
    )
}

module.exports.tags = ["all", "Frontend"]
