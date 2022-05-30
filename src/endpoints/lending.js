const express = require('express');
const app = express();
const port = 3000;
const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();

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

    console.log(result);

    res.send(`total: ${result}`);
});

app.post('/post', jsonParser, async (req, res) => {
    console.log(req.body);
})

app.use('/curve', curve);