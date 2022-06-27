const express = require('express');
const axios = require('axios');
const app = express();
const port = 4000;

const cron = require('node-cron');
const { loadDB, findByUserID, insertDocument, findAll, findToday, updateDocument } = require('../mongoDB');

const { proportionAndUpdateWithdraw, proportionAndUpdateLPDeposit, updateBaseDeposit, buildBaseDeposit, buildAccruedInterest, userBalanceDocument, calculateFinalAmount } = require('../utilities');

const convexAPYAPI = 'https://www.convexfinance.com/api/curve-apys';

// Polls at 23:59 every day
cron.schedule('59 23 * * *', async () => {
    await pollAPYs();
    await updatePreExisitingBalances();
    await updateTodaysActivity();
})

const pollAPYs = async () => {
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
}

const updatePreExisitingBalances = async () => {
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

    const dayInYears = 1 / 365;

    for (const userEntry of users) {
        const newLP = calculateFinalAmount(!userEntry.baseDeposit.lp ? 0 : userEntry.baseDeposit.lp, !userEntry.accruedInterest.baseLP ? 0 : userEntry.accruedInterest.baseLP, apysToday.baseApy, dayInYears);
        const newCRV = calculateFinalAmount(!userEntry.baseDeposit.lp ? 0 : userEntry.baseDeposit.lp, !userEntry.accruedInterest.crv ? 0 : userEntry.accruedInterest.crv, apysToday.crvApy, dayInYears);
        userEntry.accruedInterest = {baseLP: newLP, crv: newCRV};
        await updateDocument(loadedDb, 'userBalances', userEntry);
    };
    console.log("Updated userBalances with today's APYs");
}

const updateTodaysActivity = async () => {
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
            const baseDeposit = buildBaseDeposit(0);
            const accruedInterest = buildAccruedInterest(0, 0);
            user = userBalanceDocument(entry.user, baseDeposit, accruedInterest);
            await insertDocument(loadedDb, 'userBalances', user);
        } else {
            user.baseDeposit = updateBaseDeposit(user.baseDeposit, 0);
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
        console.log(lpWithdraw)
        const withdrawalResult = await oneShotWithdraw(lpWithdraw);
        await proportionAndUpdateWithdraw(loadedDb, userWithdrawals, lpWithdraw, withdrawalResult);
        // TODO - will transfer stablecoins to user account
        console.log("[Transfer funds to each user]")
    };

    console.log("Completed batched deposit and withdraw as well as updating new balances of the day")
}

app.listen(port, null);