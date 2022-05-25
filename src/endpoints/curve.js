const express = require('express');
const router = express.Router();

const Web3 = require('web3');
const CurveLendingABIAddress = "0x77a4722943A784d29DfD47634CF0d87386196a28"; // TBC

const fs = require('fs');
const curveContract = JSON.parse(fs.readFileSync('src/contracts/CurveLending.json', 'utf8'));

const web3 = new Web3("http://localhost:8545");
const CurveLendingContract = new web3.eth.Contract(curveContract.abi, CurveLendingABIAddress);

router.get('/withdraw', function (req, res) {
    res.send("withdraw WIP");
});

router.get('/deposit', function (req, res) {
    res.send("deposit WIP");
});

const IERC20ABI = JSON.parse(fs.readFileSync('src/contracts/IERC20.json', 'utf8'));

const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

const DAI_CONTRACT = new web3.eth.Contract(IERC20ABI, DAI_ADDRESS);
const USDC_CONTRACT = new web3.eth.Contract(IERC20ABI, USDC_ADDRESS);
const USDT_CONTRACT = new web3.eth.Contract(IERC20ABI, USDT_ADDRESS);

const DAI_WHALE = "0x28c6c06298d514db089934071355e5743bf21d60";
const USDC_WHALE = "0xcffad3200574698b78f32232aa9d63eabd290703";
const USDT_WHALE = "0x5754284f345afc66a98fbb0a0afe71e0f007b949";

router.get('/setupAll', async (req, res) => {
    await DAI_CONTRACT.methods
        .transfer(CurveLendingABIAddress, "1000000")
        .send({ from: DAI_WHALE }, function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        console.log("Hash of DAI transaction: " + res)
    });

    await USDC_CONTRACT.methods
        .transfer(CurveLendingABIAddress, "1000000")
        .send({ from: USDC_WHALE }, function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        console.log("Hash of USDT transaction: " + res)
    });

    await USDT_CONTRACT.methods
        .transfer(CurveLendingABIAddress, "1000000")
        .send({ from: USDT_WHALE }, function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        console.log("Hash of USDC transaction: " + res)
    });

    const DAI_BAL = await DAI_CONTRACT.methods.balanceOf(CurveLendingABIAddress).call(function (err, res) {
        if (err) {
            console.log("An error occured", err)
            return
        }
    return res;
    });
    
    const USDC_BAL = await USDC_CONTRACT.methods.balanceOf(CurveLendingABIAddress).call(function (err, res) {
        if (err) {
            console.log("An error occured", err)
            return
        }
    return res;
    });

    const USDT_BAL = await USDT_CONTRACT.methods.balanceOf(CurveLendingABIAddress).call(function (err, res) {
        if (err) {
            console.log("An error occured", err)
            return
        }
    return res;
    });

    const result = `Contract Balance\nDAI = ${DAI_BAL}\nUSDC = ${USDC_BAL}\nUSDT = ${USDT_BAL}`;
    res.send(result);
});

module.exports = router;