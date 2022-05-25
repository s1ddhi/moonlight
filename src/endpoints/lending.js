const express = require('express');
const app = express();
const port = 3000;

const curve = require('./curve')

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(port, () => {
    console.log(`App listening on port ${port}`);
});

app.use('/curve', curve);