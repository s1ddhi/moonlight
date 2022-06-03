const express = require('express');
const app = express();
const port = 3000;
const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();

const curve = require('./curve')
const { loadDB, findByUserID, findTotals, findUserProportions, findUserIDBalance, insertDocument, findAll, findToday, updateDocument } = require('../mongoDB');

const axios = require('axios');

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(port, () => {
    console.log(`App listening on port ${port}`);
});

app.get('/mongoTest', async (req, res) => {
    const loadedDb = await loadDB();
    const userIDBalance = await findUserIDBalance(loadedDb, 'ledger', '0x1111111110', 'deposit');
    const totals = await findTotals(loadedDb, 'ledger', 'deposit');
    const props = await findUserProportions(loadedDb, 'ledger', '0x1111111110', 'deposit');

    res.send(`userBal: ${JSON.stringify(userIDBalance)}\ntotals: ${JSON.stringify(totals)}\nproportions:${props}`);
});

const convexAPYAPI = 'https://www.convexfinance.com/api/curve-apys';

app.get('/getAPYs', jsonParser, async (req, res) => {
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
    res.send("Polled today's APY", apys['3pool']);
})

const dayInYears = 1 / 365;

// TODO... - move to cron job
// Updates *existing* balances - will have to add balance of current day's activities as well
app.get('/updateUserBalances', async (req, res) => {
    const loadedDb = await loadDB();
    const apysToday = (await findToday(loadedDb, 'apys'))[0];
    if (!apysToday) {
        console.log("Today's APY is unavailable");
        res.status(400).send("Today's APY is unavaliable");
        return;
    }
    const users = await findAll(loadedDb, 'userBalances');

    for (const userEntry of users) {
        const newLP = calculateFinalAmount(userEntry.baseDeposit.lp, userEntry.accruedInterest.baseLP, apysToday.baseApy, dayInYears);
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
app.get('/updateWithTodayActivity', async (req, res) => {
    // Go through logs and updates balances of users (baseDeposit)
    // Triggers withdrawal request and deposit requests (aggregated)
    // Deduct 2% off from interest gained (keep track of interest pulling out so can transfer 2% to treasury)
    const loadedDb = await loadDB();
    const todaysActivity = await findToday(loadedDb, 'ledger');

    const deposits = todaysActivity.filter(entry => entry.type == 'deposit');
    let daiDeposit = 0;
    let usdcDeposit = 0;
    let usdtDeposit = 0;

    const withdraws = todaysActivity.filter(entry => entry.type == 'withdraw');
    let daiWithdraw = 0;
    let usdcWithdraw = 0;
    let usdtWithdraw = 0;

    // Track user proportion of today's deposit and assign LP received accordingly
    const userDeposits = {};
    const userWithdrawals = {};

    for (const entry of deposits) {
        console.log(entry.user);
        let user = (await findByUserID(loadedDb, 'userBalances', entry.user))[0];

        if (!user) {
            console.log("New user", entry.user);
            const baseDeposit = buildBaseDeposit(0, entry.amount.dai, entry.amount.usdc, entry.amount.usdt);
            const accruedInterest = buildAccruedInterest(0, 0);
            user = userBalanceDocument(entry.user, baseDeposit, accruedInterest);
            await insertDocument(loadedDb, 'userBalances', user);
        } else {
            console.log("Existing user", entry.user);
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

    console.log("userDeposits", userDeposits);
    console.log("totalDeposits\n\n", daiDeposit, usdcDeposit, usdtDeposit);

    // TODO call oneShotDeposit
    // TODO proportion out LP received

    // TODO handle insufficient balance withdrawal
    for (const entry of withdraws) {
        const user = findByUserID(loadedDb, 'userBalances', entry.user)[0];

        daiWithdraw += entry.amount.dai;
        usdcWithdraw += entry.amount.usdc;
        usdtWithdraw += entry.amount.usdt;

        // update user's own balance
        if (!userWithdrawals[entry.user]) {
            userWithdrawals[entry.user] = {dai: entry.amount.dai, usdc: entry.amount.usdc, usdt: entry.amount.usdt};
        } else {
            userWithdrawals[entry.user] = {dai: userWithdrawals[entry.user].dai + entry.amount.dai, usdc: userWithdrawals[entry.user].usdc + entry.amount.usdc, usdt: userWithdrawals[entry.user].usdt + entry.amount.usdt};
        }
    };

    // console.log("userWithdrawals", userWithdrawals);
    // console.log("totalWithdrawals\n\n", daiWithdraw, usdcWithdraw, usdtWithdraw);

    // TODO call oneShotWithdraw
    // TODO proportion out assets received
});

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

// TODO...
app.get('/informaticsAPI', async (req, res) => {
    // Polls information from 'userBalances'
    // Spot pricing to convert 3CRV and CRV pricing via oracle: https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=dai,cdai,ydai,adai,ycdai,cydai,usdc,cusdc,yusdc,ausdc,ycusdc,cyusdc,usdt,yusdt,ausdt,ycusdt,cyusdt,tusd,ytusd,busd,ybusd,susd,asusd,pax,renbtc,wbtc,sbtc,hbtc,gusd,husd,usdk,usdn,linkusd,musd,rsv,tbtc,dusd,pbtc,bbtc,obtc,ibbtc,terrausd,stasis-eurs,ageur,seur,ethereum,seth,steth,ankreth,alchemix-eth,usdp,paxos-standard,link,slink,lp-3pool-curve,frax,frax-price-index,liquity-usd,sbtccrv,havven,pnetwork,reserve-rights-token,defidollar-dao,boringdao-[old],lido-dao,onx-finance,ankr,liquity,snxrenbpt,meta,aave,keep-network,dola-usd,frax-share,stafi,reth,alchemix-usd,fei-usd,alchemix,curve-dao-token,sushi,boringdao,ellipsis,binance-coin,tether-eurt,magic-internet-money,spell-token,threshold-network-token,jpyc,truegbp,jarvis-synthetic-british-pound,saud,cryptofranc,terra-krw,rkp3r,keep3rv1,usdm,unit-protocol-duck,neutrino-system-base-token,badger-dao,origin-protocol,origin-dollar,angle-protocol,pwrd-stablecoin,rai,lend-flare-dao-token,convex-finance,tether-gold,yearn-finance,rocket-pool-eth,wrapped-steth,tether,butterflydao,cad-coin,silo-finance,stake-dao,olympus,stargate-finance,sdcrv,sdangle,uniswap,usdd,convex-crv,dollar,bitcoin,chainlink,,interest-bearing-bitcoin,ptokens-btc,compound,binance-usd,nusd,huobi-btc,gemini-dollar,neutrino,reserve,defidollar,binance-wrapped-btc,boringdao-btc,staked-ether,cream-2,true-usd
    // Deduct 2% from actual interest before showing (even if interest negative, deduct 2%)
});

app.use('/curve', curve);