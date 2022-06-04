const express = require('express');
const app = express();
const port = 3000;
const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();

const {router: curve, oneShotDeposit, oneShotWithdraw} = require('./curve')
const { loadDB, findByUserID, findTotals, findUserProportions, findUserIDBalance, insertDocument, findAll, findToday, updateDocument } = require('../mongoDB');

const axios = require('axios');

app.get('/', (_, res) => {
    res.send('Hello World!');
});

app.listen(port, () => {
    console.log(`App listening on port ${port}`);
});

app.get('/mongoTest', async (_, res) => {
    const loadedDb = await loadDB();
    const userIDBalance = await findUserIDBalance(loadedDb, 'ledger', '0x1111111110', 'deposit');
    const totals = await findTotals(loadedDb, 'ledger', 'deposit');
    const props = await findUserProportions(loadedDb, 'ledger', '0x1111111110', 'deposit');

    res.send(`userBal: ${JSON.stringify(userIDBalance)}\ntotals: ${JSON.stringify(totals)}\nproportions:${props}`);
});

app.get('/fetchSpotPrices', async (_, res) => {
    console.log(await userBalanceAggregator('0x1111111111', 'usd'));
    res.send("done");
});

const convexAPYAPI = 'https://www.convexfinance.com/api/curve-apys';

app.get('/getAPYs', jsonParser, async (_, res) => {
    const apys = await axios
        .get(convexAPYAPI)
        .then(res => {;
            return res.data.apys;
        })
        .catch(error => {
            console.log('Issue with fetching Convex APYs', error);
        });

    const loadedDb = await loadDB();
    await insertDocument(loadedDb, 'apys', apys['3pool']);
    console.log('Polled APY from Convex');
    res.send(`Polled today's APY ${JSON.stringify(apys['3pool'])}`);
})

const dayInYears = 1 / 365;

// TODO... - move to cron job
// Updates *existing* balances - will have to add balance of current day's activities as well
app.get('/updateUserBalances', async (_, res) => {
    const loadedDb = await loadDB();
    const apysToday = (await findToday(loadedDb, 'apys'))[0];
    if (!apysToday) {
        console.log("Today's APY is unavailable");
        res.status(400).send("Today's APY is unavaliable");
        return;
    }
    const users = await findAll(loadedDb, 'userBalances');

    for (const userEntry of users) {
        const newLP = calculateFinalAmount(userEntry.baseDeposit.lp, userEntry.accruedInterest.lp, apysToday.baseApy, dayInYears);
        const newCRV = calculateFinalAmount(userEntry.baseDeposit.lp, userEntry.accruedInterest.crv, apysToday.crvApy, dayInYears);
        userEntry.accruedInterest = {baseLP: newLP, crv: newCRV};
        await updateDocument(loadedDb, 'userBalances', userEntry);
    };
    res.send("Updated userBalances with today's APYs");
});

const calculateFinalAmount = (initialCapital, currentBalance, apy, timeInYears) => {
    return (initialCapital * (apy/100) * timeInYears) + currentBalance;
};

// TODO... - move to cron job
// Assumes that all stablecoins are funded into contract already
app.get('/updateWithTodayActivity', async (_, res) => {
    const loadedDb = await loadDB();
    const todaysActivity = await findToday(loadedDb, 'ledger');

    const deposits = todaysActivity.filter(entry => entry.type == 'deposit');
    let daiDeposit = 0;
    let usdcDeposit = 0;
    let usdtDeposit = 0;

    const withdraws = todaysActivity.filter(entry => entry.type == 'withdraw');
    let lpWithdraw = 0;

    // Track user proportion of today's deposit and assign LP received accordingly
    const userDeposits = {};
    const userWithdrawals = {};

    for (const entry of deposits) {
        let user = (await findByUserID(loadedDb, 'userBalances', entry.user))[0];

        if (!user) {
            const baseDeposit = buildBaseDeposit(0, entry.amount.dai, entry.amount.usdc, entry.amount.usdt);
            const accruedInterest = buildAccruedInterest(0, 0);
            user = userBalanceDocument(entry.user, baseDeposit, accruedInterest);
            await insertDocument(loadedDb, 'userBalances', user);
        } else {
            user.baseDeposit = updateBaseDeposit(user.baseDeposit, 0, entry.amount.dai, entry.amount.usdc, entry.amount.usdt);
            await updateDocument(loadedDb, 'userBalances', user);
        }

        daiDeposit += entry.amount.dai;
        usdcDeposit += entry.amount.usdc;
        usdtDeposit += entry.amount.usdt;

        // Update user's own balance
        if (!userDeposits[entry.user]) {
            userDeposits[entry.user] = {dai: entry.amount.dai, usdc: entry.amount.usdc, usdt: entry.amount.usdt};
        } else {
            userDeposits[entry.user] = {dai: userDeposits[entry.user].dai + entry.amount.dai, usdc: userDeposits[entry.user].usdc + entry.amount.usdc, usdt: userDeposits[entry.user].usdt + entry.amount.usdt};
        }
    };

    const depositResult = await oneShotDeposit({dai: daiDeposit, usdc: usdcDeposit, usdt: usdtDeposit});
    await proportionAndUpdateLPDeposit(loadedDb, userDeposits, daiDeposit, depositResult);

    // TODO handle insufficient balance withdrawal
    // Deduct 2% off from interest gained (keep track of interest pulling out so can transfer 2% to treasury)
    for (const entry of withdraws) {
        const user = (await findByUserID(loadedDb, 'userBalances', entry.user))[0];

        lpWithdraw += entry.lpAmount;

        // Update user's own balance
        if (!userWithdrawals[entry.user]) {
            userWithdrawals[entry.user] = {lp: entry.lpAmount};
        } else {
            userWithdrawals[entry.user] = {lp: userWithdrawals[entry.user].lp = entry.lpAmount};
        }
    };

    const withdrawalResult = await oneShotWithdraw(lpWithdraw);
    await proportionAndUpdateWithdraw(loadedDb, userWithdrawals, lpWithdraw, withdrawalResult);

    // TODO - will transfer stablecoins to user account
    console.log("[Transfer funds to each user]")

    res.send("Completed batched deposit and withdraw as well as updating new balances of the day")
});

const userBalanceAggregator = async (user, currency) => {
    const loadedDb = await loadDB();
    const balance = (await findByUserID(loadedDb, 'userBalances', user))[0];
    const todaysActivity = await findToday(loadedDb, 'ledger');

    const deposits = todaysActivity.filter(entry => entry.type == 'deposit' && entry.user == user);
    const totalDeposits = deposits.reduce(function (acc, entry) {
        acc.dai += entry.amount.dai;
        acc.usdc += entry.amount.usdc;
        acc.usdt += entry.amount.usdt;
        return acc;
    }, { dai: 0, usdc: 0, usdt: 0});

    const withdraws = todaysActivity.filter(entry => entry.type == 'withdraw' && entry.user == user);
    const totalLPWithdrawn = withdraws.reduce(function (acc, entry) {
        return acc + entry.lpAmount;
    }, 0)

    prices = await getSpotPrice(currency);

    const currentBalance = (prices['lp-3pool-curve'][currency] * balance.baseDeposit.lp);
    const accruedBalance = (prices['lp-3pool-curve'][currency] * balance.accruedInterest.baseLP) + (prices['curve-dao-token'][currency] * balance.accruedInterest.crv);

    const finalDepositBalance = (prices['dai'][currency] * totalDeposits.dai) + (prices['usd-coin'][currency] * totalDeposits.usdc) + (prices['tether'][currency] * totalDeposits.usdt);
    const finalWithdrawnBalance = prices['lp-3pool-curve'][currency] * totalLPWithdrawn;

    const baseDepositBalance = currentBalance + finalDepositBalance - finalWithdrawnBalance;

    return {
        baseDepositBalance,
        accruedBalance,
        currency
    };
}

const coingeckoAPI = 'https://api.coingecko.com/api/v3/simple/price?ids=dai%2Ctether%2Cusd-coin%2Clp-3pool-curve%2Cconvex-finance%2Ccurve-dao-token&vs_currencies=';

const getSpotPrice = async (currency) => {
    return await axios
        .get(coingeckoAPI + currency)
        .then(res => {;
            return res.data;
        })
        .catch(error => {
            console.log('Issue with fetching Coingecko API', error);
        });
};

const proportionAndUpdateWithdraw = async (_db, userWithdrawals, totalLPWithdrawals, withdrawalResult) => {
    for (userKey in userWithdrawals) {
        const proportion = userWithdrawals[userKey].lp / totalLPWithdrawals;
        const balance = (await findByUserID(_db, 'userBalances', userKey))[0];

        const daiReceived = withdrawalResult.realisedAssetBal.dai * proportion;
        const usdcReceived = withdrawalResult.realisedAssetBal.usdc * proportion;
        const usdtReceived = withdrawalResult.realisedAssetBal.usdt * proportion;
        balance.baseDeposit = updateBaseDeposit(balance.baseDeposit, -userWithdrawals[userKey].lp, -daiReceived, -usdcReceived, -usdtReceived);

        await updateDocument(_db, 'userBalances', balance);
    };
};

const proportionAndUpdateLPDeposit = async (_db, userDeposits, totalDaiDeposits, depositResult) => {
    for (const userKey in userDeposits) {
        const proportion = userDeposits[userKey].dai / totalDaiDeposits; // Assumed that amount deposit for each stablecoins are equivalent
        const balance = (await findByUserID(_db, 'userBalances', userKey))[0];

        const lpReceived = depositResult.convexLPReceived * proportion;
        balance.baseDeposit = updateBaseDeposit(balance.baseDeposit, lpReceived, 0, 0, 0);

        await updateDocument(_db, 'userBalances', balance);
    };
};

const updateBaseDeposit = (current, lp, dai, usdc, usdt) => {
    current.lp += lp;
    current.dai += dai;
    current.usdc += usdc;
    current.usdt += usdt;
    return current;
};

const buildBaseDeposit = (lp, dai, usdc, usdt) => {
    return {
        lp,
        dai,
        usdc,
        usdt
    }
};

const buildAccruedInterest = (lp, crv) => {
    return {
        lp,
        crv
    }
};

const userBalanceDocument = (user, baseDeposit, accruedInterest) => {
    return {
        user,
        baseDeposit,
        accruedInterest
    }
};

const TAKEHOME_PERCENT = 0.02;

app.get('/userBalance', jsonParser, async (req, res) => {
    if (!req.body.user || !req.body.currency) {
        res.status(400).send("Missing body attributes");
        return;
    }

    const userBalance = await userBalanceAggregator(req.body.user, req.body.currency);
    console.log(userBalance);
    res.send(augmentUserBalance(userBalance, TAKEHOME_PERCENT));
});

const augmentUserBalance = (userBalance, takehomePercentage) => {
    const userReceivesPercent = 1 - takehomePercentage;
    userBalance.accruedBalance *= userReceivesPercent;
    return userBalance;
}

app.use('/curve', curve);