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
})

const dayInYears = 1 / 365;

// Updates *existing* balances - will have to add balance of current day's activities as well
app.get('/updateUserBalances', async (req, res) => {
    const loadedDb = await loadDB();
    const apysToday = (await findToday(loadedDb, 'apys'))[0];
    const users = await findAll(loadedDb, 'userBalances');

    for (const userEntry of users) {
        const newLP = calculateFinalAmount(userEntry.baseDeposit.lp, userEntry.accruedInterest.baseLP, apysToday.baseApy, dayInYears);
        const newCRV = calculateFinalAmount(userEntry.baseDeposit.lp, userEntry.accruedInterest.crv, apysToday.crvApy, dayInYears);
        userEntry.accruedInterest = {baseLP: newLP, crv: newCRV};
        await updateDocument(loadedDb, 'userBalances', userEntry.user, userEntry);
    };
});

const calculateFinalAmount = (initialCapital, currentBalance, apy, timeInYears) => {
    return (initialCapital * (apy/100) * timeInYears) + currentBalance;
};

app.use('/curve', curve);