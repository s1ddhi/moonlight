const express = require('express');
const app = express();
const port = 3000;
const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();

const {router: curve, oneShotDeposit, oneShotWithdraw} = require('./curve')
const { loadDB, findByUserID, findTotals, findUserProportions, findUserIDBalance, insertDocument, findAll, findToday, updateDocument } = require('../mongoDB');

const axios = require('axios');

const isToday = require('date-fns/isToday');

const { userBalanceAggregator, proportionAndUpdateWithdraw, proportionAndUpdateLPDeposit, updateBaseDeposit, buildBaseDeposit, buildAccruedInterest, userBalanceDocument } = require('../utilities');

app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:19006');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Pass to next layer of middleware
    next();
});

app.get('/', (_, res) => {
    const date = new Date();
    date.setHours(0,0,0,-1);
    // date.setFullYear(2022, 5, 4);
    console.log(date);
    console.log(isToday(date));
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
    if (users.length === 0) {
        res.send('No users to update today');
        return;
    }

    for (const userEntry of users) {
        const newLP = calculateFinalAmount(!userEntry.baseDeposit.lp ? 0 : userEntry.baseDeposit.lp, !userEntry.accruedInterest.baseLP ? 0 : !userEntry.accruedInterest.baseLP, apysToday.baseApy, dayInYears);
        const newCRV = calculateFinalAmount(!userEntry.baseDeposit.lp ? 0 : userEntry.baseDeposit.lp, !userEntry.accruedInterest.crv ? 0 : !userEntry.accruedInterest.crv, apysToday.crvApy, dayInYears);
        userEntry.accruedInterest = {baseLP: newLP, crv: newCRV};
        await updateDocument(loadedDb, 'userBalances', userEntry);
    };
    res.send("Updated userBalances with today's APYs");
});

const calculateFinalAmount = (initialCapital, currentBalance, apy, timeInYears) => {
    console.log("lel", initialCapital, currentBalance, apy);
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
            userDeposits[entry.user] = {
                dai: entry.amount.dai,
                usdc: entry.amount.usdc,
                usdt: entry.amount.usdt
        };
        } else {
            userDeposits[entry.user] = {
                dai: userDeposits[entry.user].dai + entry.amount.dai,
                usdc: userDeposits[entry.user].usdc + entry.amount.usdc,
                usdt: userDeposits[entry.user].usdt + entry.amount.usdt
            };
        }
    };

    if (daiDeposit !== 0 || usdcDeposit !== 0 || usdtDeposit !== 0) {
        console.log(daiDeposit, usdcDeposit, usdtDeposit)
        const depositResult = await oneShotDeposit({dai: daiDeposit, usdc: usdcDeposit, usdt: usdtDeposit});
        console.log(depositResult)
        await proportionAndUpdateLPDeposit(loadedDb, userDeposits, daiDeposit, depositResult);
    };

    // TODO handle insufficient balance withdrawal
    // Deduct 2% off from interest gained (keep track of interest pulling out so can transfer 2% to treasury)
    for (const entry of withdraws) {
        const user = (await findByUserID(loadedDb, 'userBalances', entry.user))[0];

        lpWithdraw += entry.lpAmount;

        // Update user's own balance
        if (!userWithdrawals[entry.user]) {
            userWithdrawals[entry.user] = {
                lp: entry.lpAmount
            };
        } else {
            userWithdrawals[entry.user] = {
                lp: userWithdrawals[entry.user].lp + entry.lpAmount
            };
        }
    };

    if (lpWithdraw !== 0) {
        const withdrawalResult = await oneShotWithdraw(lpWithdraw);
        await proportionAndUpdateWithdraw(loadedDb, userWithdrawals, lpWithdraw, withdrawalResult);
        // TODO - will transfer stablecoins to user account
        console.log("[Transfer funds to each user]")
    };

    res.send("Completed batched deposit and withdraw as well as updating new balances of the day")
});

const TAKEHOME_PERCENT = 0.02;

app.put('/userBalance', jsonParser, async (req, res) => {
    console.log(req.body);
    if (!req.body.user || !req.body.currency) {
        res.status(400).send("Missing body attributes");
        return;
    }

    const userBalance = await userBalanceAggregator(req.body.user, req.body.currency);

    const apys = await getAPYsNow();

    userBalance.apy = aggregateAPY(apys['3pool']);

    if (Object.keys(userBalance).length == 0) {
        res.status(400).send(`User ${req.body.user} not found`);
        return;
    }

    res.send(augmentUserBalance(userBalance, TAKEHOME_PERCENT));
});

const getAPYsNow = async () => {
    const apys = await axios
        .get(convexAPYAPI)
        .then(res => {;
            return res.data.apys;
        })
        .catch(error => {
            console.log('Issue with fetching Convex APYs', error);
    });
    return apys;
}

const aggregateAPY = (todayAPYs) => {
    return todayAPYs.baseApy + todayAPYs.crvApy;
};

const augmentUserBalance = (userBalance, takehomePercentage) => {
    const userReceivesPercent = 1 - takehomePercentage;
    userBalance.accruedBalance *= userReceivesPercent;
    return userBalance;
}

app.use('/curve', curve);