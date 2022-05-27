const express = require('express');
const app = express();
const port = 3000;

const curve = require('./curve')
const { loadDB, findByUserID, findUserIDBalance } = require('../mongoDB')

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(port, () => {
    console.log(`App listening on port ${port}`);
});

app.get('/mongoTest', async (req, res) => {
    const loadedDb = await loadDB();
    const result = await findUserIDBalance(loadedDb, 'ledger', '0x1111111111', 'deposit');

    res.send(result);
});

app.use('/curve', curve);