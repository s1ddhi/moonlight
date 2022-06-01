const express = require('express');
const axios = require('axios');
const app = express();
const port = 4000;

const cron = require('node-cron');
const { loadDB, insertDocument } = require('../mongoDB');

const convexAPYAPI = 'https://www.convexfinance.com/api/curve-apys';

cron.schedule('0 0 * * *', async () => {
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

app.listen(port, null);