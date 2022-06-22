const axios = require('axios');
const res = require('express/lib/response');

const isToday = require('date-fns/isToday');
const zonedTimeToUtc = require('date-fns-tz/zonedTimeToUtc');

const { loadDB, findByUserID, findTotals, findUserProportions, findUserIDBalance, insertDocument, findAll, findToday, updateDocument } = require('./mongoDB');

const userBalanceAggregator = async (user, currency) => {
    const loadedDb = await loadDB();
    let balance = (await findByUserID(loadedDb, 'userBalances', user))[0];

    if (!balance) {
        balance = {
            baseDeposit: { lp: 0 },
            accruedInterest:  { baseLP: 0, crv: 0 },
            currency
        };
    };

    prices = await getSpotPrice(currency);

    const currentBalance = (prices['lp-3pool-curve'][currency] * !balance.baseDeposit.lp ? 0 : balance.baseDeposit.lp);
    const accruedBalance = (prices['lp-3pool-curve'][currency] * (!balance.accruedInterest.baseLP ? 0 : balance.accruedInterest.baseLP)) + (prices['curve-dao-token'][currency] * (!balance.accruedInterest.crv ? 0 : balance.accruedInterest.crv));

    let finalDepositBalance = 0;
    let finalWithdrawnBalance = 0;

    // TODO Find since and add any that is not added up until current

    const lastBalanceUpdate = balance.date;
    const lastBalanceUpdateUTC = zonedTimeToUtc(lastBalanceUpdate, 'UTC');
    if (!isToday(lastBalanceUpdateUTC)) {
        const todaysActivity = await findToday(loadedDb, 'ledger');

        const deposits = todaysActivity.filter(entry => entry.type == 'deposit' && entry.user == user);
        console.log(deposits);
        const totalDeposits = deposits.reduce(function (acc, entry) {
            acc.dai += entry.amount.dai;
            acc.usdc += entry.amount.usdc;
            acc.usdt += entry.amount.usdt;
            return acc;
        }, { dai: 0, usdc: 0, usdt: 0});

        const withdraws = todaysActivity.filter(entry => entry.type == 'withdraw' && entry.user == user);
        const totalLPWithdrawn = withdraws.reduce(function (acc, entry) {
            return acc + entry.lpAmount;
        }, 0);

        finalDepositBalance = (prices['dai'][currency] * totalDeposits.dai) + (prices['usd-coin'][currency] * totalDeposits.usdc) + (prices['tether'][currency] * totalDeposits.usdt);
        finalWithdrawnBalance = prices['lp-3pool-curve'][currency] * totalLPWithdrawn;
    };

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
        console.log("update", proportion, balance, lpReceived)
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

module.exports = { userBalanceAggregator, proportionAndUpdateWithdraw, proportionAndUpdateLPDeposit, updateBaseDeposit, buildBaseDeposit, buildAccruedInterest, userBalanceDocument, getSpotPrice };