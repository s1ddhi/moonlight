const MongoClient = require('mongodb').MongoClient;

const url = 'mongodb://127.0.0.1:27017';
const baseDB = 'quirk-moonlight';

let myDB;

const loadDB = async () => {
    if (myDB) {
        return myDB;
    }

    try {
        const client = await MongoClient.connect(url);
        myDB = client.db(baseDB);
    } catch (err) {
        console.log("Error connecting to MongoDB instance", err);
    }

    console.log(`MongoDB Connected: ${url}`);

    return myDB;
}

const findByUserID = async (_db, collection, userId) => {
    const dbCollection = _db.collection(collection);

    return(await dbCollection.find({ user }).toArray());
};

const findUserIDBalance = async (_db, collection, user, type) => {
    const dbCollection = _db.collection(collection);

    const result = await dbCollection.aggregate([
        {
            $match: { user, type }
        },
        {
            $group: {
                _id: null,
                daiTotal: {
                    $sum: "$amounts.dai"
                },
                usdcTotal: {
                    $sum: "$amounts.usdc"
                },
                usdtTotal: {
                    $sum: "$amounts.usdt"
                }
            }
        }
    ]).toArray();

    if(result.length == 0) {
        return 0; // TODO define empty
    }

    delete result[0]._id;

    return result[0];
};

const findTotals = async (_db, collection, type) => {
    const dbCollection = _db.collection(collection);

    const result = await dbCollection.aggregate([
        {
            $match: { type }
        },
        {
            $group: {
                _id: null,
                daiTotal: {
                    $sum: "$amounts.dai"
                },
                usdcTotal: {
                    $sum: "$amounts.usdc"
                },
                usdtTotal: {
                    $sum: "$amounts.usdt"
                }
            }
        }
    ]).toArray();

    if(result.length == 0) {
        return 0;
    }

    delete result[0]._id;

    return result[0];
};

const DEPOSIT_TYPE = 'deposit';

const findUserProportions = async (_db, collection, user, action) => {
    const totalDeposits = await findTotals(_db, collection, DEPOSIT_TYPE);
    const aggregatedTotalDeposits = aggregate(totalDeposits);
    const userDeposits = await findUserIDBalance(_db, collection, user, action);
    const aggregatedUserDeposits = aggregate(userDeposits);

    return aggregatedUserDeposits / aggregatedTotalDeposits;
};

const aggregate = (obj) => {
    return Object.values(obj).reduce((a, b) => a + b);
};

const insertDocument = async (_db, collection, document) => {
    const dbCollection = _db.collection(collection);

    dbCollection.insertOne(document, (err, result) => {
        if (err) {
            return console.log(`Error inserting document: ${document} into collection ${collection}`, err);
        }
    })
};

const closeDB = async (_db) => {
    await _db.close();
    console.log('Connection closed with MongoDB');
};

module.exports = { loadDB, findByUserID, findUserIDBalance, findTotals, findUserProportions, insertDocument, closeDB };