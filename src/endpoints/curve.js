const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();

const Web3 = require('web3');
const CurveLendingABIAddress = "0x47aedF700c7bc22614F0978ECaB22232Cbd86670"; // TBC

const fs = require('fs');
const curveContract = JSON.parse(fs.readFileSync('src/contracts/CurveLending.json', 'utf8'));

const web3 = new Web3("http://localhost:8545");
const CurveLendingContract = new web3.eth.Contract(curveContract.abi, CurveLendingABIAddress);

const { loadDB, findByUserID, findUserIDBalance, insertDocument, closeDB } = require('../mongoDB');
const req = require('express/lib/request');

const LEDGER_COLLECTION = 'ledger';
const WITHDRAW_TYPE = 'withdraw';
const DEPOSIT_TYPE = 'deposit';

router.post('/withdraw', jsonParser, async (req, res) => {
    const accounts = await web3.eth.getAccounts();

    if (!req.body.user || !req.body.requestedWithdrawal) {
        res.status(400).send("Missing body attributes");
        return;
    }

    const user = req.body.user;
    const requestedWithdrawal = req.body.requestedWithdrawal;

    const loadedDb = await loadDB();
    const aggregatedBalance = await findUserIDBalance(loadedDb, LEDGER_COLLECTION, user, DEPOSIT_TYPE);

    if (aggregatedBalance < requestedWithdrawal) {
        res.statusCode = 400;
        res.send(`There is insufficient balance for user ${user}`);
        return;
    };

    await insertDocument(loadedDb, LEDGER_COLLECTION, ledgerDocument(user, requestedWithdrawal, WITHDRAW_TYPE));

    console.log(`Withdrawing ${requestedWithdrawal} from user ${user}`)

    await CurveLendingContract.methods
    .oneShotWithdrawAll()
    .send({ from: accounts[0], gas: 1e7 }, function (err, _) {
        if (err) {
            console.log("An error occured in oneShotLendAll", err)
            return
        }
    });

    const stakedConvexLPBal = await CurveLendingContract.methods
        .getStakedConvexLPBalance()
        .call(function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        return res;
        });

    res.send(`Staked Convex LP Balance: ${normalise(stakedConvexLPBal, ERC20_DECIMAL)} <br>${await getContractBalance()}</br>`);
});

const ledgerDocument = (user, amount, type) => {
    return {
        user,
        amount,
        type,
        date: new Date()
    };
};


router.post('/deposit', jsonParser, async (req, res) => {
    const accounts = await web3.eth.getAccounts();

    if (!req.body.user || !req.body.requestedDeposit) {
        res.status(400).send("Missing body attributes");
        return;
    }

    const user = req.body.user;
    const requestedDeposit = req.body.requestedDeposit;

    const loadedDb = await loadDB();

    console.log(ledgerDocument(user, requestedDeposit, DEPOSIT_TYPE));

    await insertDocument(loadedDb, LEDGER_COLLECTION, ledgerDocument(user, requestedDeposit, DEPOSIT_TYPE));

    console.log(`Depositing ${requestedDeposit} from user ${user}`)

    await CurveLendingContract.methods
        .oneShotLendAll()
        .send({ from: accounts[0], gas: 1e7 }, function (err, _) {
            if (err) {
                console.log("An error occured in oneShotLendAll", err)
                return
            }
        });

    const stakedConvexLPBal = await CurveLendingContract.methods
        .getStakedConvexLPBalance()
        .call(function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        return res;
        });

    res.send(`Staked Convex LP Balance: ${normalise(stakedConvexLPBal, ERC20_DECIMAL)} <br>${await getContractBalance()}</br>`);
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

const DAI_DECIMAL = 18;
const USDC_DECIMAL = 6;
const USDT_DECIMAL = 6;
const ERC20_DECIMAL = 18;

router.get('/setupAll', async (_, res) => {
    const assetVal = 1e6;

    await DAI_CONTRACT.methods
        .transfer(CurveLendingABIAddress, unnormalise(assetVal, DAI_DECIMAL))
        .send({ from: DAI_WHALE }, function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        console.log("Hash of DAI transaction: " + res)
    });

    await USDC_CONTRACT.methods
        .transfer(CurveLendingABIAddress, unnormalise(assetVal, USDC_DECIMAL))
        .send({ from: USDC_WHALE }, function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        console.log("Hash of USDT transaction: " + res)
    });

    await USDT_CONTRACT.methods
        .transfer(CurveLendingABIAddress, unnormalise(assetVal, USDT_DECIMAL))
        .send({ from: USDT_WHALE }, function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        console.log("Hash of USDC transaction: " + res)
    });

    res.send(await getContractBalance());
});

const unnormalise = (normalisedAmount, assetDecimal) => {
    return web3.utils.toBN(normalisedAmount).mul(web3.utils.toBN(10).pow(web3.utils.toBN(assetDecimal)))
};

const normalise = (unnormalisedAmount, assetDecimal) => {
    return web3.utils.toBN(unnormalisedAmount).div(web3.utils.toBN(10).pow(web3.utils.toBN(assetDecimal)));
};

const getContractBalance = async () => {
    const DAI_BAL = await DAI_CONTRACT.methods.balanceOf(CurveLendingABIAddress).call(function (err, res) {
        if (err) {
            console.log("An error occured", err);
            return;
        }
        return res;
    });

    const USDC_BAL = await USDC_CONTRACT.methods.balanceOf(CurveLendingABIAddress).call(function (err, res) {
        if (err) {
            console.log("An error occured", err);
            return;
        }
        return res;
    });

    const USDT_BAL = await USDT_CONTRACT.methods.balanceOf(CurveLendingABIAddress).call(function (err, res) {
        if (err) {
            console.log("An error occured", err);
            return;
        }
        return res;
    });

    return `Contract Balance: DAI = ${normalise(DAI_BAL, DAI_DECIMAL)}\nUSDC = ${normalise(USDC_BAL, USDC_DECIMAL)}\nUSDT = ${normalise(USDT_BAL, USDT_DECIMAL)}`;
}

module.exports = router;
