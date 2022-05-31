const express = require('express');
const app = express();
const port = 3000;
const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();

const curve = require('./curve')
const { loadDB, findByUserID, findTotals, findUserProportions, findUserIDBalance } = require('../mongoDB')

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

app.post('/post', jsonParser, async (req, res) => {
    console.log(req.body);
})

app.use('/curve', curve);