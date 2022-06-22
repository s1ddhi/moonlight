const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();

const Web3 = require('web3');
const CurveLendingABIAddress = "0xd78a616b91ed39990a6ab4497c37861ae3c856bef796f4a02c71080085630f53"; // TBC

const fs = require('fs');
const curveContract = JSON.parse(fs.readFileSync('src/contracts/CurveLending.json', 'utf8'));

const web3 = new Web3("http://localhost:8545");
const CurveLendingContract = new web3.eth.Contract(curveContract.abi, CurveLendingABIAddress);

const { loadDB, insertDocument } = require('../mongoDB');
const { userBalanceAggregator, getSpotPrice } = require('../utilities');

const LEDGER_COLLECTION = 'ledger';
const WITHDRAW_TYPE = 'withdraw';
const DEPOSIT_TYPE = 'deposit';


// TODO check balance available to withdraw
const oneShotWithdraw = async (requestedWithdrawalLP) => {
    const accounts = await web3.eth.getAccounts();

    const intialAssetBal = await getContractBalance();

    await CurveLendingContract.methods
    .oneShotWithdraw(unnormalise(requestedWithdrawalLP, ERC20_DECIMAL))
    .send({ from: accounts[0], gas: 1e7 }, function (err, _) {
        if (err) {
            console.log("An error occured in oneShotLendAll", err)
            return
        }
    });

    const finalAssetBal = await getContractBalance();
    const realisedAssetBal = findAssetDifference(intialAssetBal, finalAssetBal);

    console.log(`Batched withdrawn ${requestedWithdrawalLP} received ${JSON.stringify(realisedAssetBal)}`);

    return({
        requestedWithdrawalLP,
        realisedAssetBal
    });
};

router.post('/withdrawRequest', jsonParser, async (req, res) => {
    console.log(req.body)
    if (!req.body.user || !req.body.requestedWithdrawal || !req.body.currency) {
        res.status(400).send("Missing body attributes");
        return;
    }

    const user = req.body.user;
    const requestedWithdrawal = req.body.requestedWithdrawal;
    const currency = req.body.currency;

    const userBalance = await userBalanceAggregator(user, currency);

    if (requestedWithdrawal > userBalance.baseDepositBalance + userBalance.accruedBalance) {
        res.status(400).send("Insufficient funds to sustain withdrawal request.");
        return;
    }

    // convert to LP
    const requestedWithdrawalLP = await convertToLP(requestedWithdrawal, currency);

    console.log("withdraw!")

    const loadedDb = await loadDB();

    await insertDocument(loadedDb, LEDGER_COLLECTION, ledgerDocument({ user, lpAmount: 100 }, WITHDRAW_TYPE)); // TODO actually store amount of DAI, USDC, USDT received

    res.send({
        user,
        requestedWithdrawalLP
    });
});

const convertToLP = async (amount, currency) => {
    const prices = await getSpotPrice(currency);
    return amount / prices['lp-3pool-curve'][currency]
};

const findAssetDifference = (initial, final) => {
    return({
        dai: final.dai.sub(initial.dai).toNumber(),
        usdc: final.usdc.sub(initial.usdc).toNumber(),
        usdt: final.usdt.sub(initial.usdc).toNumber()
    });
};

const ledgerDocument = (details, type) => {
    const doc = { user: details.user, type }
    if (type == 'deposit') {
        doc.amount = details.amount;
    } else {
        doc.lpAmount = details.lpAmount;
    }
    return doc;
};

const oneShotDeposit = async (requestedDeposit) => {
    const accounts = await web3.eth.getAccounts();

    const initalStakedConvexLPBal = await CurveLendingContract.methods
        .getStakedConvexLPBalance()
        .call(function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        return res;
        });

    await CurveLendingContract.methods
        .oneShotLend(unnormalise(requestedDeposit.dai, DAI_DECIMAL), unnormalise(requestedDeposit.usdc, USDC_DECIMAL), unnormalise(requestedDeposit.usdt, USDT_DECIMAL))
        .send({ from: accounts[0], gas: 1e7 }, function (err, _) {
            if (err) {
                console.log("An error occured in oneShotLendAll", err)
                return
            }
        });

    const finalStakedConvexLPBal = await CurveLendingContract.methods
        .getStakedConvexLPBalance()
        .call(function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        return res;
        });

    console.log("diff", initalStakedConvexLPBal.toString(), finalStakedConvexLPBal.toString())

    const stakedConvexLPBalDifference = web3.utils.toBN(finalStakedConvexLPBal).sub(web3.utils.toBN(initalStakedConvexLPBal));

        console.log("diffactual", stakedConvexLPBalDifference.toString())

    console.log(`Batched depositing ${JSON.stringify(requestedDeposit)} receiving ${normalise(stakedConvexLPBalDifference, ERC20_DECIMAL).toNumber()} LPs`);

    return({
        requestedDeposit,
        convexLPReceived: normalise(stakedConvexLPBalDifference, ERC20_DECIMAL).toNumber()});
};

// TODO Won't actually deposit but add request to ledger - ensure functionality works as expected
router.post('/depositRequest', jsonParser, async (req, res) => {
    if (!req.body.user || !req.body.requestedDeposit || !req.body.currency) {
        res.status(400).send("Missing body attributes");
        return;
    }

    const user = req.body.user;
    const requestedDeposit = req.body.requestedDeposit;
    const currency = req.body.currency;

    // TODO This will trigger the fiat to crypto flow and report back the realised cryptoassets sent to the contract
    const amount = await fiatToCryptoFlow(user, requestedDeposit, currency);

    const loadedDb = await loadDB();

    await insertDocument(loadedDb, LEDGER_COLLECTION, ledgerDocument({ user, amount }, DEPOSIT_TYPE));

    res.send({
        user,
        amount
    })
});

const fiatToCryptoFlow = async (user, requestedDeposit, currency) => {
    // To be implemented
    return {dai: requestedDeposit, usdc: requestedDeposit, usdt: requestedDeposit}
};

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
    return web3.utils.toBN(normalisedAmount).mul(web3.utils.toBN(10).pow(web3.utils.toBN(assetDecimal)));
};

const normalise = (unnormalisedAmount, assetDecimal) => {
    if (!web3.utils.isBN(unnormalisedAmount)) {
        unnormalisedAmount = web3.utils.toBN(unnormalisedAmount);
    }

    return unnormalisedAmount.div(web3.utils.toBN(10).pow(web3.utils.toBN(assetDecimal)));
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

    //console.log(`Contract Balance:\nDAI = ${normalise(DAI_BAL, DAI_DECIMAL)}\nUSDC = ${normalise(USDC_BAL, USDC_DECIMAL)}\nUSDT = ${normalise(USDT_BAL, USDT_DECIMAL)}`);

    return({
        dai: normalise(DAI_BAL, DAI_DECIMAL),
        usdc: normalise(USDC_BAL, USDC_DECIMAL),
        usdt: normalise(USDT_BAL, USDT_DECIMAL)
    });
}

// ---------- TESTING METHODS ----------

router.post('/withdraw', jsonParser, async (req, res) => {
    const accounts = await web3.eth.getAccounts();

    if (!req.body.user || !req.body.requestedWithdrawalLP) {
        res.status(400).send("Missing body attributes");
        return;
    }

    const user = req.body.user;
    const requestedWithdrawalLP = req.body.requestedWithdrawalLP;

    const intialAssetBal = await getContractBalance();

    const loadedDb = await loadDB();

    console.log(`Withdrawing ${requestedWithdrawalLP} from user ${user}`)

    await CurveLendingContract.methods
    .oneShotWithdraw(unnormalise(requestedWithdrawalLP, ERC20_DECIMAL))
    .send({ from: accounts[0], gas: 1e7 }, function (err, _) {
        if (err) {
            console.log("An error occured in oneShotLendAll", err)
            return
        }
    });

    const finalAssetBal = await getContractBalance();
    const realisedAssetBal = findAssetDifference(intialAssetBal, finalAssetBal);

    await insertDocument(loadedDb, LEDGER_COLLECTION, ledgerDocument({ user, lpAmount: requestedWithdrawalLP }, WITHDRAW_TYPE)); // TODO actually store amount of DAI, USDC, USDT received

    res.send({
        user,
        requestedWithdrawalLP,
        realisedAssetBal
    });
});

router.post('/deposit', jsonParser, async (req, res) => {
    const accounts = await web3.eth.getAccounts();

    if (!req.body.user || !req.body.requestedDeposit) {
        res.status(400).send("Missing body attributes");
        return;
    }

    const user = req.body.user;
    const requestedDeposit = req.body.requestedDeposit;

    const loadedDb = await loadDB();

    // TODO Check with simulation which value actually increases
    const initalStakedConvexLPBal = await CurveLendingContract.methods
        .getStakedConvexLPBalance()
        .call(function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        return res;
        });

    console.log(`Depositing ${JSON.stringify(requestedDeposit)} from user ${user}`);

    await CurveLendingContract.methods
        .oneShotLend(unnormalise(requestedDeposit.dai, DAI_DECIMAL), unnormalise(requestedDeposit.usdc, USDC_DECIMAL), unnormalise(requestedDeposit.usdt, USDT_DECIMAL))
        .send({ from: accounts[0], gas: 1e7 }, function (err, _) {
            if (err) {
                console.log("An error occured in oneShotLendAll", err)
                return
            }
        });

    const finalStakedConvexLPBal = await CurveLendingContract.methods
        .getStakedConvexLPBalance()
        .call(function (err, res) {
            if (err) {
                console.log("An error occured", err)
                return
            }
        return res;
        });

    const stakedConvexLPBalDifference = web3.utils.toBN(finalStakedConvexLPBal).sub(web3.utils.toBN(initalStakedConvexLPBal));

    // TODO check against logs of deposit, find proportion and assign LP according to proportion (e.g. 1000 of each stable coin if 1/10 if there was a total of each 10000 stablecoins deposited at once)

    await insertDocument(loadedDb, LEDGER_COLLECTION, ledgerDocument({ user, amount: requestedDeposit }, DEPOSIT_TYPE));

    res.send({
        user,
        requestedDeposit,
        convexLPReceived: normalise(stakedConvexLPBalDifference, ERC20_DECIMAL).toNumber()})
});

// ---------- TESTING METHODS ----------

module.exports = {router, oneShotDeposit, oneShotWithdraw};